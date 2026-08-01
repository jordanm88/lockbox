use serde::Serialize;
use serde_json::Value;
use std::fs;
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

#[tauri::command]
pub fn get_latest_release(app_handle: AppHandle) -> Result<Value, String> {
    let repo = read_repo_from_config(&app_handle)?;
    fetch_latest_release(&repo)
}

#[tauri::command]
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
        find_windows_portable_asset(&latest_release)
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

#[tauri::command]
pub fn apply_portable_update(
    app_handle: AppHandle,
    download_url: String,
) -> Result<ApplyUpdateResult, String> {
    apply_windows_portable_update(&app_handle, &download_url)?;
    Ok(ApplyUpdateResult {
        started: true,
        message: "Update downloaded. Lockbox will close now and restart into the new version.".to_string(),
    })
}

fn read_repo_from_config(app_handle: &AppHandle) -> Result<String, String> {
    let path = app_handle
        .path()
        .resolve("update.config.json", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("failed to resolve update config: {e}"))?;
    let raw = fs::read_to_string(&path).map_err(|e| format!("failed to read update config: {e}"))?;
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
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let client = reqwest::blocking::Client::builder()
        .user_agent("Lockbox-Updater/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
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

fn find_windows_portable_asset(release: &Value) -> (Option<String>, Option<String>) {
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
        if !lower.ends_with(".exe") {
            continue;
        }

        let score = if lower.contains("lockbox-windows") {
            100
        } else if lower == "lockbox.exe" {
            90
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

fn apply_windows_portable_update(app_handle: &AppHandle, download_url: &str) -> Result<(), String> {
    if !(download_url.starts_with("https://github.com/")
        || download_url.starts_with("https://objects.githubusercontent.com/")
        || download_url.starts_with("https://github-releases.githubusercontent.com/"))
    {
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

    std::process::Command::new("cmd")
        .arg("/C")
        .arg(&updater_script_str)
        .arg(&current_exe_str)
        .arg(&temp_new_str)
        .spawn()
        .map_err(|e| format!("failed to launch updater helper: {e}"))?;

    app_handle.exit(0);
    Ok(())
}
