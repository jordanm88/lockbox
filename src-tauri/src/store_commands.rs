use crate::state::{lock_recover, AppState};
use crate::{catalog, installer, paths, usb_root};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    id: String,
    name: String,
    description: String,
    icon: String,
    homepage: Option<String>,
    category: Option<String>,
    available: bool,
    active: bool,
    installed: bool,
    launcher_path: Option<String>,
    size_bytes: Option<u64>,
    install_kind: Option<String>,
}

/// The catalog's declared launcher path, resolved to wherever it actually
/// lives relative to `apps_dir`. Tries the current per-OS install location
/// first (`<id>/<os>/...` — see `usb_root::app_install_dir`), then falls
/// back to the older flat `<id>/...` layout every app used before installs
/// started being split by OS, so an app installed with an earlier version
/// of Lockbox doesn't suddenly look uninstalled after an update. Within
/// each layout, `installer::record_actual_launcher`'s recorded path (if
/// any) wins over the catalog's own declared one — see that function for
/// why the two can disagree.
fn effective_launcher_relative(apps_dir: &Path, app_id: &str, catalog_launcher: &str) -> String {
    let per_os_dir = apps_dir.join(app_id).join(usb_root::APP_OS_SEGMENT);
    if let Some(relative) = resolved_launcher_in(&per_os_dir, catalog_launcher) {
        return format!("{app_id}/{}/{relative}", usb_root::APP_OS_SEGMENT);
    }

    let legacy_dir = apps_dir.join(app_id);
    if let Some(relative) = resolved_launcher_in(&legacy_dir, catalog_launcher) {
        return format!("{app_id}/{relative}");
    }

    // Not installed under either layout — this is where a fresh install
    // would land, which callers use as the answer either way (e.g. to show
    // where "Install" will put it, or as a definitely-missing path so an
    // `.is_file()` check downstream correctly reports "not installed").
    format!("{app_id}/{}/{catalog_launcher}", usb_root::APP_OS_SEGMENT)
}

