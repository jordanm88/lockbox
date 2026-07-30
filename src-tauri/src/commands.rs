use crate::state::{lock_recover, AppState};
use crate::{crypto, paths, usb_root};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize)]
pub struct VaultFileEntry {
    name: String,
    size: u64,
}

#[tauri::command]
pub fn unlock_vault(state: State<AppState>, passphrase: String) -> Result<bool, String> {
    let vault_dir = usb_root::vault_dir(&state.root);
    let outcome = crypto::unlock(&vault_dir, &passphrase)?;

    let mut guard = lock_recover(&state.vault_key);

    match outcome {
        Some(key) => {
            *guard = Some(key);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
pub fn lock_vault(state: State<AppState>) -> Result<(), String> {
    let mut guard = lock_recover(&state.vault_key);
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn encrypt_and_save_file(
    state: State<AppState>,
    file_bytes: Vec<u8>,
    relative_dest: String,
) -> Result<String, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let requested_path = paths::safe_join(&vault_dir, &relative_dest)?;
    let dest_path = unique_dest_path(requested_path);

    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("failed to create directory: {e}"))?;
    }

    let sealed = crypto::encrypt_bytes(key, &file_bytes)?;
    std::fs::write(&dest_path, sealed).map_err(|e| format!("failed to write file: {e}"))?;

    let saved_relative = dest_path
        .strip_prefix(&vault_dir)
        .map_err(|_| "internal error computing saved path".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    Ok(saved_relative)
}

/// If `path` already exists, finds the first "name (1).ext", "name (2).ext",
/// ... variant that doesn't — so uploading a same-named file never silently
/// clobbers an existing one. Returns `path` unchanged when there's no
/// collision.
fn unique_dest_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let extension = path.extension().and_then(|s| s.to_str()).map(str::to_string);
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();

    for n in 1..10_000u32 {
        let candidate_name = match &extension {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    // Practically unreachable, but never return a colliding path: fall back
    // to a nanosecond-timestamped name instead of giving up.
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let fallback_name = match &extension {
        Some(ext) => format!("{stem}-{suffix}.{ext}"),
        None => format!("{stem}-{suffix}"),
    };
    parent.join(fallback_name)
}

#[tauri::command]
pub fn read_and_decrypt_file(
    state: State<AppState>,
    relative_path: String,
) -> Result<Vec<u8>, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let src_path = paths::safe_join(&vault_dir, &relative_path)?;

    let sealed = std::fs::read(&src_path).map_err(|e| format!("failed to read file: {e}"))?;
    crypto::decrypt_bytes(key, &sealed)
}

#[tauri::command]
pub fn list_vault_files(state: State<AppState>) -> Result<Vec<VaultFileEntry>, String> {
    let vault_dir = usb_root::vault_dir(&state.root);
    let mut entries = Vec::new();

    let read_dir =
        std::fs::read_dir(&vault_dir).map_err(|e| format!("failed to read vault: {e}"))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("failed to read vault entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // skips the .lockbox metadata directory
        }
        let metadata = entry
            .metadata()
            .map_err(|e| format!("failed to stat {name}: {e}"))?;
        if metadata.is_file() {
            entries.push(VaultFileEntry {
                name,
                size: metadata.len(),
            });
        }
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}
