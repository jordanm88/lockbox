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

/// The OS segment `app_install_dir` nests catalog installs under — see its
/// doc comment for why.
#[cfg(windows)]
pub(crate) const APP_OS_SEGMENT: &str = "windows";
#[cfg(target_os = "linux")]
pub(crate) const APP_OS_SEGMENT: &str = "linux";

/// Where a catalog-managed app's files for *this* OS live:
/// `Apps/<id>/<os>/`, not just `Apps/<id>/`. The same physical drive is
/// meant to move between a Windows machine and a Linux machine, and each OS
/// needs its own build of a given app — an entirely different binary format,
/// not just a different file — so nesting installs by OS lets a Windows
/// install and a Linux install of the same catalog app coexist on one drive
/// instead of one silently overwriting the other. `store_commands`'s
/// `effective_launcher_relative` falls back to the older flat `Apps/<id>/`
/// layout when nothing's found here, so an app installed before this split
/// existed doesn't suddenly look uninstalled.
pub fn app_install_dir(root: &Path, app_id: &str) -> PathBuf {
    apps_dir(root).join(app_id).join(APP_OS_SEGMENT)
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

    /// Common Linux removable-media mount roots — desktop environments don't
    /// agree on a scheme (GNOME/most distros: `/media/<user>/<label>` or
    /// `/run/media/<user>/<label>`; some setups: `/mnt/<label>`), and the
    /// same physical drive can even land at a different path on a different
    /// plug or a different machine. Checked in `find_existing_vault` below,
    /// and used to bias the folder picker's starting directory so the
    /// common case — pointing it at a drive that's actually plugged in — is
    /// as close to zero-navigation as possible.
    fn candidate_mount_dirs() -> Vec<PathBuf> {
        let user = std::env::var("USER").or_else(|_| std::env::var("LOGNAME")).ok();

        let mut bases = Vec::new();
        if let Some(user) = &user {
            bases.push(PathBuf::from("/run/media").join(user));
            bases.push(PathBuf::from("/media").join(user));
        }
        bases.push(PathBuf::from("/media"));
        bases.push(PathBuf::from("/mnt"));

        let mut roots = Vec::new();
        for base in bases {
            if let Ok(entries) = std::fs::read_dir(&base) {
                roots.extend(entries.flatten().map(|entry| entry.path()).filter(|p| p.is_dir()));
            }
        }
        roots
    }

    /// If exactly one currently-mounted removable drive already has a
    /// Lockbox vault on it, that's almost certainly the drive the user
    /// means — the common "this same drive was set up on Windows, now
    /// plugged into this Linux machine" case — so it's used automatically
    /// with no prompt at all. More than one match is left for the folder
    /// picker below to disambiguate, since silently guessing wrong here
    /// would open an unrelated vault instead of erroring loudly.
    fn find_existing_vault() -> Option<PathBuf> {
        let matches: Vec<PathBuf> = candidate_mount_dirs()
            .into_iter()
            .filter(|root| {
                root.join("Vault").join(".lockbox").join("vault.meta.json").is_file()
            })
            .collect();

        match matches.as_slice() {
            [single] => Some(single.clone()),
            _ => None,
        }
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

        // No remembered choice on this machine yet — before asking, check
        // whether a vault set up elsewhere (this same drive, a different OS
        // or machine) is already plugged in and just needs finding.
        if let Some(found) = find_existing_vault() {
            if ensure_layout(&found).is_ok() {
                let _ = remember_root(&found);
                return Ok(found);
            }
        }

        let mut dialog = rfd::FileDialog::new().set_title("Choose a folder for Lockbox's vault");
        if let Some(hint) = candidate_mount_dirs().into_iter().next() {
            dialog = dialog.set_directory(hint);
        }

        let Some(picked) = dialog.pick_folder() else {
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
