use crate::cloud_config::{self, CloudRemoteConfig};
use crate::rclone;
use crate::state::{lock_recover, AppState};
use crate::usb_root;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn save_cloud_config(state: State<AppState>, config: CloudRemoteConfig) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    cloud_config::save(&vault_dir, key, &config)
}

#[tauri::command]
pub fn load_cloud_config(state: State<AppState>) -> Result<Option<CloudRemoteConfig>, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    cloud_config::load(&vault_dir, key)
}

#[tauri::command]
pub async fn sync_vault_now(app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Reject a second concurrent sync rather than letting two `rclone sync`
    // processes run against the same Vault directory at once.
    {
        let mut in_progress = lock_recover(&state.sync_in_progress);
        if *in_progress {
            return Err("a sync is already running".to_string());
        }
        *in_progress = true;
    }

    let result = sync_vault_now_inner(&app_handle, &state).await;

    *lock_recover(&state.sync_in_progress) = false;

    result
}

#[tauri::command]
pub async fn test_cloud_connection(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    config: CloudRemoteConfig,
) -> Result<(), String> {
    cloud_config::validate(&config)?;

    {
        let mut in_progress = lock_recover(&state.sync_in_progress);
        if *in_progress {
            return Err("a sync/test operation is already running".to_string());
        }
        *in_progress = true;
    }

    let root = state.root.clone();
    let result = rclone::run_rclone_test(app_handle, root, config).await;

    *lock_recover(&state.sync_in_progress) = false;
    result
}

async fn sync_vault_now_inner(app_handle: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let root = state.root.clone();

    // Load + decrypt the config and drop the mutex guard before the await
    // below — holding a std::sync::MutexGuard across an .await is a
    // deadlock/blocking hazard, so pull out an owned value first.
    let config = {
        let guard = lock_recover(&state.vault_key);
        let key = guard.as_ref().ok_or("vault is locked")?;
        let vault_dir = usb_root::vault_dir(&root);
        cloud_config::load(&vault_dir, key)?.ok_or("no cloud remote configured yet")?
    };

    rclone::run_rclone_sync(app_handle.clone(), root, config).await
}