/// The launcher's path relative to `install_dir`, if one is actually found
/// there — the `installer::record_actual_launcher` record if present, else
/// the catalog's declared launcher name if that file exists. `None` means
/// nothing is installed in `install_dir` at all.
fn resolved_launcher_in(install_dir: &Path, catalog_launcher: &str) -> Option<String> {
    let record_path = install_dir.join(installer::LAUNCHER_RECORD_FILE);
    if let Ok(recorded) = std::fs::read_to_string(&record_path) {
        let trimmed = recorded.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    install_dir.join(catalog_launcher).is_file().then(|| catalog_launcher.to_string())
}

fn install_kind_label(target: &catalog::TargetSpec) -> String {
    match target.archive_type {
        catalog::ArchiveType::Zip => "ZIP package".to_string(),
        catalog::ArchiveType::TarGz => "tar.gz package".to_string(),
        catalog::ArchiveType::Binary => "Direct binary".to_string(),
        catalog::ArchiveType::Exe => "Windows executable".to_string(),
        catalog::ArchiveType::Installer => "Windows installer".to_string(),
    }
}

#[tauri::command]
pub fn get_app_catalog(
    app_handle: AppHandle,
    state: State<AppState>,
) -> Result<Vec<CatalogEntry>, String> {
    let catalog = catalog::load_catalog(&app_handle)?;
    let apps_dir = usb_root::apps_dir(&state.root);

    let entries = catalog
        .apps
        .into_iter()
        .map(|app| {
            let target = app.targets.for_current_os();
            let launcher_path =
                target.map(|t| effective_launcher_relative(&apps_dir, &app.id, &t.launcher));
            let installed = launcher_path
                .as_ref()
                .map(|relative| apps_dir.join(relative).is_file())
                .unwrap_or(false);

            CatalogEntry {
                id: app.id,
                name: app.name,
                description: app.description,
                icon: app.icon,
                homepage: app.homepage,
                category: app.category,
                available: target.is_some(),
                active: app.active,
                installed,
                launcher_path,
                size_bytes: target.and_then(|t| t.size_bytes),
                install_kind: target.map(install_kind_label),
            }
        })
        .collect();

    Ok(entries)
}

// `async` here doesn't change anything about this function's body (still
// plain, blocking code) — it tells Tauri to dispatch it off the main thread
// instead of on it. Without this, a Tauri command declared as a plain `fn`
// runs directly on the main UI thread, so this function's download +
// extract + (for installer-type apps) subprocess-wait, which can easily run
// for seconds to minutes, was freezing the whole window ("Not Responding")
// for its entire duration. See https://v2.tauri.app/develop/calling-rust/.
#[tauri::command(async)]
pub fn install_app(
    app_handle: AppHandle,
    state: State<AppState>,
    app_id: String,
) -> Result<(), String> {
    // Reject a second concurrent install of the same app instead of letting
    // two installer runs race over the same install directory (one's
    // clean-slate removal could delete the other's in-progress extraction).
    {
        let mut installing = lock_recover(&state.installing_apps);
        if !installing.insert(app_id.clone()) {
            return Err(format!("'{app_id}' is already installing"));
        }
    }

    let result = installer::install_app(&app_handle, &state.root, &app_id);

    lock_recover(&state.installing_apps).remove(&app_id);

    result
}

// `async`: `launch_from` below can now retry for over a second on a
// transient file lock (see its comment) — see `install_app` above for why a
// plain `fn` would otherwise block the main thread for that whole retry
// window.
#[tauri::command(async)]
pub fn launch_portable_app(state: State<AppState>, app_path: String) -> Result<(), String> {
    launch_from(&usb_root::apps_dir(&state.root), &app_path)
}

#[tauri::command(async)]
pub fn launch_third_party_app(state: State<AppState>, app_path: String) -> Result<(), String> {
    launch_from(&usb_root::third_party_apps_dir(&state.root), &app_path)
}

/// Windows error 32 (`ERROR_SHARING_VIOLATION`) — the file exists and is
/// valid, but something else currently has it open in a way that conflicts
/// with launching it. Linux has no equivalent transient-lock race on plain
/// `exec` (see `is_retryable_launch_error` below), so this constant, and the
/// retry it drives, only ever fires on Windows.
#[cfg(windows)]
const ERROR_SHARING_VIOLATION: i32 = 32;

/// A handful of retries with a short backoff, specifically for
/// `ERROR_SHARING_VIOLATION` on the very first launch after installing an
/// app. That error is almost always transient here: Windows Defender (or
/// another AV product) real-time-scans a freshly-extracted .exe the first
/// time anything tries to open it, and briefly holds a lock that makes
/// `CreateProcess` fail as if the file were in use — even though nothing in
/// Lockbox itself is still holding it open. Retrying rides out that window
/// instead of surfacing a permanent-looking error for what's actually a
/// one-off timing race (this is exactly what VS Code's ~335MB archive with
/// thousands of files hits almost every time on a fresh install).
const LAUNCH_RETRY_ATTEMPTS: u32 = 6;
const LAUNCH_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(400);

/// Whether a launch failure is the kind worth retrying. Windows: only the
/// specific transient AV-scan lock race described above. Linux has no
/// analogous "something briefly locked the file right after we wrote it"
/// failure mode for a plain `exec` — a Linux launch failure (missing exec
/// bit, ELF for the wrong architecture, etc.) is permanent, so retrying
/// would just delay showing the real error for no benefit.
#[cfg(windows)]
fn is_retryable_launch_error(e: &std::io::Error) -> bool {
    e.raw_os_error() == Some(ERROR_SHARING_VIOLATION)
}

#[cfg(not(windows))]
fn is_retryable_launch_error(_e: &std::io::Error) -> bool {
    false
}

fn launch_from(base_dir: &Path, app_path: &str) -> Result<(), String> {
    let resolved = paths::safe_join(base_dir, app_path)?;

    if !resolved.is_file() {
        return Err(format!("launcher not found: {app_path}"));
    }

    let working_dir = resolved.parent().unwrap_or(base_dir);

    let mut last_error = None;
    for attempt in 0..LAUNCH_RETRY_ATTEMPTS {
        match std::process::Command::new(&resolved).current_dir(working_dir).spawn() {
            Ok(_) => return Ok(()),
            Err(e) => {
                let is_last_attempt = attempt + 1 == LAUNCH_RETRY_ATTEMPTS;
                if !is_retryable_launch_error(&e) || is_last_attempt {
                    last_error = Some(e);
                    break;
                }
                std::thread::sleep(LAUNCH_RETRY_DELAY);
                last_error = Some(e);
            }
        }
    }

    Err(format!(
        "failed to launch '{app_path}': {}",
        last_error.expect("loop always runs at least once and sets this on every non-return path")
    ))
}

/// Filename fragments that mark an .exe as a helper/uninstaller/updater
/// rather than the app's own launcher — a manually-dropped-in portable app's
/// folder often has several of these alongside the one binary users actually
/// want, and picking one of these instead would "launch" the wrong thing.
const IGNORED_LAUNCHER_PATTERNS: &[&str] = &[
    "unins",
    "uninstall",
    "setup",
    "updater",
    "update.exe",
    "crashpad_handler",
    "vc_redist",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyApp {
    id: String,
    name: String,
    launcher_path: Option<String>,
}

/// Scans `Third Party Apps/` for portable apps the user copied in by hand
/// (rather than installing through the App Store) so they still show up
/// somewhere in the UI. Each immediate subfolder becomes one entry; the
/// launcher is guessed as the largest non-helper executable found anywhere
/// inside it (a `.exe` on Windows; any regular file with the executable bit
/// set on Linux, since portable Linux binaries carry no fixed extension),
/// since the main application binary is almost always the biggest file
/// while uninstallers/updaters/crash-handlers are small.
///
/// Runs automatically every 20s from the frontend (see `ThirdPartyApps.tsx`)
/// — re-walking every file in every already-known folder on every single
/// call, which is what this used to do unconditionally, got slower the more
/// (and the bigger) apps were sitting there, for no benefit most of the
/// time: nothing about a folder's contents usually changed between one poll
/// and the next. `AppState.third_party_scan_cache` remembers each folder's
/// own mtime alongside its last-resolved launcher; a folder is only
/// re-walked when its mtime has moved since the last scan. Adding, removing,
/// or renaming a file inside a folder updates that folder's own mtime,
/// which covers the ordinary case (dropping in a new portable app) — the
/// one thing it doesn't catch is changing an existing file's permission
/// bits in place (e.g. `chmod +x` on a file that was already there) without
/// adding, removing, or renaming anything else, since that only touches the
/// file's own metadata, not its parent directory's. A brand new folder has
/// no cache entry at all, so it's always scanned fresh the first time it's
/// seen — dropping in a new folder still shows up on the very next poll.
///
/// Must never block the main thread — see the comment on `install_app`
/// above for why `async` is needed here even though the function body
/// doesn't await anything.
#[tauri::command(async)]
pub fn scan_third_party_apps(state: State<AppState>) -> Result<Vec<ThirdPartyApp>, String> {
    let root = usb_root::third_party_apps_dir(&state.root);

    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("failed to scan Third Party Apps: {e}")),
    };

    let mut cache = lock_recover(&state.third_party_scan_cache);
    let mut seen_names = std::collections::HashSet::new();
    let mut apps = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read Third Party Apps entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        seen_names.insert(name.clone());

        let mtime = entry.metadata().and_then(|m| m.modified()).ok();
        let cached = cache.get(&name).cloned();

        let launcher_path = match (mtime, &cached) {
            (Some(mtime), Some((cached_mtime, cached_launcher))) if mtime == *cached_mtime => {
                cached_launcher.clone()
            }
            _ => {
                let resolved = resolve_third_party_launcher(&root, &path)?;
                if let Some(mtime) = mtime {
                    cache.insert(name.clone(), (mtime, resolved.clone()));
                }
                resolved
            }
        };

        apps.push(ThirdPartyApp {
            id: name.clone(),
            name,
            launcher_path,
        });
    }

    // Drop cache entries for folders that no longer exist, so the cache
    // doesn't grow without bound across a long-running session as folders
    // come and go.
    cache.retain(|name, _| seen_names.contains(name));
    drop(cache);

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

