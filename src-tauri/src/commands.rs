use crate::state::{lock_recover, AppState};
use crate::{crypto, usb_root};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

// `rename_all = "camelCase"` is load-bearing here, not cosmetic: the
// frontend's matching `VaultFileEntry` interface (vaultBridge.ts) declares
// `isDir`, and without this attribute serde emits the field as `is_dir`
// (Rust's own naming), which the frontend then never sees — `entry.isDir`
// silently reads as `undefined` or every single entry, folder or file
// alike. That's indistinguishable from `false` in every place this gets
// checked (icon, "Open" vs "View", click routing), so every folder rendered
// and behaved exactly like a file — this one missing attribute was the
// entire "folders act like files" bug, not the index-corruption theory
// earlier fixes here were chasing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFileEntry {
    name: String,
    size: u64,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    path: String,
    size: u64,
    is_dir: bool,
    deleted_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct VaultIndexEntry {
    original_path: String,
    blob_name: Option<String>,
    is_dir: bool,
    size: Option<u64>,
    /// `Some(unix_seconds)` while sitting in `VaultIndex::trash`, `None`
    /// everywhere else — see `delete_vault_entry`. `#[serde(default)]` so
    /// entries written before trash existed (no field at all) deserialize
    /// as "not deleted" rather than failing to parse.
    #[serde(default)]
    deleted_at: Option<u64>,
}

#[derive(Serialize, Deserialize)]
struct VaultIndex {
    entries: Vec<VaultIndexEntry>,
    /// Soft-deleted entries, moved here by `delete_vault_entry` instead of
    /// being removed outright — their blobs stay on disk untouched.
    /// Deliberately a separate list rather than filtering `entries` by
    /// `deleted_at`: every other function in this file already only ever
    /// looks at `entries`, so moving something out of that list is by
    /// itself enough to make it vanish from listings, uniqueness checks,
    /// and everywhere else — no other call site needed to change at all.
    /// `#[serde(default)]` so an index written before trash existed (no
    /// field at all) deserializes as "nothing in trash" instead of failing
    /// to parse.
    #[serde(default)]
    trash: Vec<VaultIndexEntry>,
}

fn now_unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

const INDEX_RELATIVE_PATH: &str = ".lockbox/vault.index.enc";
const DATA_RELATIVE_PATH: &str = ".lockbox/data";
/// Generous cap on a single chunked transfer's total size — mainly a guard
/// against a runaway frontend loop growing an in-memory buffer without
/// bound, same spirit as the app-store installer's download cap.
const MAX_TRANSFER_BYTES: usize = 8 * 1024 * 1024 * 1024;

fn random_session_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

// `async` dispatches this off the main thread instead of on it (see the
// longer explanation on `store_commands::install_app`) — Argon2id key
// derivation is deliberately CPU-expensive, which otherwise froze the whole
// window on every single unlock attempt.
#[tauri::command(async)]
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

/// Changes the vault's passphrase. Every blob is encrypted directly with the
/// key derived from the passphrase — there's no separate data-encryption
/// key wrapped by it — so unlike, say, most password managers, this can't
/// just re-wrap one small secret: it has to re-encrypt every single file in
/// the vault, plus the index, under the new key.
///
/// That's real work that can fail partway through (disk full, drive pulled,
/// process killed), so everything is staged under `.new`-suffixed sibling
/// files first — nothing touches a real, working file until every blob,
/// the index, *and* the metadata have all been successfully re-encrypted.
/// Only then are they swapped into place with a run of renames (each
/// individually atomic). If anything fails before that swap phase, every
/// staged file is cleaned up and the vault is left exactly as it was,
/// fully readable under the old passphrase — safe to just retry. The
/// remaining, much smaller risk window is the swap phase itself (a crash
/// between renaming the first and last file) — see the ordering note below
/// for why blobs go first and the metadata commits last.
///
/// `async`: re-encrypting every blob in a large vault is real, scaling
/// work — see `store_commands::install_app` for why a plain `fn` would
/// otherwise block the main thread for all of it.
#[tauri::command(async)]
pub fn change_passphrase(
    state: State<AppState>,
    current_passphrase: String,
    new_passphrase: String,
) -> Result<(), String> {
    // Reject a second concurrent call rather than letting two re-encryption
    // passes race over the same blobs — same guard shape as
    // `cloud_commands::sync_vault_now`'s `sync_in_progress`.
    {
        let mut in_progress = lock_recover(&state.changing_passphrase);
        if *in_progress {
            return Err("a passphrase change is already in progress".to_string());
        }
        *in_progress = true;
    }

    let result = change_passphrase_inner(&state, &current_passphrase, &new_passphrase);

    *lock_recover(&state.changing_passphrase) = false;

    result
}

