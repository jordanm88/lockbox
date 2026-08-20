#[cfg(windows)]
use crate::process_ext;
use serde::Serialize;
use serde_json::Value;
use std::fs;
#[cfg(windows)]
use std::io::Write;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableUpdateInfo {
    has_update: bool,
    current_version: String,
    latest_version: String,
    release_url: Option<String>,
    asset_name: Option<String>,
    asset_download_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyUpdateResult {
    started: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    version: String,
    name: Option<String>,
    body: Option<String>,
    html_url: Option<String>,
}

// `async` on all three commands below dispatches them off the main thread —
// see `store_commands::install_app` for the full explanation. Each one does
// a blocking network call (to GitHub's API, or downloading an entire new
// exe in apply_portable_update's case), which otherwise froze the whole
// window for as long as the request took.
#[tauri::command(async)]
pub fn get_latest_release(app_handle: AppHandle) -> Result<Value, String> {
    let repo = read_repo_from_config(&app_handle)?;
    fetch_latest_release(&repo)
}

#[tauri::command(async)]
pub fn check_portable_update(app_handle: AppHandle) -> Result<PortableUpdateInfo, String> {
    let repo = read_repo_from_config(&app_handle)?;
    let latest_release = fetch_latest_release(&repo)?;

    let current_version = app_handle.package_info().version.to_string();
    let latest_tag = latest_release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let latest_version = normalize_tag_to_version(&latest_tag);

    let has_update = is_version_newer(&latest_version, &current_version);
    let release_url = latest_release
        .get("html_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let (asset_name, asset_download_url) = if has_update {
        find_platform_asset(&latest_release)
    } else {
        (None, None)
    };

    Ok(PortableUpdateInfo {
        has_update,
        current_version,
        latest_version,
        release_url,
        asset_name,
        asset_download_url,
    })
}

/// Powers the "what's new" popup: fetches release notes for the version
/// *actually running right now*, not GitHub's latest — those can differ
/// (this build might already be newer, or the update hasn't landed yet), and
/// showing notes for a release you don't have yet would be misleading. If
/// this exact version was never tagged/released (e.g. a local dev build),
/// the lookup below 404s and the frontend just skips the popup silently —
/// this is a nice-to-have, not something worth surfacing an error for.
#[tauri::command(async)]
pub fn get_current_release_notes(app_handle: AppHandle) -> Result<ReleaseNotes, String> {
    let repo = read_repo_from_config(&app_handle)?;
    let current_version = app_handle.package_info().version.to_string();
    let release = fetch_release_by_tag(&repo, &format!("v{current_version}"))?;

    Ok(ReleaseNotes {
        version: current_version,
        name: release.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        body: release.get("body").and_then(|v| v.as_str()).map(|s| s.to_string()),
        html_url: release.get("html_url").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}

#[tauri::command(async)]
pub fn apply_portable_update(
    app_handle: AppHandle,
    download_url: String,
) -> Result<ApplyUpdateResult, String> {
    let message = apply_platform_update(&app_handle, &download_url)?;
    Ok(ApplyUpdateResult {
        started: true,
        message,
    })
}

fn read_repo_from_config(app_handle: &AppHandle) -> Result<String, String> {
    let resource_raw = app_handle
        .path()
        .resolve("update.config.json", tauri::path::BaseDirectory::Resource)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok());

    // Dev/runtime fallback: keep a compiled-in copy so update checks still
    // work even if the packaged resource path is missing or misresolved —
    // same reasoning as catalog.rs's embedded-catalog fallback.
    let raw = match resource_raw {
        Some(raw) => raw,
        None => include_str!("../resources/update.config.json").to_string(),
    };

    let cfg: Value = serde_json::from_str(&raw).map_err(|e| format!("invalid update config: {e}"))?;
    let repo = cfg
        .get("repo")
        .and_then(|v| v.as_str())
        .ok_or("update config missing 'repo' string")?;

    if repo.is_empty() {
        return Err("update repo not configured".to_string());
    }

    Ok(repo.to_string())
}

fn fetch_latest_release(repo: &str) -> Result<Value, String> {
    fetch_release_json(&format!("https://api.github.com/repos/{repo}/releases/latest"))
}

fn fetch_release_by_tag(repo: &str, tag: &str) -> Result<Value, String> {
    fetch_release_json(&format!("https://api.github.com/repos/{repo}/releases/tags/{tag}"))
}

fn fetch_release_json(url: &str) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Lockbox-Updater/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    resp.json::<Value>().map_err(|e| e.to_string())
}

fn normalize_tag_to_version(tag: &str) -> String {
    tag.strip_prefix('v').unwrap_or(tag).to_string()
}

fn is_version_newer(latest: &str, current: &str) -> bool {
    parse_version_parts(latest) > parse_version_parts(current)
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| {
            let digits = part.chars().take_while(|c| c.is_ascii_digit()).collect::<String>();
            digits.parse::<u64>().unwrap_or(0)
        })
        .collect::<Vec<_>>()
}

