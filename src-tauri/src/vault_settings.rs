//! Per-vault settings that need encryption but don't belong in the file
//! index: the AI assistant's config (whether it's on, which provider, the
//! API key) and the TOTP 2FA secret. Same split as `vault.meta.json` vs.
//! `vault.index.enc` — one small encrypted JSON blob, sealed with the
//! existing `crypto::encrypt_bytes`/`decrypt_bytes` (no new crypto here).
//!
//! Callers never cache the decrypted result anywhere long-lived (no
//! `AppState` field) — every command that needs a field here calls `load`
//! fresh with whatever `VaultKey` it already has locally, the same way the
//! vault key itself is never written to disk in the clear.

use crate::crypto::{self, VaultKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const SETTINGS_RELATIVE_PATH: &str = ".lockbox/settings.enc";

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct VaultSettings {
    #[serde(default)]
    pub ai_enabled: bool,
    #[serde(default)]
    pub ai_provider: String,
    #[serde(default)]
    pub ai_api_key: Option<String>,
    #[serde(default)]
    pub totp_enabled: bool,
    #[serde(default)]
    pub totp_secret: Option<String>,
}

fn settings_path(vault_dir: &Path) -> std::path::PathBuf {
    vault_dir.join(SETTINGS_RELATIVE_PATH)
}

/// A vault that's never touched these features yet has no settings file at
/// all — that's not an error, it's just every field at its default (AI off,
/// 2FA off).
pub fn load(vault_dir: &Path, key: &VaultKey) -> Result<VaultSettings, String> {
    let path = settings_path(vault_dir);
    let sealed = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(VaultSettings::default()),
        Err(e) => return Err(format!("failed to read vault settings: {e}")),
    };

    let plaintext = crypto::decrypt_bytes(key, &sealed)?;
    serde_json::from_slice(&plaintext).map_err(|e| format!("corrupt vault settings: {e}"))
}

pub fn save(vault_dir: &Path, key: &VaultKey, settings: &VaultSettings) -> Result<(), String> {
    let path = settings_path(vault_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create vault directory: {e}"))?;
    }

    let plaintext = serde_json::to_vec(settings).map_err(|e| format!("failed to serialize vault settings: {e}"))?;
    let sealed = crypto::encrypt_bytes(key, &plaintext)?;
    fs::write(&path, sealed).map_err(|e| format!("failed to write vault settings: {e}"))
}