fn change_passphrase_inner(
    state: &AppState,
    current_passphrase: &str,
    new_passphrase: &str,
) -> Result<(), String> {
    if new_passphrase.is_empty() {
        return Err("new passphrase must not be empty".to_string());
    }

    let vault_dir = usb_root::vault_dir(&state.root);

    // Re-verified against the vault's own stored credentials, not just
    // trusted from whatever's cached in memory — a typo here has to fail
    // loudly and immediately, before anything is touched, rather than
    // silently starting to re-encrypt under a key derived from the wrong
    // old passphrase (which would make every blob permanently
    // un-decryptable — there's no "undo" once that starts).
    let old_key = crypto::unlock(&vault_dir, current_passphrase)?
        .ok_or_else(|| "current passphrase is incorrect".to_string())?;

    let index = load_or_upgrade_index(&vault_dir, &old_key)?;
    let data_dir = data_dir(&vault_dir);

    let (new_key, staged_meta_path) = crypto::stage_new_credentials(&vault_dir, new_passphrase)?;

    let mut staged_blobs: Vec<(PathBuf, PathBuf)> = Vec::new();
    macro_rules! abort_and_cleanup {
        ($err:expr) => {{
            for (_, staged) in &staged_blobs {
                let _ = fs::remove_file(staged);
            }
            let _ = fs::remove_file(&staged_meta_path);
            return Err($err);
        }};
    }

    for entry in &index.entries {
        let Some(blob_name) = &entry.blob_name else { continue };
        let real_path = data_dir.join(blob_name);
        let mut staged_path = real_path.clone().into_os_string();
        staged_path.push(".new");
        let staged_path = PathBuf::from(staged_path);

        let result = fs::read(&real_path)
            .map_err(|e| format!("failed to read {blob_name}: {e}"))
            .and_then(|sealed| crypto::decrypt_bytes(&old_key, &sealed))
            .and_then(|plaintext| crypto::encrypt_bytes(&new_key, &plaintext))
            .and_then(|resealed| {
                fs::write(&staged_path, resealed)
                    .map_err(|e| format!("failed to stage re-encrypted {blob_name}: {e}"))
            });

        match result {
            Ok(()) => staged_blobs.push((real_path, staged_path)),
            Err(e) => abort_and_cleanup!(e),
        }
    }

    // The index gets re-encrypted (not re-derived) the same way every other
    // command reads/writes it — serialize, encrypt, write — just staged
    // like the blobs above instead of going straight to the real path.
    let staged_index_path = {
        let mut p = index_path(&vault_dir).into_os_string();
        p.push(".new");
        PathBuf::from(p)
    };
    let serialized = match serde_json::to_vec(&index) {
        Ok(bytes) => bytes,
        Err(e) => abort_and_cleanup!(format!("failed to serialize vault index: {e}")),
    };
    let sealed_index = match crypto::encrypt_bytes(&new_key, &serialized) {
        Ok(sealed) => sealed,
        Err(e) => abort_and_cleanup!(e),
    };
    if let Err(e) = fs::write(&staged_index_path, sealed_index) {
        abort_and_cleanup!(format!("failed to stage re-encrypted index: {e}"));
    }

    // Everything staged successfully — swap it all into place. Blobs and
    // the index first, the metadata last: the metadata is what actually
    // makes the new passphrase "real" (it's the only thing `crypto::unlock`
    // checks), so committing it last means the tiny window where a crash
    // mid-swap could leave things inconsistent always favors the old
    // passphrase still working, never the new passphrase "succeeding"
    // against a vault that's only partly re-encrypted.
    for (real_path, staged_path) in &staged_blobs {
        fs::rename(staged_path, real_path).map_err(|e| {
            format!(
                "failed partway through finalizing the passphrase change: {e}. Some files may now \
                 be re-encrypted and some not — do not delete anything; try changing the \
                 passphrase again, or restore from a backup if problems persist."
            )
        })?;
    }
    fs::rename(&staged_index_path, index_path(&vault_dir))
        .map_err(|e| format!("failed to finalize the re-encrypted index: {e}"))?;
    crypto::commit_new_credentials(&vault_dir, &staged_meta_path)?;

    *lock_recover(&state.vault_key) = Some(new_key);
    Ok(())
}

