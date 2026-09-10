use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Key, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, ZeroizeOnDrop};

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const VERIFIER_PLAINTEXT: &[u8] = b"LOCKBOX-VAULT-OK";
const META_RELATIVE_PATH: &str = ".lockbox/vault.meta.json";

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct VaultKey([u8; 32]);

impl VaultKey {
    fn cipher(&self) -> ChaCha20Poly1305 {
        ChaCha20Poly1305::new(Key::from_slice(&self.0))
    }
}

#[derive(Serialize, Deserialize)]
struct VaultMeta {
    salt: Vec<u8>,
    verifier_nonce: Vec<u8>,
    verifier_ciphertext: Vec<u8>,
}

fn meta_path(vault_dir: &Path) -> PathBuf {
    vault_dir.join(META_RELATIVE_PATH)
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<VaultKey, String> {
    let mut key_bytes = [0u8; 32];
    argon2::Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key_bytes)
        .map_err(|e| format!("key derivation failed: {e}"))?;
    let key = VaultKey(key_bytes);
    key_bytes.zeroize();
    Ok(key)
}

/// Verifies `passphrase` against the vault at `vault_dir` and returns the
/// derived key on success.
///
/// If no vault metadata exists yet (a fresh drive), this bootstraps the
/// vault: whatever passphrase is given here becomes the master passphrase,
/// since there is no separate "create vault" step in the UI yet. Every
/// unlock after that must match it.
pub fn unlock(vault_dir: &Path, passphrase: &str) -> Result<Option<VaultKey>, String> {
    let path = meta_path(vault_dir);

    if !path.exists() {
        return Ok(Some(create_vault(vault_dir, passphrase)?));
    }

    let bytes = fs::read(&path).map_err(|e| format!("failed to read vault metadata: {e}"))?;
    let meta: VaultMeta =
        serde_json::from_slice(&bytes).map_err(|e| format!("corrupt vault metadata: {e}"))?;

    let key = derive_key(passphrase, &meta.salt)?;
    let cipher = key.cipher();
    let nonce = Nonce::from_slice(&meta.verifier_nonce);

    match cipher.decrypt(nonce, &meta.verifier_ciphertext[..]) {
        Ok(plaintext) if plaintext == VERIFIER_PLAINTEXT => Ok(Some(key)),
        _ => Ok(None),
    }
}

fn create_vault(vault_dir: &Path, passphrase: &str) -> Result<VaultKey, String> {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    let key = derive_key(passphrase, &salt)?;
    let cipher = key.cipher();

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let verifier_ciphertext = cipher
        .encrypt(nonce, VERIFIER_PLAINTEXT)
        .map_err(|e| format!("failed to initialize vault: {e}"))?;

    let meta = VaultMeta {
        salt: salt.to_vec(),
        verifier_nonce: nonce_bytes.to_vec(),
        verifier_ciphertext,
    };

    let path = meta_path(vault_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create vault metadata directory: {e}"))?;
    }
    let serialized = serde_json::to_vec(&meta)
        .map_err(|e| format!("failed to serialize vault metadata: {e}"))?;
    fs::write(&path, serialized).map_err(|e| format!("failed to write vault metadata: {e}"))?;

    Ok(key)
}

/// Generates a fresh salt + verifier for `new_passphrase` and writes it to a
/// staging file *next to* the real vault metadata — never to the real path
/// itself. See `commands::change_passphrase` for why: nothing about the
/// vault's real, working credentials changes until every blob and the index
/// have *also* been staged under the new key, so a passphrase change
/// interrupted partway through leaves the vault exactly as readable under
/// the old passphrase as it was before it started — safe to just retry.
pub fn stage_new_credentials(vault_dir: &Path, new_passphrase: &str) -> Result<(VaultKey, PathBuf), String> {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    let key = derive_key(new_passphrase, &salt)?;
    let cipher = key.cipher();

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let verifier_ciphertext = cipher
        .encrypt(nonce, VERIFIER_PLAINTEXT)
        .map_err(|e| format!("failed to prepare new credentials: {e}"))?;

    let meta = VaultMeta {
        salt: salt.to_vec(),
        verifier_nonce: nonce_bytes.to_vec(),
        verifier_ciphertext,
    };

    let mut staged_path = meta_path(vault_dir).into_os_string();
    staged_path.push(".new");
    let staged_path = PathBuf::from(staged_path);

    if let Some(parent) = staged_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create vault metadata directory: {e}"))?;
    }
    let serialized = serde_json::to_vec(&meta)
        .map_err(|e| format!("failed to serialize new vault metadata: {e}"))?;
    fs::write(&staged_path, serialized)
        .map_err(|e| format!("failed to stage new vault metadata: {e}"))?;

    Ok((key, staged_path))
}

/// Finalizes a passphrase change by atomically swapping the staged metadata
/// (from [`stage_new_credentials`]) into place. Call this only after every
/// blob and the index have *also* been re-encrypted and swapped in under
/// the new key — deliberately the very last step of the whole operation,
/// since this is what actually makes the new passphrase "real."
pub fn commit_new_credentials(vault_dir: &Path, staged_path: &Path) -> Result<(), String> {
    fs::rename(staged_path, meta_path(vault_dir))
        .map_err(|e| format!("failed to finalize new vault metadata: {e}"))
}

/// Encrypts `plaintext` and returns `nonce || ciphertext`, ready to write to
/// disk as-is.
pub fn encrypt_bytes(key: &VaultKey, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = key.cipher();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;

    let mut sealed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    sealed.extend_from_slice(&nonce_bytes);
    sealed.extend_from_slice(&ciphertext);
    Ok(sealed)
}

/// Splits `sealed` (as produced by [`encrypt_bytes`]) back into its nonce
/// and ciphertext and decrypts it.
pub fn decrypt_bytes(key: &VaultKey, sealed: &[u8]) -> Result<Vec<u8>, String> {
    if sealed.len() < NONCE_LEN {
        return Err("encrypted file is corrupt (too short)".to_string());
    }
    let (nonce_bytes, ciphertext) = sealed.split_at(NONCE_LEN);
    let cipher = key.cipher();
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decryption failed (wrong key or corrupt file)".to_string())
}