/// Finds the release asset this build's self-updater knows how to apply:
/// the raw portable `.exe` on Windows, the `.deb` on Linux. Shared scoring
/// shape between both platforms — favor an asset name that names the OS,
/// then a bare "lockbox" name, then any name that merely mentions lockbox.
#[cfg(windows)]
fn find_platform_asset(release: &Value) -> (Option<String>, Option<String>) {
    find_best_asset(
        release,
        ".exe",
        &["setup", "installer"],
        ("lockbox-windows", 100),
        ("lockbox.exe", 90),
    )
}

/// No CI-produced `.deb` name reliably contains "lockbox-linux" the way the
/// Windows build's does — Tauri's bundler names it from the package
/// version/arch instead (e.g. `lockbox_0.2.16_amd64.deb`) — so the
/// meaningful disambiguator here is architecture, in case a future release
/// ever publishes more than one. The exact-match tier is unused (no bare
/// canonical Linux filename to prefer), so it's given a pattern that can
/// never match.
#[cfg(target_os = "linux")]
fn find_platform_asset(release: &Value) -> (Option<String>, Option<String>) {
    find_best_asset(release, ".deb", &[], ("amd64", 100), ("", 0))
}

/// Shared scoring logic behind `find_platform_asset`: every asset must end
/// in `extension` and must not contain any of `excluded_substrings` (used on
/// Windows to skip the NSIS installer `.exe` alongside the portable one —
/// this updater only knows how to swap a running exe/package in place, not
/// run an interactive installer). Among what's left, an asset whose name
/// contains `contains_pattern.0` scores highest, one that's an exact match
/// for `exact_name.0` scores second, and anything else that merely mentions
/// "lockbox" is the generic fallback.
#[cfg(any(windows, target_os = "linux"))]
fn find_best_asset(
    release: &Value,
    extension: &str,
    excluded_substrings: &[&str],
    contains_pattern: (&str, i32),
    exact_name: (&str, i32),
) -> (Option<String>, Option<String>) {
    let assets = release
        .get("assets")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut best: Option<(String, String, i32)> = None;

    for asset in assets {
        let name = asset
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let url = asset
            .get("browser_download_url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        if name.is_empty() || url.is_empty() {
            continue;
        }

        let lower = name.to_ascii_lowercase();
        if !lower.ends_with(extension) {
            continue;
        }

        if excluded_substrings.iter().any(|s| lower.contains(s)) {
            continue;
        }

        let score = if lower.contains(contains_pattern.0) {
            contains_pattern.1
        } else if lower == exact_name.0 {
            exact_name.1
        } else if lower.contains("lockbox") {
            70
        } else {
            0
        };

        if score == 0 {
            continue;
        }

        match &best {
            Some((_, _, existing)) if *existing >= score => {}
            _ => best = Some((name, url, score)),
        }
    }

    if let Some((name, url, _)) = best {
        (Some(name), Some(url))
    } else {
        (None, None)
    }
}

const TRUSTED_DOWNLOAD_HOSTS: &[&str] = &[
    "https://github.com/",
    "https://objects.githubusercontent.com/",
    "https://github-releases.githubusercontent.com/",
];

