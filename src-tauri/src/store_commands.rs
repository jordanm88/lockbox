use crate::state::{lock_recover, AppState};
use crate::{catalog, installer, paths, usb_root};
use serde::Serialize;
#[cfg(unix)]
use std::path::Path;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    id: String,
    name: String,
    description: String,
    icon: String,
    homepage: Option<String>,
    available: bool,
    installed: bool,
    launcher_path: Option<String>,
    size_bytes: Option<u64>,
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
            let launcher_path = target.map(|t| format!("{}/{}", app.id, t.launcher));
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
                available: target.is_some(),
                installed,
                launcher_path,
                size_bytes: target.and_then(|t| t.size_bytes),
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
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

#[tauri::command]
pub fn launch_portable_app(state: State<AppState>, app_path: String) -> Result<(), String> {
    let apps_dir = usb_root::apps_dir(&state.root);
    let resolved = paths::safe_join(&apps_dir, &app_path)?;

    if !resolved.is_file() {
        return Err(format!("launcher not found: {app_path}"));
    }

    #[cfg(unix)]
    ensure_executable(&resolved)?;

    let working_dir = resolved.parent().unwrap_or(&apps_dir);
    std::process::Command::new(&resolved)
        .current_dir(working_dir)
        .spawn()
        .map_err(|e| format!("failed to launch '{app_path}': {e}"))?;

    Ok(())
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(path).map_err(|e| format!("failed to stat launcher: {e}"))?;
    let mut perms = metadata.permissions();
    if perms.mode() & 0o111 == 0 {
        perms.set_mode(perms.mode() | 0o755);
        std::fs::set_permissions(path, perms)
            .map_err(|e| format!("failed to make launcher executable: {e}"))?;
    }
    Ok(())
}
