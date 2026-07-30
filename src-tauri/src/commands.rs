use crate::state::{lock_recover, AppState};
use crate::{crypto, paths, usb_root};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize)]
pub struct VaultFileEntry {
    name: String,
    size: u64,
    is_dir: bool,
}

#[derive(Serialize, Deserialize)]
struct VaultIndexEntry {
    original_path: String,
    blob_name: Option<String>,
    is_dir: bool,
    size: Option<u64>,
}

#[derive(Serialize, Deserialize)]
struct VaultIndex {
    entries: Vec<VaultIndexEntry>,
}

const INDEX_RELATIVE_PATH: &str = ".lockbox/vault.index.enc";
const DATA_RELATIVE_PATH: &str = ".lockbox/data";

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
pub fn vault_exists(state: State<AppState>) -> Result<bool, String> {
    let vault_dir = usb_root::vault_dir(&state.root);
    let meta_path = vault_dir.join(".lockbox").join("vault.meta.json");
    Ok(meta_path.exists())
}

#[tauri::command]
pub fn encrypt_and_save_file(
    state: State<AppState>,
    file_bytes: Vec<u8>,
    relative_dest: String,
) -> Result<String, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let normalized_dest = normalize_relative_path(&relative_dest)?;
    let vault_dir = usb_root::vault_dir(&state.root);
    let mut index = load_or_upgrade_index(&vault_dir, key)?;

    let saved_relative = unique_original_path(&index, &normalized_dest);
    ensure_parent_directories(&mut index, &saved_relative);

    let data_dir = ensure_data_dir(&vault_dir)?;
    let blob_name = unique_blob_name(&data_dir)?;
    let sealed = crypto::encrypt_bytes(key, &file_bytes)?;
    fs::write(data_dir.join(&blob_name), sealed)
        .map_err(|e| format!("failed to write file: {e}"))?;

    index.entries.push(VaultIndexEntry {
        original_path: saved_relative.clone(),
        blob_name: Some(blob_name),
        is_dir: false,
        size: Some(file_bytes.len() as u64),
    });

    save_index(&vault_dir, key, &index)?;
    Ok(saved_relative)
}