#[tauri::command]
pub fn vault_exists(state: State<AppState>) -> Result<bool, String> {
    let vault_dir = usb_root::vault_dir(&state.root);
    let meta_path = vault_dir.join(".lockbox").join("vault.meta.json");
    Ok(meta_path.exists())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultVerifyIssue {
    path: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultVerifyReport {
    files_checked: u64,
    broken: Vec<VaultVerifyIssue>,
    orphaned_blobs: Vec<String>,
}

/// Walks every file entry in the vault index, confirming its blob exists on
/// disk and actually decrypts — catching bit rot, a partial write from an
/// interrupted operation, or a blob deleted out from under the index by
/// something other than Lockbox itself, none of which show up until you
/// happen to open that exact file. Also flags blobs sitting in the data
/// directory that no index entry references at all — a leftover with no
/// automatic cleanup, though a harmless one (nothing reads it, it's just
/// using space).
///
/// `async`: reads and decrypts every blob in the vault — real, scaling
/// work for a large vault, same reasoning as `change_passphrase`.
#[tauri::command(async)]
pub fn verify_vault(state: State<AppState>) -> Result<VaultVerifyReport, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let index = load_or_upgrade_index(&vault_dir, key)?;
    let data_dir = data_dir(&vault_dir);

    let mut referenced_blobs = std::collections::HashSet::new();
    let mut broken = Vec::new();
    let mut files_checked = 0u64;

    // Trashed files are checked too (their blobs are still real, still
    // meant to be readable if restored) and, just as importantly, counted
    // as "referenced" below — otherwise every single deleted-but-not-yet-
    // emptied file would incorrectly show up as an orphaned blob.
    let live_and_trashed = index.entries.iter().chain(index.trash.iter());

    for entry in live_and_trashed {
        let Some(blob_name) = &entry.blob_name else { continue };
        referenced_blobs.insert(blob_name.clone());
        files_checked += 1;

        let result = fs::read(data_dir.join(blob_name))
            .map_err(|e| format!("blob missing or unreadable: {e}"))
            .and_then(|sealed| {
                crypto::decrypt_bytes(key, &sealed)
                    .map_err(|_| "failed to decrypt (corrupt, or blob doesn't match this key)".to_string())
            });

        if let Err(reason) = result {
            let path = if entry.deleted_at.is_some() {
                format!("{} (in trash)", entry.original_path)
            } else {
                entry.original_path.clone()
            };
            broken.push(VaultVerifyIssue { path, reason });
        }
    }

    let mut orphaned_blobs = Vec::new();
    if let Ok(entries) = fs::read_dir(&data_dir) {
        for entry in entries.flatten() {
            if !entry.path().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !referenced_blobs.contains(&name) {
                orphaned_blobs.push(name);
            }
        }
    }
    orphaned_blobs.sort();

    Ok(VaultVerifyReport {
        files_checked,
        broken,
        orphaned_blobs,
    })
}

/// Surfaces where the vault actually lives. Mainly relevant on Linux, where
/// (unlike the Windows portable exe) that folder isn't necessarily next to
/// the running binary — see `usb_root::find_usb_root` — so Settings shows
/// this to make the remembered choice visible.
#[tauri::command]
pub fn get_vault_root(state: State<AppState>) -> Result<String, String> {
    Ok(state.root.to_string_lossy().to_string())
}

/// Whether a vault-root override (from `set_vault_root_override`) is
/// currently configured, and what it's set to — for Settings to show what's
/// active, distinct from `get_vault_root` above, which reports where the
/// vault ended up *this session* (the override if one applied, or wherever
/// default resolution landed otherwise).
#[tauri::command]
pub fn get_vault_root_override() -> Option<String> {
    usb_root::vault_root_override().map(|p| p.to_string_lossy().to_string())
}

/// Points Lockbox at a different vault folder from the *next* launch on —
/// deliberately not live. `AppState.root` (and the instance lock tied to
/// it) are established once at startup and read by nearly every command in
/// this crate; making that swappable mid-session would mean auditing every
/// one of those call sites for "what if root changes out from under me
/// mid-operation," a much larger and riskier change than this setting is
/// worth. The frontend is responsible for making clear that choosing a
/// folder here does *not* move the current vault's data there — it only
/// changes where Lockbox looks next time, which may be an entirely empty
/// folder if nothing's there yet.
#[tauri::command]
pub fn set_vault_root_override(new_path: String) -> Result<(), String> {
    usb_root::set_vault_root_override(Path::new(&new_path)).map_err(|e| e.to_string())
}

/// Forgets the override, reverting to the default exe-relative resolution
/// (and, on Linux, the remembered-or-picked fallback) from the next launch
/// on — also not live, same reasoning as `set_vault_root_override`.
#[tauri::command]
pub fn clear_vault_root_override() -> Result<(), String> {
    usb_root::clear_vault_root_override().map_err(|e| e.to_string())
}

/// Lets the frontend pick platform-specific copy (BitLocker/VeraCrypt vs.
/// LUKS wording, eject phrasing, …) without needing a whole OS-detection
/// plugin dependency for what's otherwise just a couple of static strings.
#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    vault_used_bytes: u64,
    drive_total_bytes: Option<u64>,
    drive_free_bytes: Option<u64>,
}

/// Powers the Dropbox/Drive-style storage meter in the sidebar. Vault usage
/// is the sum of every file entry's plaintext `size` already recorded in the
/// vault index (encrypted blobs are within ~28 bytes/file of that, close
/// enough to display) — not a filesystem walk: the index is decrypted here
/// anyway, and it's the same data every upload/delete already keeps
/// accurate, so re-deriving it from disk on every meter refresh (this runs
/// on a 20s timer — see `StorageMeter.tsx`) was pure wasted I/O that only
/// got slower as the vault grew. Drive totals still come from the
/// filesystem the USB root lives on, so the meter reflects the actual
/// drive's capacity, not some fixed/fake quota.
///
/// Only reachable while unlocked (the sidebar that renders `StorageMeter`
/// doesn't exist until then), so `vault_key` is always `Some` in practice —
/// the `unwrap_or(0)` fallback is defensive, not an expected path.
#[tauri::command(async)]
pub fn get_storage_info(state: State<AppState>) -> Result<StorageInfo, String> {
    let vault_dir = usb_root::vault_dir(&state.root);

    // Trash is included: a "deleted" blob still occupies real disk space
    // until it's actually purged (see delete_vault_entry) — reporting usage
    // as though it were already freed would make this meter quietly
    // wrong (lower than the drive's *actual* free space) for as long as
    // anything sits in trash.
    let vault_used_bytes: u64 = lock_recover(&state.vault_key)
        .as_ref()
        .and_then(|key| load_index(&vault_dir, key).ok())
        .map(|index| {
            index
                .entries
                .iter()
                .chain(index.trash.iter())
                .filter(|entry| !entry.is_dir)
                .filter_map(|entry| entry.size)
                .sum()
        })
        .unwrap_or(0);

    let drive_total_bytes = fs4::total_space(&state.root).ok();
    let drive_free_bytes = fs4::available_space(&state.root).ok();

    Ok(StorageInfo {
        vault_used_bytes,
        drive_total_bytes,
        drive_free_bytes,
    })
}

