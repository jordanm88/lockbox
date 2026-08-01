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
    installed: bool,
    launcher_path: Option<String>,
    size_bytes: Option<u64>,
    install_kind: Option<String>,
}

/// The catalog's declared launcher path, unless `installer::record_actual_launcher`
/// recorded a different real location for this app (e.g. because the
/// archive unpacked into a version-named wrapper folder) — see that
/// function for why the two can disagree.
fn effective_launcher_relative(apps_dir: &Path, app_id: &str, catalog_launcher: &str) -> String {
    let record_path = apps_dir.join(app_id).join(installer::LAUNCHER_RECORD_FILE);
    if let Ok(recorded) = std::fs::read_to_string(&record_path) {
        let trimmed = recorded.trim();
        if !trimmed.is_empty() {
            return format!("{app_id}/{trimmed}");
        }
    }
    format!("{app_id}/{catalog_launcher}")
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
/// with launching it.
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
                if e.raw_os_error() != Some(ERROR_SHARING_VIOLATION) || is_last_attempt {
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

/// Scans `ThirdPartyApps/` for portable apps the user copied in by hand
/// (rather than installing through the App Store) so they still show up
/// somewhere in the UI. Each immediate subfolder becomes one entry; the
/// launcher is guessed as the largest non-helper .exe found anywhere inside
/// it, since the main application binary is almost always the biggest file
/// while uninstallers/updaters/crash-handlers are small. Re-run on every
/// call rather than cached, so dropping in a new folder shows up on the
/// App Store's next periodic refresh without restarting Lockbox. Runs
/// automatically every 20s from the frontend, so it must never block the
/// main thread — see the comment on `install_app` above for why `async` is
/// needed here even though the function body itself doesn't await anything.
#[tauri::command(async)]
pub fn scan_third_party_apps(state: State<AppState>) -> Result<Vec<ThirdPartyApp>, String> {
    let root = usb_root::third_party_apps_dir(&state.root);

    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("failed to scan ThirdPartyApps: {e}")),
    };

    let mut apps = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read ThirdPartyApps entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();

        let mut candidates = Vec::new();
        find_exe_files(&path, &mut candidates)?;
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

        let launcher_path = candidates.first().map(|candidate| {
            candidate
                .strip_prefix(&root)
                .unwrap_or(candidate)
                .to_string_lossy()
                .replace('\\', "/")
        });

        apps.push(ThirdPartyApp {
            id: name.clone(),
            name,
            launcher_path,
        });
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

fn find_exe_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in
        std::fs::read_dir(dir).map_err(|e| format!("failed to scan {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            find_exe_files(&path, out)?;
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            out.push(path);
        }
    }
    Ok(())
}