fn unique_original_path(index: &VaultIndex, requested: &str) -> String {
    if !index.entries.iter().any(|entry| entry.original_path == requested) {
        return requested.to_string();
    }

    let requested_path = Path::new(requested);
    let parent = requested_path.parent();
    let stem = requested_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let extension = requested_path.extension().and_then(|s| s.to_str());

    for n in 1..10_000u32 {
        let candidate_name = match extension {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = if let Some(parent) = parent {
            parent.join(candidate_name).to_string_lossy().replace('\\', "/")
        } else {
            candidate_name
        };
        if !index.entries.iter().any(|entry| entry.original_path == candidate) {
            return candidate;
        }
    }

    panic!("too many duplicate paths")
}

fn ensure_parent_directories(index: &mut VaultIndex, path: &str) {
    let mut current = Path::new(path);
    let mut pending = Vec::new();

    while let Some(parent) = current.parent() {
        let parent_str = parent.to_string_lossy().replace('\\', "/");
        if parent_str.is_empty() {
            break;
        }
        pending.push(parent_str);
        current = parent;
    }

    pending.reverse();
    for dir in pending {
        if !index.entries.iter().any(|entry| entry.original_path == dir) {
            index.entries.push(VaultIndexEntry {
                original_path: dir,
                blob_name: None,
                is_dir: true,
                size: None,
            });
        }
    }
}

fn data_dir(vault_dir: &Path) -> PathBuf {
    vault_dir.join(DATA_RELATIVE_PATH)
}

fn index_path(vault_dir: &Path) -> PathBuf {
    vault_dir.join(INDEX_RELATIVE_PATH)
}

fn ensure_data_dir(vault_dir: &Path) -> Result<PathBuf, String> {
    let dir = data_dir(vault_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create data directory: {e}"))?;
    Ok(dir)
}

fn unique_blob_name(data_dir: &Path) -> Result<String, String> {
    for _ in 0..10_000 {
        let mut bytes = [0u8; 16];
        OsRng.fill_bytes(&mut bytes);
        let candidate = hex::encode(bytes);
        let candidate_path = data_dir.join(&candidate);
        if !candidate_path.exists() {
            return Ok(candidate);
        }
    }
    Err("failed to generate unique blob name".to_string())
}

fn load_or_upgrade_index(vault_dir: &Path, key: &crypto::VaultKey) -> Result<VaultIndex, String> {
    let mut index = load_index(vault_dir, key)?;
    if index.entries.is_empty() && has_plaintext_vault_data(vault_dir)? {
        migrate_plaintext_vault(vault_dir, key, &mut index)?;
        save_index(vault_dir, key, &index)?;
    }
    Ok(index)
}

fn has_plaintext_vault_data(vault_dir: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(vault_dir).map_err(|e| format!("failed to inspect vault contents: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read vault entry: {e}"))?;
        let name = entry.file_name();
        if name == ".lockbox" {
            continue;
        }
        return Ok(true);
    }
    Ok(false)
}

fn migrate_plaintext_vault(vault_dir: &Path, key: &crypto::VaultKey, index: &mut VaultIndex) -> Result<(), String> {
    let data_dir = ensure_data_dir(vault_dir)?;
    migrate_plaintext_dir(vault_dir, vault_dir, key, index, &data_dir)?;
    remove_empty_plaintext_dirs(vault_dir, vault_dir)
}

fn migrate_plaintext_dir(
    base_dir: &Path,
    dir: &Path,
    key: &crypto::VaultKey,
    index: &mut VaultIndex,
    data_dir: &Path,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("failed to read vault entry: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read vault entry: {e}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base_dir)
            .map_err(|_| "internal error computing vault path".to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        if relative == ".lockbox" || relative.starts_with(".lockbox/") {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|e| format!("failed to stat {}: {e}", entry.file_name().to_string_lossy()))?;

        if metadata.is_dir() {
            if !index.entries.iter().any(|entry| entry.original_path == relative) {
                index.entries.push(VaultIndexEntry {
                    original_path: relative.clone(),
                    blob_name: None,
                    is_dir: true,
                    size: None,
                });
            }
            migrate_plaintext_dir(base_dir, &path, key, index, data_dir)?;
            if fs::read_dir(&path).map_err(|e| format!("failed to scan directory after migration: {e}"))?.next().is_none() {
                fs::remove_dir(&path).map_err(|e| format!("failed to remove empty folder: {e}"))?;
            }
        } else if metadata.is_file() {
            let blob_name = unique_blob_name(data_dir)?;
            let bytes = fs::read(&path).map_err(|e| format!("failed to read vault file: {e}"))?;
            let sealed = crypto::encrypt_bytes(key, &bytes)?;
            fs::write(data_dir.join(&blob_name), sealed)
                .map_err(|e| format!("failed to write encrypted blob: {e}"))?;
            fs::remove_file(&path).map_err(|e| format!("failed to remove plaintext file: {e}"))?;

            index.entries.push(VaultIndexEntry {
                original_path: relative,
                blob_name: Some(blob_name),
                is_dir: false,
                size: Some(metadata.len()),
            });
        }
    }
    Ok(())
}

fn remove_empty_plaintext_dirs(base_dir: &Path, dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("failed to read vault directory: {e}"))? {
        let entry = entry.map_err(|e| format!("failed to read vault directory: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            remove_empty_plaintext_dirs(base_dir, &path)?;
        }
    }

    if dir != base_dir {
        let relative = dir
            .strip_prefix(base_dir)
            .map_err(|_| "internal error computing vault path".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if relative == ".lockbox" || relative.starts_with(".lockbox/") {
            return Ok(());
        }
        if fs::read_dir(dir).map_err(|e| format!("failed to scan directory: {e}"))?.next().is_none() {
            fs::remove_dir(dir).map_err(|e| format!("failed to remove empty folder: {e}"))?;
        }
    }

    Ok(())
}

fn load_index(vault_dir: &Path, key: &crypto::VaultKey) -> Result<VaultIndex, String> {
    let path = index_path(vault_dir);
    if !path.exists() {
        return Ok(VaultIndex { entries: Vec::new() });
    }

    let sealed = fs::read(&path).map_err(|e| format!("failed to read vault index: {e}"))?;
    let plaintext = crypto::decrypt_bytes(key, &sealed)?;
    let index: VaultIndex = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("invalid vault index: {e}"))?;
    Ok(index)
}

fn save_index(vault_dir: &Path, key: &crypto::VaultKey, index: &VaultIndex) -> Result<(), String> {
    let serialized = serde_json::to_vec(index)
        .map_err(|e| format!("failed to serialize vault index: {e}"))?;
    let sealed = crypto::encrypt_bytes(key, &serialized)?;

    let path = index_path(vault_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create index directory: {e}"))?;
    }
    fs::write(path, sealed).map_err(|e| format!("failed to write vault index: {e}"))
}

fn get_entry_for_path<'a>(index: &'a VaultIndex, path: &str) -> Option<&'a VaultIndexEntry> {
    index.entries.iter().find(|entry| entry.original_path == path)
}

fn get_entry_for_path_mut<'a>(index: &'a mut VaultIndex, path: &str) -> Option<&'a mut VaultIndexEntry> {
    index.entries.iter_mut().find(|entry| entry.original_path == path)
}