/// Shared by the chunked upload path below. Takes fully-assembled plaintext
/// bytes and does the actual encrypt + index update.
fn save_encrypted_file(
    vault_dir: &Path,
    key: &crypto::VaultKey,
    relative_dest: &str,
    file_bytes: Vec<u8>,
) -> Result<String, String> {
    let normalized_dest = normalize_relative_path(relative_dest)?;
    let mut index = load_or_upgrade_index(vault_dir, key)?;

    let saved_relative = unique_original_path(&index, &normalized_dest);
    ensure_parent_directories(&mut index, &saved_relative)?;

    let data_dir = ensure_data_dir(vault_dir)?;
    let blob_name = unique_blob_name(&data_dir)?;
    let file_len = file_bytes.len() as u64;
    let sealed = crypto::encrypt_bytes(key, &file_bytes)?;
    fs::write(data_dir.join(&blob_name), sealed)
        .map_err(|e| format!("failed to write file: {e}"))?;

    index.entries.push(VaultIndexEntry {
        original_path: saved_relative.clone(),
        blob_name: Some(blob_name),
        is_dir: false,
        size: Some(file_len),
        deleted_at: None,
    });

    save_index(vault_dir, key, &index)?;
    Ok(saved_relative)
}

// --- Chunked upload -------------------------------------------------------
//
// Sending a large file to the backend as one giant `Vec<u8>` IPC argument
// means the frontend has to build one huge JS array and JSON-serialize it in
// a single synchronous pass, which is exactly what was freezing the UI on
// large files. These three commands let the frontend stream a file across in
// small pieces instead: each `append_upload_chunk` call is small and fast,
// and the `await` between them gives the UI thread room to breathe. Nothing
// touches the vault until `finish_upload` — a crash or abandoned upload just
// leaves an in-memory buffer that vanishes with the process, never a partial
// file on disk.

#[tauri::command]
pub fn begin_upload(state: State<AppState>) -> Result<String, String> {
    let id = random_session_id();
    lock_recover(&state.uploads).insert(id.clone(), Vec::new());
    Ok(id)
}

#[tauri::command]
pub fn append_upload_chunk(
    state: State<AppState>,
    upload_id: String,
    chunk: Vec<u8>,
) -> Result<(), String> {
    let mut uploads = lock_recover(&state.uploads);
    let buffer = uploads
        .get_mut(&upload_id)
        .ok_or("unknown upload session")?;

    if buffer.len() + chunk.len() > MAX_TRANSFER_BYTES {
        uploads.remove(&upload_id);
        return Err("upload exceeds the maximum allowed size".to_string());
    }

    buffer.extend_from_slice(&chunk);
    Ok(())
}

#[tauri::command]
pub fn cancel_upload(state: State<AppState>, upload_id: String) -> Result<(), String> {
    lock_recover(&state.uploads).remove(&upload_id);
    Ok(())
}

// `async`: encrypts and writes the whole assembled upload to the USB drive
// in one call — see `store_commands::install_app` for why a plain `fn`
// would otherwise block the main thread for the entire write.
#[tauri::command(async)]
pub fn finish_upload(
    state: State<AppState>,
    upload_id: String,
    relative_dest: String,
) -> Result<String, String> {
    let file_bytes = lock_recover(&state.uploads)
        .remove(&upload_id)
        .ok_or("unknown upload session")?;

    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);
    save_encrypted_file(&vault_dir, key, &relative_dest, file_bytes)
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

fn ensure_parent_directories(index: &mut VaultIndex, path: &str) -> Result<(), String> {
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
        match index.entries.iter().find(|entry| entry.original_path == dir) {
            // A previous call already created this ancestor as a directory
            // — nothing to do.
            Some(entry) if entry.is_dir => {}
            // Something already occupies this path and it's a *file*, not
            // a directory — proceeding would leave the index internally
            // inconsistent (a "file" entry with children nested under it),
            // which is exactly what previously let a folder silently end up
            // mis-marked as `is_dir: false` and made unreachable except by
            // hitting "path is a directory" when something tried to open
            // it. Fail loudly here instead, before any inconsistency can be
            // written to disk.
            Some(_) => {
                return Err(format!(
                    "cannot create folder '{dir}': a file with that name already exists"
                ));
            }
            None => index.entries.push(VaultIndexEntry {
                original_path: dir,
                blob_name: None,
                is_dir: true,
                size: None,
                deleted_at: None,
            }),
        }
    }

    Ok(())
}

