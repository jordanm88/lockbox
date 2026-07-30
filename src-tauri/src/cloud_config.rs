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

pub fn validate(config: &CloudRemoteConfig) -> Result<(), String> {
    match config {
        CloudRemoteConfig::S3 {
            bucket,
            access_key_id,
            secret_access_key,
            ..
        } => {
            if bucket.trim().is_empty() {
                return Err("S3 bucket is required".to_string());
            }
            if access_key_id.trim().is_empty() {
                return Err("S3 access key id is required".to_string());
            }
            if secret_access_key.trim().is_empty() {
                return Err("S3 secret access key is required".to_string());
            }
        }
        CloudRemoteConfig::WebDav {
            url,
            username,
            password,
            ..
        } => {
            let normalized = url.trim();
            if normalized.is_empty() {
                return Err("WebDAV server URL is required".to_string());
            }
            if !(normalized.starts_with("http://") || normalized.starts_with("https://")) {
                return Err("WebDAV URL must start with http:// or https://".to_string());
            }
            if username.trim().is_empty() {
                return Err("WebDAV username is required".to_string());
            }
            if password.is_empty() {
                return Err("WebDAV password is required".to_string());
            }
        }
        CloudRemoteConfig::Ftp {
            host,
            username,
            password,
            ..
        } => {
            if host.trim().is_empty() {
                return Err("FTP host is required".to_string());
            }
            if username.trim().is_empty() {
                return Err("FTP username is required".to_string());
            }
            if password.is_empty() {
                return Err("FTP password is required".to_string());
            }
        }
    }

    Ok(())
}

pub fn save(vault_dir: &Path, key: &VaultKey, config: &CloudRemoteConfig) -> Result<(), String> {
    validate(config)?;
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
