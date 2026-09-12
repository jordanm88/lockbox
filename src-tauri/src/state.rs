use crate::crypto::VaultKey;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::SystemTime;

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
    /// True while `change_passphrase` is re-encrypting the vault, so a
    /// second call (e.g. a double-clicked button) can't start a second
    /// re-encryption pass racing the first one over the same blobs. Doesn't
    /// guard against an *unrelated* command (an upload, a delete) landing
    /// mid-reencryption — that narrower race is accepted, not solved, for
    /// now; see `commands::change_passphrase`.
    pub changing_passphrase: Mutex<bool>,
    /// In-progress chunked uploads, keyed by a random session id. Bytes only
    /// land here in memory — nothing touches the vault until `finish_upload`
    /// completes, so a crash or abandoned upload never leaves a partial file.
    pub uploads: Mutex<HashMap<String, Vec<u8>>>,
    /// Decrypted file contents staged for chunked download, keyed by a
    /// random session id, freed once the frontend calls `end_download`.
    pub downloads: Mutex<HashMap<String, Vec<u8>>>,
    /// Per-folder cache for `store_commands::scan_third_party_apps`, keyed
    /// by folder name under `Third Party Apps/`: that folder's own mtime as
    /// of the last scan, paired with the launcher path resolved then. See
    /// that function for why this exists and what it doesn't catch.
    pub third_party_scan_cache: Mutex<HashMap<String, (SystemTime, Option<String>)>>,
    /// A freshly generated 2FA secret, staged here only until the user
    /// confirms it with a code from their authenticator app (`totp::
    /// confirm_totp_setup`) — nothing touches disk until then, so an
    /// abandoned setup leaves no trace. Cleared on lock too (`lock_vault`).
    pub pending_totp_secret: Mutex<Option<String>>,
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