// pub(crate) so rclone.rs's pre-sync "is the vault actually empty" check can
// share this exact path instead of re-deriving it — that drift (a stale
// copy checking the wrong location after the storage layout changed) is
// exactly what caused sync to report real data as "empty" and skip.
pub(crate) fn data_dir(vault_dir: &Path) -> PathBuf {
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
    let mut needs_save = false;

    if index.entries.is_empty() && has_plaintext_vault_data(vault_dir)? {
        migrate_plaintext_vault(vault_dir, key, &mut index)?;
        needs_save = true;
    }

    // Self-heal any pre-existing duplicate `original_path` entries (e.g.
    // one file and one folder sharing a name from an older bug) instead of
    // silently carrying them forward on every load. Keeping the *last*
    // occurrence matches `get_entry_for_path` below and the frontend's own
    // `Map`-based lookup (later entries win when built from an array via
    // `new Map(...)`), so backend and frontend always agree on which entry
    // a given path actually refers to — without this, the two could resolve
    // the same clicked row to two different entries (e.g. the UI treating a
    // path as a folder while the backend resolves an older, stale file
    // entry for the same name, or vice versa), which is exactly what
    // produced "path is a directory" for what looked like a normal folder.
    if dedupe_entries(&mut index) {
        needs_save = true;
    }

    // Covers a narrower case dedup can't: a single entry (no duplicate)
    // mistakenly left as `is_dir: false` by an older bug, with other entries
    // still nested underneath it. That's a state normal operation can never
    // produce today (a file can't have children), so finding one is
    // conclusive proof of historical corruption, not a false positive — and
    // it's exactly what made a folder permanently show up as a file, unable
    // to be opened, with its own contents stuck unreachable underneath it.
    if promote_files_with_children(&mut index) {
        needs_save = true;
    }

    if needs_save {
        save_index(vault_dir, key, &index)?;
    }

    Ok(index)
}

/// Retypes any entry marked as a file that has other entries nested under it
/// (i.e. some other entry's path starts with `"{this path}/"`) into a
/// directory, clearing its now-meaningless `blob_name`/`size` — see the call
/// site in `load_or_upgrade_index` for why this situation is unambiguous.
fn promote_files_with_children(index: &mut VaultIndex) -> bool {
    let mut changed = false;
    for i in 0..index.entries.len() {
        if index.entries[i].is_dir {
            continue;
        }
        let prefix = format!("{}/", index.entries[i].original_path);
        let has_children = index
            .entries
            .iter()
            .enumerate()
            .any(|(j, entry)| j != i && entry.original_path.starts_with(&prefix));
        if has_children {
            index.entries[i].is_dir = true;
            index.entries[i].blob_name = None;
            index.entries[i].size = None;
            changed = true;
        }
    }
    changed
}

/// Removes duplicate `original_path` entries, keeping the last occurrence
/// of each. Returns true if anything was actually removed.
fn dedupe_entries(index: &mut VaultIndex) -> bool {
    let mut seen = std::collections::HashSet::new();
    let mut keep = vec![false; index.entries.len()];
    for (i, entry) in index.entries.iter().enumerate().rev() {
        keep[i] = seen.insert(entry.original_path.clone());
    }

    let original_len = index.entries.len();
    let mut kept_iter = keep.into_iter();
    index.entries.retain(|_| kept_iter.next().unwrap_or(true));
    index.entries.len() != original_len
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
                    deleted_at: None,
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
                deleted_at: None,
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
        return Ok(VaultIndex { entries: Vec::new(), trash: Vec::new() });
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

/// Shared by the chunked download path below. Loads and fully decrypts one
/// vault entry, returning plaintext bytes in memory.
fn read_decrypted_file(
    vault_dir: &Path,
    key: &crypto::VaultKey,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let index = load_or_upgrade_index(vault_dir, key)?;
    let normalized = normalize_relative_path(relative_path)?;
    let entry = get_entry_for_path(&index, &normalized).ok_or("file not found")?;
    if entry.is_dir {
        return Err("path is a directory".to_string());
    }
    let blob_name = entry
        .blob_name
        .as_ref()
        .ok_or("missing blob mapping for file")?;

    let sealed = fs::read(data_dir(vault_dir).join(blob_name))
        .map_err(|e| format!("failed to read encrypted file: {e}"))?;
    crypto::decrypt_bytes(key, &sealed)
}

// --- Chunked download -------------------------------------------------------
//
// The read-side mirror of the chunked upload above: returning one giant
// `Vec<u8>` in a single command response means the frontend has to
// JSON-parse one huge array in one synchronous pass — same freeze, just in
// the opposite direction (hit when previewing a large file). `begin_download`
// decrypts once into memory and hands back a handle; the frontend then pulls
// it out in small pieces via `read_download_chunk`.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHandle {
    download_id: String,
    total_bytes: u64,
}