fn download_update_bytes(download_url: &str) -> Result<Vec<u8>, String> {
    if !TRUSTED_DOWNLOAD_HOSTS.iter().any(|host| download_url.starts_with(host)) {
        return Err("refusing update from non-GitHub download URL".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Lockbox-Updater/1.0")
        .build()
        .map_err(|e| format!("failed to build updater client: {e}"))?;
    let mut response = client
        .get(download_url)
        .send()
        .map_err(|e| format!("failed to download update: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed to download update: {e}"))?;

    let mut bytes = Vec::new();
    response
        .copy_to(&mut bytes)
        .map_err(|e| format!("failed to read update payload: {e}"))?;
    Ok(bytes)
}

/// Downloads the update and swaps it into place: on Windows this stages the
/// new exe and hands off to a detached `.bat` helper that waits for this
/// process to exit before moving it over the running one (Windows won't let
/// a running exe's own file be replaced while it's open, unlike Linux). On
/// Linux there's no such in-place swap available for a `.deb`-installed,
/// dpkg-owned binary — instead the downloaded `.deb` is handed to the
/// desktop's own package-install UI (`apply_linux_update`), which does its
/// own privilege elevation; Lockbox never runs anything as root itself.
#[cfg(windows)]
fn apply_platform_update(app_handle: &AppHandle, download_url: &str) -> Result<String, String> {
    let bytes = download_update_bytes(download_url)?;

    if bytes.len() < 2 || bytes[0] != b'M' || bytes[1] != b'Z' {
        return Err("downloaded update is not a Windows executable".to_string());
    }

    let current_exe = std::env::current_exe().map_err(|e| format!("failed to resolve current executable: {e}"))?;
    let current_exe_str = current_exe.to_string_lossy().to_string();

    let temp_new = current_exe.with_extension("new.exe");
    fs::write(&temp_new, &bytes).map_err(|e| format!("failed to stage update: {e}"))?;

    let updater_script_path = std::env::temp_dir().join("lockbox-apply-update.bat");
    let mut script = fs::File::create(&updater_script_path)
        .map_err(|e| format!("failed to create updater script: {e}"))?;

    let script_body = "@echo off\r\nsetlocal\r\nset \"TARGET=%~1\"\r\nset \"SOURCE=%~2\"\r\nset \"RETRIES=0\"\r\n:retry\r\nmove /Y \"%SOURCE%\" \"%TARGET%\" >nul 2>nul\r\nif errorlevel 1 (\r\n  timeout /t 1 /nobreak >nul\r\n  set /a RETRIES+=1\r\n  if %RETRIES% GEQ 90 goto fail\r\n  goto retry\r\n)\r\nstart \"\" \"%TARGET%\"\r\ndel \"%~f0\" >nul 2>nul\r\nexit /b 0\r\n:fail\r\nexit /b 1\r\n";
    script
        .write_all(script_body.as_bytes())
        .map_err(|e| format!("failed to write updater script: {e}"))?;

    let updater_script_str = updater_script_path.to_string_lossy().to_string();
    let temp_new_str = temp_new.to_string_lossy().to_string();

    let mut cmd = std::process::Command::new("cmd");
    cmd.arg("/C").arg(&updater_script_str).arg(&current_exe_str).arg(&temp_new_str);
    process_ext::hide_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| format!("failed to launch updater helper: {e}"))?;

    app_handle.exit(0);
    Ok("Update downloaded. Lockbox will close now and restart into the new version.".to_string())
}

#[cfg(target_os = "linux")]
fn apply_platform_update(app_handle: &AppHandle, download_url: &str) -> Result<String, String> {
    let bytes = download_update_bytes(download_url)?;

    // A `.deb` is a Unix `ar` archive; this is that format's magic header,
    // the Linux equivalent of checking for the Windows PE `MZ` header above.
    if bytes.len() < 8 || &bytes[..8] != b"!<arch>\n" {
        return Err("downloaded update is not a .deb package".to_string());
    }

    let temp_deb = std::env::temp_dir().join("lockbox-update.deb");
    fs::write(&temp_deb, &bytes).map_err(|e| format!("failed to stage update: {e}"))?;

    // Hands the downloaded package to the desktop's default handler for
    // `.deb` files (GNOME Software, KDE Discover, etc.), which does its own
    // polkit/pkexec prompt to install it — Lockbox never elevates privileges
    // itself. Unlike the Windows in-place swap, this doesn't happen
    // automatically: the user finishes the install in that window, then
    // relaunches Lockbox.
    tauri_plugin_opener::open_path(&temp_deb, None::<&str>)
        .map_err(|e| format!("failed to open the downloaded update: {e}"))?;

    app_handle.exit(0);
    Ok(
        "Update downloaded. Finish installing it in the package installer window that just \
         opened, then relaunch Lockbox."
            .to_string(),
    )
}
