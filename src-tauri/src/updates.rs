use serde_json::Value;
use std::fs;
use tauri::AppHandle;
use tauri::Manager;

#[tauri::command]
pub fn get_latest_release(app_handle: AppHandle) -> Result<Value, String> {
    // Read resource config to get repo (owner/repo)
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

    // Query GitHub Releases API
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
    let json: Value = resp.json().map_err(|e| e.to_string())?;
    Ok(json)
}
