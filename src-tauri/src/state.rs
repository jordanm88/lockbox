use crate::crypto::VaultKey;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

pub struct AppState {
    pub root: PathBuf,
    /// Held only for its Drop impl — releases the exclusive instance lock
    /// acquired in `usb_root::acquire_instance_lock` when the app exits.
    /// Never read otherwise.
    pub _instance_lock: std::fs::File,
    pub vault_key: Mutex<Option<VaultKey>>,
    /// App IDs currently mid-install, so a second `install_app` call for the
    /// same app is rejected instead of racing the first one over the same
    /// install directory.
    pub installing_apps: Mutex<HashSet<String>>,
    /// True while an `rclone sync` is running, so a second click can't start
    /// a second sync against the same Vault directory concurrently.
    pub sync_in_progress: Mutex<bool>,
    /// In-progress chunked uploads, keyed by a random session id. Bytes only
    /// land here in memory — nothing touches the vault until `finish_upload`
    /// completes, so a crash or abandoned upload never leaves a partial file.
    pub uploads: Mutex<HashMap<String, Vec<u8>>>,
    /// Decrypted file contents staged for chunked download, keyed by a
    /// random session id, freed once the frontend calls `end_download`.
    pub downloads: Mutex<HashMap<String, Vec<u8>>>,
}

/// Locks `mutex`, recovering from poisoning instead of propagating it.
///
/// A poisoned std::sync::Mutex stays poisoned forever — if any single
/// command ever panicked while holding `vault_key` (or either flag above),
/// every command touching it would then fail for the rest of the process's
/// life, and the only way out would be restarting the whole app. Recovering
/// the guard instead means a transient panic degrades to "that one command
/// failed," not "the vault is now permanently unusable this session."
pub fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
