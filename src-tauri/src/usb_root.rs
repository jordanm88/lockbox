use fs4::fs_std::FileExt;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// Locates USB_ROOT — the directory holding the Lockbox executable (or, on
/// macOS, the directory holding the `.app` bundle) — and ensures the
/// Vault/Apps/Tools layout exists under it. Every other path in the app is
/// derived from this value, never from a host-OS path, so the same drive
/// behaves identically regardless of which machine or OS it's plugged into.
pub fn find_usb_root() -> io::Result<PathBuf> {
    let exe_path = resolve_exe_path()?;
    let root = root_from_exe_path(&exe_path);
    ensure_layout(&root)?;
    Ok(root)
}

#[cfg(target_os = "linux")]
fn resolve_exe_path() -> io::Result<PathBuf> {
    // The AppImage runtime FUSE-mounts the squashfs image and re-execs the
    // binary from that mountpoint, so current_exe() would resolve inside
    // /tmp/.mount_XXXX rather than the .AppImage file sitting on the USB
    // drive. The runtime exports APPIMAGE with the real path before
    // launching, so prefer that when present.
    if let Ok(appimage_path) = std::env::var("APPIMAGE") {
        return Ok(PathBuf::from(appimage_path));
    }
    std::env::current_exe()
}

#[cfg(not(target_os = "linux"))]
fn resolve_exe_path() -> io::Result<PathBuf> {
    std::env::current_exe()
}

fn root_from_exe_path(exe_path: &Path) -> PathBuf {
    // macOS ships as USB_ROOT/Lockbox-macOS.app/Contents/MacOS/lockbox, so
    // the immediate parent isn't USB_ROOT — walk up past the .app bundle
    // itself instead.
    for ancestor in exe_path.ancestors() {
        let is_app_bundle = ancestor
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("app"))
            .unwrap_or(false);
        if is_app_bundle {
            if let Some(parent) = ancestor.parent() {
                return parent.to_path_buf();
            }
        }
    }

    exe_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn ensure_layout(root: &Path) -> io::Result<()> {
    // Vault/ is load-bearing — every vault command depends on it existing,
    // so a failure creating it is fatal (propagated to the caller, which
    // aborts startup with a visible error rather than limping along).
    std::fs::create_dir_all(root.join("Vault"))?;

    // Apps/ and the *other* OSes' Tools/ subfolders are just scaffolding for
    // later use (installing portable apps, or plugging this same drive into
    // a different OS later). A failure creating these shouldn't stop the
    // vault itself from working, so these are best-effort.
    for dir in ["Apps", "Tools/win", "Tools/mac", "Tools/linux"] {
        if let Err(e) = std::fs::create_dir_all(root.join(dir)) {
            eprintln!("warning: failed to create {dir}: {e}");
        }
    }

    Ok(())
}

/// Acquires an exclusive advisory lock on a sentinel file inside the vault,
/// held for the whole process lifetime via the returned `File` (dropping it,
/// or the process exiting, releases the lock). USB_ROOT is now explicitly
/// supported from a cloud-sync folder (Dropbox/OneDrive/etc.) as well as a
/// physical drive, which means two devices syncing the *same* folder can
/// both have Lockbox open at once — without this lock, that would let two
/// processes write the encrypted index out from under each other and
/// silently corrupt or lose vault data. Failing loudly at startup instead is
/// far cheaper than that.
pub fn acquire_instance_lock(root: &Path) -> io::Result<File> {
    let lockbox_dir = vault_dir(root).join(".lockbox");
    std::fs::create_dir_all(&lockbox_dir)?;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(lockbox_dir.join("instance.lock"))?;
    file.try_lock_exclusive().map_err(|_| {
        io::Error::other(
            "This vault is already open in another Lockbox window — possibly on another \
             device syncing this same folder. Close it there first, then try again.",
        )
    })?;
    Ok(file)
}

pub fn vault_dir(root: &Path) -> PathBuf {
    root.join("Vault")
}

pub fn apps_dir(root: &Path) -> PathBuf {
    root.join("Apps")
}

#[allow(dead_code)]
pub fn tools_dir(root: &Path) -> PathBuf {
    root.join("Tools")
}

pub fn tools_os_dir(root: &Path) -> PathBuf {
    let os_folder = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    root.join("Tools").join(os_folder)
}
