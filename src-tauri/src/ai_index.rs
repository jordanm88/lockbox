//! A small, encrypted, on-disk cache of vault file names + extracted text,
//! used only to find which files are relevant to an AI chat question before
//! sending their content to the model. Not a general full-text search
//! feature — deliberately narrow:
//!
//! - Only plain-text-like files and PDFs ever get their *content* read and
//!   cached; everything else (images, video, archives, Office docs) is
//!   metadata-only (name/size), searchable by filename but never sent to
//!   the model as content.
//! - No embeddings, no vector store — a simple keyword score over
//!   filenames + cached text. Keeps this feature to "reqwest + one hand
//!   -rolled index," no ML dependency.
//! - The cache is encrypted with the same vault key as everything else
//!   (`crypto::encrypt_bytes`/`decrypt_bytes`) and lives under
//!   `Vault/.lockbox/`, so switching USB drives switches caches too — there
//!   is never a cross-vault index.

use crate::commands::{self, AiIndexableFile};
use crate::crypto::{self, VaultKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const INDEX_RELATIVE_PATH: &str = ".lockbox/ai_index.enc";
/// Per-file cap on cached extracted text — keeps both the on-disk cache and
/// (more importantly) what gets sent to Anthropic per query bounded,
/// regardless of how large a single document is.
const MAX_CONTENT_CHARS: usize = 4000;

const PLAIN_TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "csv", "log", "yml", "yaml", "toml", "ini", "xml", "html", "css", "js", "jsx",
    "ts", "tsx", "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "sh", "rb", "php",
];

#[derive(Serialize, Deserialize, Clone)]
pub struct AiIndexEntry {
    pub path: String,
    pub blob_name: String,
    pub size: u64,
    /// `None` means metadata-only — this file's content was never read.
    pub content: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct AiIndex {
    pub entries: Vec<AiIndexEntry>,
}

fn index_path(vault_dir: &Path) -> std::path::PathBuf {
    vault_dir.join(INDEX_RELATIVE_PATH)
}

fn load(vault_dir: &Path, key: &VaultKey) -> Result<AiIndex, String> {
    let path = index_path(vault_dir);
    let sealed = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(AiIndex::default()),
        Err(e) => return Err(format!("failed to read AI index: {e}")),
    };
    let plaintext = crypto::decrypt_bytes(key, &sealed)?;
    serde_json::from_slice(&plaintext).map_err(|e| format!("corrupt AI index: {e}"))
}

fn save(vault_dir: &Path, key: &VaultKey, index: &AiIndex) -> Result<(), String> {
    let path = index_path(vault_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create vault directory: {e}"))?;
    }
    let plaintext = serde_json::to_vec(index).map_err(|e| format!("failed to serialize AI index: {e}"))?;
    let sealed = crypto::encrypt_bytes(key, &plaintext)?;
    fs::write(&path, sealed).map_err(|e| format!("failed to write AI index: {e}"))
}

fn extension_of(path: &str) -> String {
    let leaf = path.rsplit('/').next().unwrap_or(path);
    leaf.rsplit_once('.').map(|(_, ext)| ext.to_lowercase()).unwrap_or_default()
}

fn truncate_chars(mut text: String, max_chars: usize) -> String {
    if text.chars().count() > max_chars {
        text = text.chars().take(max_chars).collect();
        text.push_str("\n…(truncated)");
    }
    text
}

/// Extracts content for one file, given its already-decrypted bytes.
/// Returns `None` for anything outside the supported plain-text/PDF set —
/// that file stays metadata-only in the index.
fn extract_content(path: &str, plaintext: &[u8]) -> Option<String> {
    let ext = extension_of(path);
    if PLAIN_TEXT_EXTENSIONS.contains(&ext.as_str()) {
        let text = String::from_utf8_lossy(plaintext).into_owned();
        return Some(truncate_chars(text, MAX_CONTENT_CHARS));
    }
    if ext == "pdf" {
        return match pdf_extract::extract_text_from_mem(plaintext) {
            Ok(text) => Some(truncate_chars(text, MAX_CONTENT_CHARS)),
            // A PDF that fails to parse (encrypted, scanned/image-only, malformed)
            // just falls back to metadata-only rather than failing the whole index.
            Err(_) => None,
        };
    }
    None
}

/// Rebuilds the index against the vault's current file list, reusing cached
/// content for any file whose `blob_name` hasn't changed (a re-upload of the
/// same path gets a new blob, so this is a cheap, correct staleness check —
/// no mtimes needed). Returns the number of files indexed in total
/// (metadata-only files included).
pub fn rebuild(vault_dir: &Path, key: &VaultKey) -> Result<usize, String> {
    let previous = load(vault_dir, key)?;
    let active = commands::list_active_files_for_ai(vault_dir, key)?;

    let mut next_entries = Vec::with_capacity(active.len());
    for file in active {
        let AiIndexableFile { path, blob_name, size } = file;

        if let Some(cached) = previous.entries.iter().find(|e| e.path == path && e.blob_name == blob_name) {
            next_entries.push(cached.clone());
            continue;
        }

        let content = match commands::read_decrypted_file(vault_dir, key, &path) {
            Ok(plaintext) => extract_content(&path, &plaintext),
            // Unreadable for whatever reason (shouldn't normally happen) —
            // still index it by name, just without content.
            Err(_) => None,
        };

        next_entries.push(AiIndexEntry { path, blob_name, size, content });
    }

    let count = next_entries.len();
    save(vault_dir, key, &AiIndex { entries: next_entries })?;
    Ok(count)
}

/// Loads the cache as-is, without rebuilding — callers that need a
/// guaranteed-fresh index should call [`rebuild`] first.
pub fn load_cached(vault_dir: &Path, key: &VaultKey) -> Result<AiIndex, String> {
    load(vault_dir, key)
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.len() >= 2)
        .map(|s| s.to_string())
        .collect()
}

/// Scores every entry by keyword hits (filename matches weighted higher
/// than content matches) and returns the top `limit`, best first. Entries
/// with no hits at all are excluded.
pub fn search<'a>(index: &'a AiIndex, query: &str, limit: usize) -> Vec<&'a AiIndexEntry> {
    let terms = tokenize(query);
    if terms.is_empty() {
        return Vec::new();
    }

    let mut scored: Vec<(i64, &AiIndexEntry)> = index
        .entries
        .iter()
        .filter_map(|entry| {
            let path_lower = entry.path.to_lowercase();
            let content_lower = entry.content.as_deref().map(|c| c.to_lowercase());

            let mut score = 0i64;
            for term in &terms {
                if path_lower.contains(term.as_str()) {
                    score += 5;
                }
                if let Some(content) = &content_lower {
                    score += content.matches(term.as_str()).count() as i64;
                }
            }

            if score > 0 {
                Some((score, entry))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(limit).map(|(_, entry)| entry).collect()
}