// `async`: reads and decrypts the whole file into memory up front — see
// `store_commands::install_app` for why a plain `fn` would otherwise block
// the main thread for the entire read+decrypt of a large file.
#[tauri::command(async)]
pub fn begin_download(
    state: State<AppState>,
    relative_path: String,
) -> Result<DownloadHandle, String> {
    let plaintext = {
        let guard = lock_recover(&state.vault_key);
        let key = guard.as_ref().ok_or("vault is locked")?;
        let vault_dir = usb_root::vault_dir(&state.root);
        read_decrypted_file(&vault_dir, key, &relative_path)?
    };

    let total_bytes = plaintext.len() as u64;
    let id = random_session_id();
    lock_recover(&state.downloads).insert(id.clone(), plaintext);
    Ok(DownloadHandle {
        download_id: id,
        total_bytes,
    })
}

#[tauri::command]
pub fn read_download_chunk(
    state: State<AppState>,
    download_id: String,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    let downloads = lock_recover(&state.downloads);
    let buffer = downloads
        .get(&download_id)
        .ok_or("unknown download session")?;

    let start = offset as usize;
    if start > buffer.len() {
        return Err("offset out of range".to_string());
    }
    let end = std::cmp::min(start + length as usize, buffer.len());
    Ok(buffer[start..end].to_vec())
}

