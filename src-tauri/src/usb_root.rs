use fs4::fs_std::FileExt;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// Locates USB_ROOT — the directory holding the Lockbox executable — and
/// ensures the Vault/Apps/Tools layout exists under it. Every other path in
/// the app is derived from this value, never from a host-OS path, so the
/// same drive behaves identically regardless of which Windows machine it's
/// plugged into.
pub fn find_usb_root() -> io::Result<PathBuf> {
    let exe_path = std::env::current_exe()?;
    let root = exe_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    ensure_layout(&root)?;
    Ok(root)
}

fn ensure_layout(root: &Path) -> io::Result<()> {
    // Vault/ is load-bearing — every vault command depends on it existing,
    // so a failure creating it is fatal (propagated to the caller, which
    // aborts startup with a visible error rather than limping along).
    std::fs::create_dir_all(root.join("Vault"))?;

    // Apps/, ThirdPartyApps/, and Tools/ are just scaffolding for later use
    // (installing portable apps, detecting manually-dropped-in ones, and
    // running the bundled rclone binary). A failure creating these shouldn't
    // stop the vault itself from working, so these are best-effort.
    for dir in ["Apps", "ThirdPartyApps", "Tools"] {
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

/// Home for portable apps the user dropped into place by hand instead of
/// installing through the App Store — kept separate from `Apps/` so
/// catalog-managed installs (which the app tracks, updates, and can cleanly
/// uninstall) never mix with unmanaged, unverified folders someone copied in
/// themselves. See `store_commands::scan_third_party_apps`.
pub fn third_party_apps_dir(root: &Path) -> PathBuf {
    root.join("ThirdPartyApps")
}

pub fn tools_dir(root: &Path) -> PathBuf {
    root.join("Tools")
}
