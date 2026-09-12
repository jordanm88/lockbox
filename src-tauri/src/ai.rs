//! The AI vault assistant: Settings CRUD for the (encrypted) API key/enabled
//! flag, and the chat command itself. Only Anthropic is wired up — the
//! frontend's provider dropdown shows other providers as disabled
//! placeholders, and `ai_provider` is otherwise unused here today.
//!
//! No official Anthropic Rust SDK exists, so this calls the Messages API
//! directly over HTTPS via `reqwest` (already a dependency), the same way
//! `updates.rs` already calls the GitHub API — a plain `fn` marked
//! `#[tauri::command(async)]` using `reqwest::blocking::Client`, not an
//! `async fn`.
//!
//! Security note: the decrypted API key is never cached in `AppState` — it
//! is loaded fresh from the encrypted `vault_settings` file for every
//! command that needs it, the same rule the TOTP secret follows.

use crate::state::{lock_recover, AppState};
use crate::{ai_index, usb_root, vault_settings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MODEL_ID: &str = "claude-haiku-4-5";
/// How many of the top-scoring files (by `ai_index::search`) get their
/// content included per question — bounds cost per query regardless of
/// vault size.
const MAX_CONTEXT_FILES: usize = 6;

const SYSTEM_PROMPT: &str = "You are Lockbox's vault assistant. Answer the user's question using ONLY the file \
excerpts provided below the question — never invent details that aren't there. If the answer isn't in the \
provided excerpts, say so plainly instead of guessing. Some mentioned files may be listed as \"metadata only\" \
(their content wasn't provided, only their name/size) — you may confirm such a file exists, but must not claim \
to know its contents. Keep answers concise.";

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatTurn {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    enabled: bool,
    provider: String,
    has_api_key: bool,
}

#[tauri::command]
pub fn get_ai_config(state: State<AppState>) -> Result<AiConfigView, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);
    let settings = vault_settings::load(&vault_dir, key)?;

    Ok(AiConfigView {
        enabled: settings.ai_enabled,
        provider: if settings.ai_provider.is_empty() { "anthropic".to_string() } else { settings.ai_provider },
        has_api_key: settings.ai_api_key.is_some(),
    })
}

#[tauri::command]
pub fn set_ai_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);

    let mut settings = vault_settings::load(&vault_dir, key)?;
    settings.ai_enabled = enabled;
    vault_settings::save(&vault_dir, key, &settings)
}

/// Validates the key with a minimal, cheap request before saving it, so a
/// bad key is caught immediately rather than on the first real question.
#[tauri::command(async)]
pub fn set_ai_api_key(state: State<AppState>, provider: String, api_key: String) -> Result<(), String> {
    if provider != "anthropic" {
        return Err(format!("provider \"{provider}\" isn't supported yet"));
    }
    if api_key.trim().is_empty() {
        return Err("API key can't be empty".to_string());
    }
    if lock_recover(&state.vault_key).is_none() {
        return Err("vault is locked".to_string());
    }

    call_anthropic(&api_key, "Reply with just \"ok\".", &[ChatTurn { role: "user".to_string(), content: "ping".to_string() }], 8)?;

    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);
    let mut settings = vault_settings::load(&vault_dir, key)?;
    settings.ai_provider = provider;
    settings.ai_api_key = Some(api_key);
    vault_settings::save(&vault_dir, key, &settings)
}

#[tauri::command]
pub fn clear_ai_api_key(state: State<AppState>) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);

    let mut settings = vault_settings::load(&vault_dir, key)?;
    settings.ai_api_key = None;
    settings.ai_enabled = false;
    vault_settings::save(&vault_dir, key, &settings)
}

/// Rebuilds the AI content index against the vault's current files. Returns
/// how many files are now indexed (metadata-only ones included).
#[tauri::command(async)]
pub fn rebuild_ai_index(state: State<AppState>) -> Result<usize, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);
    ai_index::rebuild(&vault_dir, key)
}

/// `async`: both rebuilding the index (decrypting any new/changed files)
/// and the network call to Anthropic are real, unpredictable-latency work
/// that would otherwise freeze the window — see `store_commands::install_app`
/// for why a plain `fn` would block the main thread here.
#[tauri::command(async)]
pub fn ai_chat(state: State<AppState>, message: String, history: Vec<ChatTurn>) -> Result<String, String> {
    let (vault_dir, api_key) = {
        let guard = lock_recover(&state.vault_key);
        let key = guard.as_ref().ok_or("vault is locked")?;
        let vault_dir = usb_root::vault_dir(&state.root);
        let settings = vault_settings::load(&vault_dir, key)?;
        if !settings.ai_enabled {
            return Err("the AI assistant is turned off in Settings".to_string());
        }
        let api_key = settings.ai_api_key.ok_or("no API key is configured in Settings")?;
        (vault_dir, api_key)
    };

    let index = {
        let guard = lock_recover(&state.vault_key);
        let key = guard.as_ref().ok_or("vault is locked")?;
        ai_index::rebuild(&vault_dir, key)?;
        ai_index::load_cached(&vault_dir, key)?
    };

    let matches = ai_index::search(&index, &message, MAX_CONTEXT_FILES);

    let mut context = String::new();
    if matches.is_empty() {
        context.push_str("(No vault files matched this question by filename or content.)");
    } else {
        for entry in matches {
            match &entry.content {
                Some(content) => {
                    context.push_str(&format!("<file path=\"{}\">\n{}\n</file>\n", entry.path, content));
                }
                None => {
                    context.push_str(&format!(
                        "<file path=\"{}\" note=\"metadata only, {} bytes — content not available\"></file>\n",
                        entry.path, entry.size
                    ));
                }
            }
        }
    }

    let user_content = format!("Question: {message}\n\nRelevant vault files:\n{context}");
    // Defense in depth: the request body's `system` field is a fixed Rust
    // constant, never derived from `history` — but only forward turns with
    // an expected role regardless, so nothing client-supplied can smuggle a
    // "system"-role message into the conversation array.
    let mut turns: Vec<ChatTurn> = history.into_iter().filter(|t| t.role == "user" || t.role == "assistant").collect();
    turns.push(ChatTurn { role: "user".to_string(), content: user_content });

    call_anthropic(&api_key, SYSTEM_PROMPT, &turns, 1024)
}

fn call_anthropic(api_key: &str, system: &str, turns: &[ChatTurn], max_tokens: u32) -> Result<String, String> {
    let messages: Vec<Value> = turns
        .iter()
        .map(|turn| json!({ "role": turn.role, "content": turn.content }))
        .collect();

    let body = json!({
        "model": MODEL_ID,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(ANTHROPIC_API_URL)
        .header("content-type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body)
        .send()
        .map_err(|e| format!("failed to reach Anthropic: {e}"))?;

    let status = response.status();
    let payload: Value = response.json().map_err(|e| format!("unreadable response from Anthropic: {e}"))?;

    if !status.is_success() {
        let detail = payload
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(match status.as_u16() {
            401 => "Anthropic rejected the API key — check it in Settings".to_string(),
            429 => "Anthropic rate-limited this request — try again shortly".to_string(),
            _ => format!("Anthropic API error ({status}): {detail}"),
        });
    }

    payload
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|blocks| blocks.iter().find(|b| b.get("type").and_then(|t| t.as_str()) == Some("text")))
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Anthropic returned no text response".to_string())
}