#[tauri::command]
pub fn end_download(state: State<AppState>, download_id: String) -> Result<(), String> {
    lock_recover(&state.downloads).remove(&download_id);
    Ok(())
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

    ensure_parent_directories(&mut index, &normalized)?;
    index.entries.push(VaultIndexEntry {
        original_path: normalized,
        blob_name: None,
        is_dir: true,
        size: None,
        deleted_at: None,
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

/// Moves a file or folder (and, for a folder, everything under it) to
/// trash rather than deleting it outright: blobs stay on disk untouched,
/// entries move from `index.entries` to `index.trash` with a deletion
/// timestamp. See `restore_vault_entry` to undo this and `empty_trash` /
/// `permanently_delete_trash_entry` to actually free the space.
#[tauri::command]
pub fn delete_vault_entry(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let mut index = load_or_upgrade_index(&vault_dir, key)?;
    let normalized = normalize_relative_path(&relative_path)?;

    // Collect entries to move: exact match and, for directories, any children
    let mut to_trash = Vec::new();
    for (i, entry) in index.entries.iter().enumerate() {
        if entry.original_path == normalized || entry.original_path.starts_with(&format!("{}/", normalized)) {
            to_trash.push(i);
        }
    }

    if to_trash.is_empty() {
        return Err("path not found".to_string());
    }

    let deleted_at = now_unix_seconds();
    // iterate in reverse so indices are stable while removing
    to_trash.sort_unstable_by(|a, b| b.cmp(a));
    for idx in to_trash {
        let mut entry = index.entries.remove(idx);
        entry.deleted_at = Some(deleted_at);
        index.trash.push(entry);
    }

    // Ancestor folders left with nothing in them as a result vanish
    // outright rather than moving to trash themselves — same as before
    // trash existed, and consistent with how an ordinary empty folder
    // isn't independently "a thing" worth recovering.
    prune_empty_directories(&mut index);

    save_index(&vault_dir, key, &index)?;
    Ok(())
}

/// Lists what's currently in trash — but only the *roots* of each deletion
/// (an entry whose parent isn't also in trash), not every individual
/// descendant: deleting one big folder should read as one trash entry to
/// restore or purge, not hundreds of individual file rows.
#[tauri::command]
pub fn list_trash(state: State<AppState>) -> Result<Vec<TrashEntry>, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let index = load_or_upgrade_index(&vault_dir, key)?;

    let mut entries = index
        .trash
        .iter()
        .filter(|entry| is_trash_root(&index, entry))
        .map(|entry| TrashEntry {
            path: entry.original_path.clone(),
            size: entry.size.unwrap_or(0),
            is_dir: entry.is_dir,
            deleted_at: entry.deleted_at.unwrap_or(0),
        })
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(entries)
}

fn is_trash_root(index: &VaultIndex, entry: &VaultIndexEntry) -> bool {
    !index.trash.iter().any(|other| {
        other.original_path != entry.original_path
            && entry.original_path.starts_with(&format!("{}/", other.original_path))
    })
}

/// Moves a trashed file or folder (and everything under it) back into the
/// live vault. If the original path (or an ancestor of it) is now occupied
/// by something else created since the deletion, the restored item is
/// renamed the same way a fresh upload with a colliding name would be —
/// and if the item being restored is itself a folder, every one of its
/// former children is re-prefixed to match wherever the folder actually
/// lands, so the whole subtree stays internally consistent.
#[tauri::command]
pub fn restore_vault_entry(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let mut index = load_or_upgrade_index(&vault_dir, key)?;
    let normalized = normalize_relative_path(&relative_path)?;

    let mut to_restore = Vec::new();
    for (i, entry) in index.trash.iter().enumerate() {
        if entry.original_path == normalized || entry.original_path.starts_with(&format!("{}/", normalized)) {
            to_restore.push(i);
        }
    }

    if to_restore.is_empty() {
        return Err("item not found in trash".to_string());
    }

    let restored_root_path = if get_entry_for_path(&index, &normalized).is_some() {
        unique_original_path(&index, &normalized)
    } else {
        normalized.clone()
    };

    to_restore.sort_unstable_by(|a, b| b.cmp(a));
    let mut restored: Vec<VaultIndexEntry> =
        to_restore.into_iter().map(|idx| index.trash.remove(idx)).collect();
    // Shallowest path first, so a restored folder is back in `entries`
    // before its own children are processed.
    restored.sort_by_key(|entry| entry.original_path.matches('/').count());

    let child_prefix = format!("{normalized}/");
    for mut entry in restored {
        entry.deleted_at = None;
        entry.original_path = if entry.original_path == normalized {
            restored_root_path.clone()
        } else if let Some(suffix) = entry.original_path.strip_prefix(&child_prefix) {
            format!("{restored_root_path}/{suffix}")
        } else {
            entry.original_path
        };
        ensure_parent_directories(&mut index, &entry.original_path)?;
        index.entries.push(entry);
    }

    save_index(&vault_dir, key, &index)?;
    Ok(())
}

/// Permanently removes one item (and everything under it) from trash —
/// unlike `delete_vault_entry`, this actually deletes the blob(s), freeing
/// the space. See `empty_trash` to do this for everything in trash at once.
#[tauri::command]
pub fn permanently_delete_trash_entry(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let mut index = load_or_upgrade_index(&vault_dir, key)?;
    let normalized = normalize_relative_path(&relative_path)?;
    let data_dir = ensure_data_dir(&vault_dir)?;

    let mut to_remove = Vec::new();
    for (i, entry) in index.trash.iter().enumerate() {
        if entry.original_path == normalized || entry.original_path.starts_with(&format!("{}/", normalized)) {
            to_remove.push(i);
        }
    }

    if to_remove.is_empty() {
        return Err("item not found in trash".to_string());
    }

    to_remove.sort_unstable_by(|a, b| b.cmp(a));
    for idx in to_remove {
        let entry = index.trash.remove(idx);
        if let Some(blob) = &entry.blob_name {
            let _ = fs::remove_file(data_dir.join(blob));
        }
    }

    save_index(&vault_dir, key, &index)
}

/// Permanently empties trash entirely — every blob it references is
/// deleted, freeing the space. `async`: can be real, scaling I/O for a
/// trash full of large files, same reasoning as `change_passphrase`.
#[tauri::command(async)]
pub fn empty_trash(state: State<AppState>) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let mut index = load_or_upgrade_index(&vault_dir, key)?;
    let data_dir = ensure_data_dir(&vault_dir)?;

    for entry in index.trash.drain(..) {
        if let Some(blob) = &entry.blob_name {
            let _ = fs::remove_file(data_dir.join(blob));
        }
    }

    save_index(&vault_dir, key, &index)
}

/// `destination` comes from a native OS save-file dialog the user picked
/// interactively — unlike every other path in this file, it's intentionally
/// NOT sandboxed to the vault via `normalize_relative_path`/`safe_join`,
/// since the entire point of exporting is writing outside the vault, to
/// wherever the user themselves chose via a dialog the frontend can't spoof.
///
/// `async`: reads, decrypts, and writes the whole file — see
/// `store_commands::install_app` for why a plain `fn` would otherwise block
/// the main thread for the duration.
#[tauri::command(async)]
pub fn export_vault_file(
    state: State<AppState>,
    relative_path: String,
    destination: String,
) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let plaintext = read_decrypted_file(&vault_dir, key, &relative_path)?;

    let destination_path = PathBuf::from(&destination);
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create destination directory: {e}"))?;
    }
    fs::write(&destination_path, plaintext)
        .map_err(|e| format!("failed to write exported file: {e}"))
}

/// Decrypts every file under `relative_path` (a vault folder) and writes it
/// into `destination_dir` (a host directory chosen via a native dialog),
/// recreating the folder's internal structure. Returns how many files were
/// exported.
///
/// `async`: can decrypt and write out an entire folder's worth of files —
/// see `store_commands::install_app` for why a plain `fn` would otherwise
/// block the main thread for the whole operation.
#[tauri::command(async)]
pub fn export_vault_folder(
    state: State<AppState>,
    relative_path: String,
    destination_dir: String,
) -> Result<u32, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let normalized = normalize_relative_path(&relative_path)?;
    let index = load_or_upgrade_index(&vault_dir, key)?;
    let data_dir = ensure_data_dir(&vault_dir)?;
    let dest_root = PathBuf::from(&destination_dir);
    let prefix = format!("{normalized}/");

    let mut exported = 0u32;
    for entry in &index.entries {
        if entry.is_dir || !entry.original_path.starts_with(&prefix) {
            continue;
        }

        let relative_to_folder = entry
            .original_path
            .strip_prefix(&prefix)
            .unwrap_or(entry.original_path.as_str());
        let out_path = dest_root.join(relative_to_folder);
        write_decrypted_entry(entry, &data_dir, key, &out_path)?;
        exported += 1;
    }

    if exported == 0 {
        return Err("no files found in that folder to export".to_string());
    }

    Ok(exported)
}

