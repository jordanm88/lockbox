//! TOTP (RFC 6238) implemented directly on top of the same RustCrypto-family
//! primitives the rest of this app already uses (Argon2id + ChaCha20Poly1305
//! in `crypto.rs`), rather than pulling in a higher-level "totp" wrapper
//! crate — small enough (~60 lines) that hand-rolling it keeps the
//! dependency list and the trust surface both minimal.

use crate::state::{lock_recover, AppState};
use crate::{usb_root, vault_settings};
use base32::Alphabet;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::Serialize;
use sha1::Sha1;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const SECRET_BYTES: usize = 20; // 160 bits, the standard TOTP secret size
const TIME_STEP_SECONDS: u64 = 30;
const DIGITS: u32 = 6;
/// Tolerates the authenticator app's clock (or this machine's) being up to
/// one 30s step off in either direction — standard TOTP practice, since
/// otherwise ordinary clock drift causes spurious rejections.
const DRIFT_STEPS: i64 = 1;

pub fn generate_secret() -> String {
    let mut bytes = [0u8; SECRET_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base32::encode(Alphabet::Rfc4648 { padding: false }, &bytes)
}

pub fn otpauth_uri(secret: &str) -> String {
    format!("otpauth://totp/Lockbox?secret={secret}&issuer=Lockbox&algorithm=SHA1&digits=6&period=30")
}

fn code_at_step(secret_bytes: &[u8], time_step: u64) -> u32 {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret_bytes).expect("HMAC accepts any key length");
    mac.update(&time_step.to_be_bytes());
    let hash = mac.finalize().into_bytes();

    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let truncated = ((hash[offset] as u32 & 0x7f) << 24)
        | ((hash[offset + 1] as u32) << 16)
        | ((hash[offset + 2] as u32) << 8)
        | (hash[offset + 3] as u32);

    truncated % 10u32.pow(DIGITS)
}

/// Verifies a user-entered code against `secret_b32`, tolerating clock drift
/// of up to [`DRIFT_STEPS`] time steps in either direction.
pub fn verify(secret_b32: &str, code: &str) -> bool {
    let Some(secret_bytes) = base32::decode(Alphabet::Rfc4648 { padding: false }, secret_b32) else {
        return false;
    };
    let Ok(now) = SystemTime::now().duration_since(UNIX_EPOCH) else {
        return false;
    };
    let current_step = now.as_secs() / TIME_STEP_SECONDS;

    for drift in -DRIFT_STEPS..=DRIFT_STEPS {
        let step = current_step as i64 + drift;
        if step < 0 {
            continue;
        }
        let expected = format!("{:0width$}", code_at_step(&secret_bytes, step as u64), width = DIGITS as usize);
        if expected == code {
            return true;
        }
    }
    false
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpStatus {
    enabled: bool,
}

#[tauri::command]
pub fn get_totp_status(state: State<AppState>) -> Result<TotpStatus, String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);
    let settings = vault_settings::load(&vault_dir, key)?;
    Ok(TotpStatus { enabled: settings.totp_enabled })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpSetup {
    secret: String,
    otpauth_uri: String,
}

/// Generates a new secret and stages it in memory only — nothing is
/// persisted until [`confirm_totp_setup`] verifies a real code against it.
#[tauri::command]
pub fn begin_totp_setup(state: State<AppState>) -> Result<TotpSetup, String> {
    if lock_recover(&state.vault_key).is_none() {
        return Err("vault is locked".to_string());
    }

    let secret = generate_secret();
    let uri = otpauth_uri(&secret);
    *lock_recover(&state.pending_totp_secret) = Some(secret.clone());

    Ok(TotpSetup { secret, otpauth_uri: uri })
}

/// Verifies `code` against the secret staged by [`begin_totp_setup`]; only
/// on success does the secret actually get written to the encrypted
/// per-vault settings file.
#[tauri::command]
pub fn confirm_totp_setup(state: State<AppState>, code: String) -> Result<bool, String> {
    let secret = lock_recover(&state.pending_totp_secret).clone().ok_or("no 2FA setup is in progress")?;

    if !verify(&secret, code.trim()) {
        return Ok(false);
    }

    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);
    let mut settings = vault_settings::load(&vault_dir, key)?;
    settings.totp_enabled = true;
    settings.totp_secret = Some(secret);
    vault_settings::save(&vault_dir, key, &settings)?;
    drop(guard);

    *lock_recover(&state.pending_totp_secret) = None;
    Ok(true)
}

#[tauri::command]
pub fn cancel_totp_setup(state: State<AppState>) -> Result<(), String> {
    *lock_recover(&state.pending_totp_secret) = None;
    Ok(())
}

/// Disabling requires only that the vault is already unlocked — same
/// standard as `change_passphrase`, which needs no extra re-proof either,
/// since unlocking already satisfied both factors this session.
#[tauri::command]
pub fn disable_totp(state: State<AppState>) -> Result<(), String> {
    let guard = lock_recover(&state.vault_key);
    let key = guard.as_ref().ok_or("vault is locked")?;
    let vault_dir = usb_root::vault_dir(&state.root);
    let mut settings = vault_settings::load(&vault_dir, key)?;
    settings.totp_enabled = false;
    settings.totp_secret = None;
    vault_settings::save(&vault_dir, key, &settings)
}