fn prune_empty_directories(index: &mut VaultIndex) {
    loop {
        let mut removed_any = false;

        let mut i = 0usize;
        while i < index.entries.len() {
            if !index.entries[i].is_dir {
                i += 1;
                continue;
            }

            let dir = index.entries[i].original_path.clone();
            let has_children = index.entries.iter().enumerate().any(|(j, entry)| {
                j != i && entry.original_path.starts_with(&format!("{dir}/"))
            });

            if !has_children {
                index.entries.remove(i);
                removed_any = true;
            } else {
                i += 1;
            }
        }

        if !removed_any {
            break;
        }
    }
}

fn normalize_relative_path(path: &str) -> Result<String, String> {
    let normalized = Path::new(path);
    if normalized.as_os_str().is_empty() {
        return Err("path must not be empty".to_string());
    }
    if normalized.is_absolute() {
        return Err("path must be relative".to_string());
    }

    let mut components = Vec::new();
    for component in normalized.components() {
        match component {
            std::path::Component::Normal(os_str) => {
                if os_str.is_empty() {
                    return Err(format!("invalid path component in '{path}'"));
                }
                components.push(os_str.to_string_lossy());
            }
            _ => return Err(format!("invalid path component in '{path}'")),
        }
    }

    if components.is_empty() {
        return Err("path must not be empty".to_string());
    }

    Ok(components.join("/"))
}

#[tauri::command]
pub fn read_and_decrypt_file(
    state: State<AppState>,
    relative_path: String,
) -> Result<Vec<u8>, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let index = load_or_upgrade_index(&vault_dir, key)?;
    let normalized = normalize_relative_path(&relative_path)?;
    let entry = get_entry_for_path(&index, &normalized)
        .ok_or("file not found")?;
    if entry.is_dir {
        return Err("path is a directory".to_string());
    }
    let blob_name = entry
        .blob_name
        .as_ref()
        .ok_or("missing blob mapping for file")?;

    let sealed = fs::read(data_dir(&vault_dir).join(blob_name))
        .map_err(|e| format!("failed to read encrypted file: {e}"))?;
    crypto::decrypt_bytes(key, &sealed)
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let mut index = load_or_upgrade_index(&vault_dir, key)?;
    let normalized = normalize_relative_path(&relative_path)?;

    if let Some(existing) = get_entry_for_path(&index, &normalized) {
        if existing.is_dir {
            return Ok(());
        }
        return Err("file already exists with that name".to_string());
    }

    ensure_parent_directories(&mut index, &normalized);
    index.entries.push(VaultIndexEntry {
        original_path: normalized,
        blob_name: None,
        is_dir: true,
        size: None,
    });
    save_index(&vault_dir, key, &index)
}

#[tauri::command]
pub fn list_vault_files(state: State<AppState>) -> Result<Vec<VaultFileEntry>, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let index = load_or_upgrade_index(&vault_dir, key)?;

    let mut entries = index
        .entries
        .iter()
        .map(|entry| VaultFileEntry {
            name: entry.original_path.clone(),
            size: entry.size.unwrap_or(0),
            is_dir: entry.is_dir,
        })
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub fn delete_vault_entry(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let mut index = load_or_upgrade_index(&vault_dir, key)?;
    let normalized = normalize_relative_path(&relative_path)?;

    // Collect entries to remove: exact match and, for directories, any children
    let mut to_remove = Vec::new();
    for (i, entry) in index.entries.iter().enumerate() {
        if entry.original_path == normalized || entry.original_path.starts_with(&format!("{}/", normalized)) {
            to_remove.push(i);
        }
    }

    if to_remove.is_empty() {
        return Err("path not found".to_string());
    }

    // Remove blobs for the entries we're deleting
    let data_dir = ensure_data_dir(&vault_dir)?;
    // iterate in reverse so indices are stable when removing
    to_remove.sort_unstable_by(|a, b| b.cmp(a));
    for idx in to_remove {
        if let Some(entry) = index.entries.get(idx) {
            if let Some(blob) = &entry.blob_name {
                let _ = fs::remove_file(data_dir.join(blob));
            }
        }
        index.entries.remove(idx);
    }

    prune_empty_directories(&mut index);

    save_index(&vault_dir, key, &index)?;
    Ok(())
}

#[tauri::command]
pub fn uninstall_app(state: State<AppState>, app_id: String) -> Result<(), String> {
    let root = &state.root;
    let apps_dir = usb_root::apps_dir(root);
    let target = apps_dir.join(&app_id);
    if !target.exists() {
        return Err("app not found".to_string());
    }
    fs::remove_dir_all(&target).map_err(|e| format!("failed to remove app: {e}"))?;
    Ok(())
}