/// Exports a mixed batch of files and/or folders (as selected via multi-select
/// in the vault browser) into `destination_dir` in one go, each under its own
/// basename — e.g. selecting a "Photos" folder and a "notes.txt" file
/// produces `destination_dir/Photos/...` and `destination_dir/notes.txt`,
/// matching how dragging multiple items into a folder normally behaves.
///
/// `async`: see `export_vault_folder` above — this can be an even larger
/// batch of decrypt+write work.
#[tauri::command(async)]
pub fn export_vault_items(
    state: State<AppState>,
    relative_paths: Vec<String>,
    destination_dir: String,
) -> Result<u32, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;

    let vault_dir = usb_root::vault_dir(&state.root);
    let index = load_or_upgrade_index(&vault_dir, key)?;
    let data_dir = ensure_data_dir(&vault_dir)?;
    let dest_root = PathBuf::from(&destination_dir);

    let mut exported = 0u32;
    for relative_path in &relative_paths {
        let normalized = normalize_relative_path(relative_path)?;
        let basename = normalized.rsplit('/').next().unwrap_or(&normalized);
        let entry = get_entry_for_path(&index, &normalized)
            .ok_or_else(|| format!("'{normalized}' not found in vault"))?;

        if entry.is_dir {
            let prefix = format!("{normalized}/");
            for candidate in &index.entries {
                if candidate.is_dir || !candidate.original_path.starts_with(&prefix) {
                    continue;
                }
                let relative_to_folder = candidate
                    .original_path
                    .strip_prefix(&prefix)
                    .unwrap_or(candidate.original_path.as_str());
                let out_path = dest_root.join(basename).join(relative_to_folder);
                write_decrypted_entry(candidate, &data_dir, key, &out_path)?;
                exported += 1;
            }
        } else {
            let out_path = dest_root.join(basename);
            write_decrypted_entry(entry, &data_dir, key, &out_path)?;
            exported += 1;
        }
    }

    if exported == 0 {
        return Err("no files found to export".to_string());
    }

    Ok(exported)
}

fn write_decrypted_entry(
    entry: &VaultIndexEntry,
    data_dir: &Path,
    key: &crypto::VaultKey,
    out_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create directory: {e}"))?;
    }
    let blob_name = entry
        .blob_name
        .as_ref()
        .ok_or("missing blob mapping for file")?;
    let sealed = fs::read(data_dir.join(blob_name))
        .map_err(|e| format!("failed to read encrypted file: {e}"))?;
    let plaintext = crypto::decrypt_bytes(key, &sealed)?;
    fs::write(out_path, plaintext).map_err(|e| format!("failed to write {}: {e}", out_path.display()))
}

/// The per-OS segment names `app_install_dir` nests catalog installs under
/// (see `usb_root::APP_OS_SEGMENT`) — both listed here, not just the current
/// platform's, so `uninstall_app`'s legacy-layout cleanup below knows to
/// never touch a sibling OS's install sitting alongside legacy files on the
/// same drive.
const KNOWN_APP_OS_SEGMENTS: &[&str] = &["windows", "linux"];

// `async`: `remove_dir_all` on a large installed app (hundreds of MB, many
// files) is a real blocking cost — see `store_commands::install_app` for
// why a plain `fn` would otherwise block the main thread for it.
#[tauri::command(async)]
pub fn uninstall_app(state: State<AppState>, app_id: String) -> Result<(), String> {
    let root = &state.root;
    let app_dir = usb_root::apps_dir(root).join(&app_id);
    let per_os_dir = usb_root::app_install_dir(root, &app_id);

    if per_os_dir.exists() {
        fs::remove_dir_all(&per_os_dir).map_err(|e| format!("failed to remove app: {e}"))?;
        // Tidy the now-possibly-empty <id>/ wrapper, but only if nothing
        // else — another OS's install, or leftover pre-split files — is
        // still in it.
        if fs::read_dir(&app_dir).map(|mut d| d.next().is_none()).unwrap_or(false) {
            let _ = fs::remove_dir(&app_dir);
        }
        return Ok(());
    }

    if !app_dir.exists() {
        return Err("app not found".to_string());
    }

    // No per-OS install for this OS — either this app was installed before
    // Apps/ started being split by OS (see usb_root::app_install_dir), or
    // it was only ever installed for a different OS on this same drive.
    // Remove only files that aren't another OS's install directory, so a
    // sibling install sitting alongside pre-split files is never touched.
    for entry in
        fs::read_dir(&app_dir).map_err(|e| format!("failed to read app directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| KNOWN_APP_OS_SEGMENTS.contains(&name))
        {
            continue;
        }
        let path = entry.path();
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|e| format!("failed to remove {}: {e}", path.display()))?;
    }

    if fs::read_dir(&app_dir).map(|mut d| d.next().is_none()).unwrap_or(false) {
        let _ = fs::remove_dir(&app_dir);
    }
    Ok(())
}
