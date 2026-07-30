use crate::crypto::{self, VaultKey};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CLOUD_CONFIG_RELATIVE_PATH: &str = ".lockbox/cloud_config.enc";

/// Remote backup destination. Saved encrypted inside the vault (same
/// ChaCha20-Poly1305 key used for vault files), so it's only readable while
/// the vault is unlocked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "provider")]
pub enum CloudRemoteConfig {
    #[serde(rename = "s3", rename_all = "camelCase")]
    S3 {
        /// Custom S3-compatible endpoint (e.g. Backblaze B2, MinIO). None = real AWS S3.
        endpoint: Option<String>,
        region: Option<String>,
        bucket: String,
        access_key_id: String,
        secret_access_key: String,
        remote_path: String,
    },
    #[serde(rename = "webdav", rename_all = "camelCase")]
    WebDav {
        url: String,
        username: String,
        password: String,
        remote_path: String,
    },
    #[serde(rename = "ftp", rename_all = "camelCase")]
    Ftp {
        host: String,
        port: Option<u16>,
        username: String,
        password: String,
        remote_path: String,
    },
}

fn config_path(vault_dir: &Path) -> PathBuf {
    vault_dir.join(CLOUD_CONFIG_RELATIVE_PATH)
}

pub fn save(vault_dir: &Path, key: &VaultKey, config: &CloudRemoteConfig) -> Result<(), String> {
    let json = serde_json::to_vec(config)
        .map_err(|e| format!("failed to serialize cloud config: {e}"))?;
    let sealed = crypto::encrypt_bytes(key, &json)?;

    let path = config_path(vault_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config directory: {e}"))?;
    }
    std::fs::write(&path, sealed).map_err(|e| format!("failed to write cloud config: {e}"))
}

pub fn load(vault_dir: &Path, key: &VaultKey) -> Result<Option<CloudRemoteConfig>, String> {
    let path = config_path(vault_dir);
    if !path.exists() {
        return Ok(None);
    }

    let sealed = std::fs::read(&path).map_err(|e| format!("failed to read cloud config: {e}"))?;
    let json = crypto::decrypt_bytes(key, &sealed)?;
    let config =
        serde_json::from_slice(&json).map_err(|e| format!("corrupt cloud config: {e}"))?;
    Ok(Some(config))
}
