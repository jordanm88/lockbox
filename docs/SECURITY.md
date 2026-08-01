# Lockbox encryption model

This documents exactly what Lockbox encrypts, how, and — just as
importantly — what it does *not* protect against. It's a description of the
current implementation (`src-tauri/src/crypto.rs`), not a marketing claim.

## Summary

| Property | Value |
| --- | --- |
| Cipher | ChaCha20-Poly1305 (AEAD — authenticated encryption) |
| Key derivation | Argon2id, version 19 |
| Argon2 parameters | 19 MiB memory, 2 iterations, 1 lane (the RustCrypto `argon2` crate's defaults, which match OWASP's baseline recommended minimum for Argon2id) |
| Salt | 16 random bytes, generated once per vault, stored in `Vault/.lockbox/vault.meta.json` |
| Nonce | 12 random bytes, generated fresh for **every** encryption call, stored alongside its ciphertext |
| Key size | 256-bit (32 bytes) |
| What's encrypted | Every file's contents, and the entire file/folder index (names, paths, sizes) — as one unit each |
| What's not encrypted | Nothing vault-related is stored in plaintext on the drive. The salt and password-verifier blob in `vault.meta.json` are stored unencrypted, but that's expected — they exist specifically so a passphrase can be checked before a key exists yet, and neither leaks anything about the passphrase or the vault's contents. |

## How unlocking works

1. On first run, whatever passphrase you enter becomes the master
   passphrase. A random 16-byte salt is generated and Argon2id derives a
   256-bit key from `(passphrase, salt)`. A known plaintext
   (`"LOCKBOX-VAULT-OK"`) is encrypted with that key and stored, along with
   the salt, in `vault.meta.json`.
2. On every later unlock, the same salt is read back, Argon2id re-derives a
   key from the entered passphrase, and that key is used to try decrypting
   the stored verifier. If it decrypts to the expected plaintext, the
   passphrase was correct and that derived key becomes the session's vault
   key. If not, the ChaCha20-Poly1305 authentication tag fails to verify and
   the app reports "incorrect passphrase" — there's no separate check that
   could disagree with the actual decryption result.
3. The derived key is held in memory only (`Mutex<Option<VaultKey>>` in app
   state) for as long as the vault is unlocked, and is explicitly zeroed out
   in memory (via the `zeroize` crate) the moment it's dropped — on lock, on
   app exit, or if a command panics. It is never written to disk anywhere.

## How files are encrypted

Every file is encrypted independently with `ChaCha20Poly1305::encrypt`,
using the session's vault key and a freshly random 96-bit nonce generated
for that one call. The output stored on disk is simply `nonce || ciphertext`
— the nonce doesn't need to be secret, only unique per encryption under the
same key, and a random 96-bit nonce makes an accidental collision
astronomically unlikely at any realistic number of files in one vault.

Files are stored as random-hex-named blobs under `Vault/.lockbox/data/`, not
under their real names — the mapping from real file/folder paths to blob
names lives entirely inside the encrypted index (`vault.index.enc`), which is
itself just another blob encrypted the same way. This means a copy of the
drive without the passphrase reveals almost nothing structural: not
filenames, not folder names, not folder structure. What it *does* still
reveal is the number of files and each one's approximate size (ChaCha20-
Poly1305 adds a fixed 16-byte authentication tag and no padding), which is a
standard limitation of straightforward per-file encryption without padding —
worth knowing, not a bug.

## How secure is this, honestly

**Strong, for what it's designed to do:** protecting data at rest if the
drive is lost, stolen, or examined while Lockbox isn't running. ChaCha20-
Poly1305 and Argon2id are both modern, widely-reviewed, NIST/OWASP-endorsed
primitives with no known practical breaks, used here in the standard way
(unique nonces, authenticated ciphertext, memory-hard KDF with a random
per-vault salt). Given a strong passphrase, an attacker with the physical
drive and unlimited time still has to pay Argon2id's memory/time cost for
every single guess — that's the entire point of using it over a fast hash
like SHA-256.

**What it does not protect against:**

- **A weak passphrase.** Argon2id makes each guess expensive, but it can't
  turn a short or guessable passphrase into a strong one. The app currently
  only enforces an 8-character minimum, which is on the low side — a longer
  passphrase (or a multi-word passphrase) is the single biggest lever a user
  has over this vault's real-world security, more so than any parameter in
  `crypto.rs`.
- **A compromised host machine at the moment of use.** This is an at-rest
  encryption model, not a secure-enclave one. While the vault is unlocked,
  the derived key and decrypted file contents exist in the running process's
  memory, same as any other desktop app. A keylogger, memory-scraping
  malware, or someone physically watching the screen during that session
  isn't something client-side encryption can defend against.
- **No brute-force lockout beyond Argon2id's own cost.** There's no
  attempt-counter or backoff in the app itself — the KDF's cost *is* the
  throttle, by design, which is normal for this class of tool (KeePass and
  VeraCrypt work the same way) but worth knowing explicitly.
- **No plausible deniability / hidden volumes**, unlike tools such as
  VeraCrypt. There is exactly one passphrase and one vault; if someone
  compels you to unlock it, there's no decoy to unlock instead.
- **No second factor.** The passphrase is the sole credential. Losing it
  means losing the vault — there's no recovery mechanism, which is itself a
  deliberate trade-off of a passphrase-only, no-server design (no recovery
  path also means no third party ever custodies your data or key).

## Where to look if you want to verify any of this yourself

All of the above is implemented in a single, short file:
`src-tauri/src/crypto.rs`. It has no network calls, no telemetry, and no
dependencies beyond the `chacha20poly1305`, `argon2`, `rand`, and `zeroize`
crates. Reading it end to end (under 140 lines) is the most reliable way to
confirm this document stays accurate as the code changes.
