mod catalog;
mod cloud_commands;
mod cloud_config;
mod commands;
mod crypto;
mod drive_encryption;
mod eject;
mod installer;
mod paths;
mod process_ext;
mod rclone;
mod state;
mod store_commands;
mod usb_root;
mod updates;

use state::AppState;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    apply_linux_webview_workarounds();

    let root = match usb_root::find_usb_root() {
        Ok(root) => root,
        Err(e) => fatal_startup_error(&format!("Failed to resolve the USB drive layout: {e}")),
    };
    let instance_lock = match usb_root::acquire_instance_lock(&root) {
        Ok(lock) => lock,
        Err(e) => fatal_startup_error(&format!("{e}")),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Windows and macOS pick up the bundle icon (icon.ico /
            // icon.icns) automatically for the running window. Linux
            // normally would too, but only via desktop-file integration
            // (the window manager looks up a .desktop file matching the
            // window's WM_CLASS to find an icon) — an AppImage run directly
            // has no such .desktop file registered anywhere, so without
            // this the taskbar/window-switcher icon falls back to a
            // generic one even though the app itself is running fine.
            // Setting it directly on the window sidesteps that entirely,
            // regardless of whether the AppImage is "integrated" with the
            // desktop or just run in place.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    match tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
                        Ok(icon) => {
                            if let Err(e) = window.set_icon(icon) {
                                eprintln!("warning: failed to set window icon: {e}");
                            }
                        }
                        Err(e) => eprintln!("warning: failed to decode bundled window icon: {e}"),
                    }
                }
            }
            Ok(())
        })
        .manage(AppState {
            root,
            _instance_lock: instance_lock,
            vault_key: Mutex::new(None),
            installing_apps: Mutex::new(HashSet::new()),
            sync_in_progress: Mutex::new(false),
            changing_passphrase: Mutex::new(false),
            uploads: Mutex::new(HashMap::new()),
            downloads: Mutex::new(HashMap::new()),
            third_party_scan_cache: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::unlock_vault,
            commands::lock_vault,
            commands::change_passphrase,
            commands::vault_exists,
            commands::get_vault_root,
            commands::get_platform,
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
            store_commands::scan_third_party_apps,
            store_commands::launch_third_party_app,
            commands::delete_vault_entry,
            commands::export_vault_file,
            commands::export_vault_folder,
            commands::export_vault_items,
            commands::uninstall_app,
            updates::get_latest_release,
            updates::check_portable_update,
            updates::apply_portable_update,
            updates::get_current_release_notes,
            cloud_commands::save_cloud_config,
            cloud_commands::load_cloud_config,
            cloud_commands::sync_vault_now,
            cloud_commands::restore_vault_from_cloud,
            cloud_commands::test_cloud_connection,
            eject::eject_usb_drive,
            drive_encryption::check_drive_encryption,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| fatal_startup_error(&format!("Tauri failed to start: {e}")));
}

/// WebKitGTK disagreeing with the graphics driver is a widely reported
/// Tauri-on-Linux issue, not anything specific to this app — see Tauri's own
/// "Linux Graphics Issues" troubleshooting page
/// (https://v2.tauri.app/develop/debug/linux-graphics/), which is exactly
/// where these three variables and their ordering come from. Symptoms range
/// from a window that opens but stays permanently blank (DMA-BUF framebuffer
/// errors) to a Wayland "Error 71" crash to a crash specifically on resize —
/// all with nothing informative in the console. Applied in order from
/// least to most aggressive; unlike the first two, `WEBKIT_DISABLE_COMPOSITING_MODE`
/// disables *all* accelerated compositing (a real performance cost, not just
/// a narrow workaround), but a working-and-slower app beats a blank one, and
/// this is the documented last resort once the milder two haven't been
/// enough. All three are baked in here rather than left as a README
/// troubleshooting note so affected users don't have to independently
/// discover and set them — but only ever set-if-unset, so setting any of
/// them yourself (e.g. to debug one specifically) is always respected.
#[cfg(target_os = "linux")]
fn apply_linux_webview_workarounds() {
    for (var, value) in [
        ("__NV_DISABLE_EXPLICIT_SYNC", "1"),
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
    ] {
        if std::env::var_os(var).is_none() {
            std::env::set_var(var, value);
        }
    }
}

/// A GUI build has `windows_subsystem = "windows"` on Windows, meaning there
/// is no console for eprintln! to reach — a bare `.expect()` panic here
/// would fail completely silently from the user's point of view (the app
/// just doesn't appear). Writing a breadcrumb file next to the executable
/// means the failure is at least discoverable instead of a silent no-op.
///
/// Falls back to the system temp directory if the exe's own folder isn't
/// writable — true for every `.deb` install on Linux (`/usr/bin`), and
/// exactly the scenario `usb_root::find_usb_root` itself can fail from (the
/// user cancelling the vault-folder picker). Without this fallback, that
/// failure would be entirely silent: no console, and a breadcrumb write that
/// silently no-ops too.
fn fatal_startup_error(message: &str) -> ! {
    eprintln!("Lockbox failed to start: {message}");

    let breadcrumb_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .filter(|dir| std::fs::write(dir.join(".lockbox-write-test"), "").is_ok())
        .inspect(|dir| {
            let _ = std::fs::remove_file(dir.join(".lockbox-write-test"));
        })
        .unwrap_or_else(std::env::temp_dir);

    let _ = std::fs::write(breadcrumb_dir.join("lockbox-startup-error.log"), message);
    std::process::exit(1);
}
