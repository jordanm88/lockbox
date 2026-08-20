use fs4::fs_std::FileExt;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// Locates USB_ROOT — normally the directory holding the Lockbox executable
/// — and ensures the Vault/Apps/Tools layout exists under it. Every other
/// path in the app is derived from this value, never from a host-OS path, so
/// the same drive behaves identically regardless of which machine it's
/// plugged into.
///
/// On Windows this is always the exe's own folder (the portable exe is
/// always run from a writable location). On Linux, a `.deb` install puts the
/// exe in a fixed system path like `/usr/bin` that's never writable, so if
/// the exe's own folder doesn't work, `linux_fallback::resolve` takes over —
/// see its doc comment.
pub fn find_usb_root() -> io::Result<PathBuf> {
    let exe_path = std::env::current_exe()?;
    let exe_root = exe_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    match ensure_layout(&exe_root) {
        Ok(()) => Ok(exe_root),
        Err(e) => {
            #[cfg(target_os = "linux")]
            {
                return linux_fallback::resolve(e);
            }
            #[cfg(not(target_os = "linux"))]
            {
                Err(e)
            }
        }
    }
}

fn ensure_layout(root: &Path) -> io::Result<()> {
    // Vault/ is load-bearing — every vault command depends on it existing,
    // so a failure creating it is fatal (propagated to the caller, which
    // aborts startup with a visible error rather than limping along).
    std::fs::create_dir_all(root.join("Vault"))?;

    // Apps/, Third Party Apps/, and Tools/ are just scaffolding for later
    // use (installing portable apps, detecting manually-dropped-in ones,
    // and running the bundled rclone binary). A failure creating these
    // shouldn't stop the vault itself from working, so these are
    // best-effort.
    for dir in ["Apps", "Third Party Apps", "Tools"] {
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
    root.join("Third Party Apps")
}

pub fn tools_dir(root: &Path) -> PathBuf {
    root.join("Tools")
}

/// Resolves USB_ROOT for a `.deb`-installed Lockbox, where the running exe
/// lives at a fixed, non-writable system path (e.g. `/usr/bin/lockbox`)
/// instead of next to a self-contained drive layout the way the Windows
/// portable exe does. In that case there's no folder to default to, so this
/// remembers a folder the user picks once: a small JSON config under
/// `$XDG_CONFIG_HOME/lockbox` (or `~/.config/lockbox` if that's unset) names
/// the chosen vault folder, checked first on every subsequent launch before
/// falling back to asking again via a native folder-picker.
#[cfg(target_os = "linux")]
mod linux_fallback {
    use super::{ensure_layout, io, Path, PathBuf};
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize)]
    struct StoredConfig {
        vault_root: PathBuf,
    }

    fn config_path() -> Option<PathBuf> {
        let config_home = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
        Some(config_home.join("lockbox").join("config.json"))
    }

    fn load_remembered_root() -> Option<PathBuf> {
        let raw = std::fs::read_to_string(config_path()?).ok()?;
        let config: StoredConfig = serde_json::from_str(&raw).ok()?;
        Some(config.vault_root)
    }

    fn remember_root(root: &Path) -> io::Result<()> {
        let path = config_path()
            .ok_or_else(|| io::Error::other("couldn't determine a config directory (no $HOME set)"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&StoredConfig {
            vault_root: root.to_path_buf(),
        })
        .map_err(io::Error::other)?;
        std::fs::write(path, json)
    }

    /// `original_err` is why the exe's own folder didn't work — folded into
    /// the final error message if the user cancels the picker, so a
    /// relaunch-and-retry attempt (from `fatal_startup_error`'s breadcrumb
    /// log, see lib.rs) explains what happened, not just "no folder chosen."
    pub(super) fn resolve(original_err: io::Error) -> io::Result<PathBuf> {
        if let Some(remembered) = load_remembered_root() {
            if ensure_layout(&remembered).is_ok() {
                return Ok(remembered);
            }
            // The remembered folder is gone or unwritable now (drive
            // unplugged, moved, etc.) — fall through and ask again rather
            // than failing permanently on a stale path.
        }

        let picked = rfd::FileDialog::new()
            .set_title("Choose a folder for Lockbox's vault")
            .pick_folder();

        let Some(picked) = picked else {
            return Err(io::Error::other(format!(
                "Lockbox is installed system-wide and isn't next to a writable folder \
                 ({original_err}). Relaunch Lockbox and choose a folder to store the vault in."
            )));
        };

        ensure_layout(&picked)?;
        remember_root(&picked)?;
        Ok(picked)
    }
}