/// The actual (expensive) per-folder work `scan_third_party_apps` caches
/// the result of: walk `path` recursively, filter out known helper/updater
/// binaries, and pick the largest remaining executable as the launcher.
fn resolve_third_party_launcher(root: &Path, path: &Path) -> Result<Option<String>, String> {
    let mut candidates = Vec::new();
    find_launcher_candidates(path, &mut candidates)?;
    candidates.retain(|candidate| {
        let lower = candidate
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        !IGNORED_LAUNCHER_PATTERNS
            .iter()
            .any(|pattern| lower.contains(pattern))
    });
    candidates.sort_by_key(|candidate| {
        std::cmp::Reverse(std::fs::metadata(candidate).map(|m| m.len()).unwrap_or(0))
    });

    Ok(candidates.first().map(|candidate| {
        candidate
            .strip_prefix(root)
            .unwrap_or(candidate)
            .to_string_lossy()
            .replace('\\', "/")
    }))
}

fn find_launcher_candidates(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in
        std::fs::read_dir(dir).map_err(|e| format!("failed to scan {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            find_launcher_candidates(&path, out)?;
        } else if is_launcher_candidate(&path) {
            out.push(path);
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_launcher_candidate(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
}

/// Linux portable binaries and AppImages carry no fixed extension, so
/// candidacy is instead "a regular file with the executable bit set for
/// someone" — the same thing a file manager or shell checks before letting
/// you run it by clicking/typing its name.
#[cfg(target_os = "linux")]
fn is_launcher_candidate(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}
