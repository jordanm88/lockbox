mod catalog;
mod cloud_commands;
mod cloud_config;
mod commands;
mod crypto;
mod installer;
mod paths;
mod rclone;
mod state;
mod store_commands;
mod usb_root;
mod updates;

use state::AppState;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = match usb_root::find_usb_root() {
        Ok(root) => root,
        Err(e) => fatal_startup_error(&format!("Failed to resolve the USB drive layout: {e}")),
    };

    tauri::Builder::default()
        .manage(AppState {
            root,
            vault_key: Mutex::new(None),
            installing_apps: Mutex::new(HashSet::new()),
            sync_in_progress: Mutex::new(false),
            uploads: Mutex::new(HashMap::new()),
            downloads: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::unlock_vault,
            commands::lock_vault,
            commands::vault_exists,
            commands::get_storage_info,
            commands::create_folder,
            commands::begin_upload,
            commands::append_upload_chunk,
            commands::cancel_upload,
            commands::finish_upload,
            commands::begin_download,
            commands::read_download_chunk,
            commands::end_download,
            commands::list_vault_files,
            store_commands::get_app_catalog,
            store_commands::install_app,
            store_commands::launch_portable_app,
            commands::delete_vault_entry,
            commands::uninstall_app,
            updates::get_latest_release,
            updates::check_portable_update,
            updates::apply_portable_update,
            cloud_commands::save_cloud_config,
            cloud_commands::load_cloud_config,
            cloud_commands::sync_vault_now,
            cloud_commands::test_cloud_connection,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| fatal_startup_error(&format!("Tauri failed to start: {e}")));
}

/// A GUI build has `windows_subsystem = "windows"` on Windows, meaning there
/// is no console for eprintln! to reach — a bare `.expect()` panic here
/// would fail completely silently from the user's point of view (the app
/// just doesn't appear). Writing a breadcrumb file next to the executable
/// means the failure is at least discoverable instead of a silent no-op.
fn fatal_startup_error(message: &str) -> ! {
    eprintln!("Lockbox failed to start: {message}");
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let _ = std::fs::write(dir.join("lockbox-startup-error.log"), message);
        }
    }
    std::process::exit(1);
}
