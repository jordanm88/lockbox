# Building, packaging, and running Lockbox from a USB drive

## 1. Build

CI (`.github/workflows/build.yml`) builds all three platforms in parallel on
every push to `main` and on `v*` tags, and uploads each platform's raw build
output as a workflow artifact. To build locally instead:

```
npm ci
npm run tauri -- build
```

Or on Windows only, use the included helper script:

```powershell
scripts\build-win.ps1
```

This builds the frontend, runs the bundled Tauri Windows build, and copies the raw
portable executable into `build\Lockbox-Windows.exe`.

> Windows builds require a Rust toolchain on PATH. Install Rust via rustup
> (https://rustup.rs/) and make sure `cargo` is available before running the
> helper script.
>
> If Windows still fails to build, also install the Visual Studio/MSVC C++
> build tools required by the `x86_64-pc-windows-msvc` target.

This produces:

| OS      | Portable artifact                                            |
| ------- | -------------------------------------------------------------- |
| Windows | `src-tauri/target/release/Lockbox.exe` (raw exe, not the NSIS/MSI installer) |
| macOS   | `src-tauri/target/release/bundle/macos/Lockbox.app`             |
| Linux   | `src-tauri/target/release/bundle/appimage/*.AppImage`           |

Tauri's bundle config also produces installer-style artifacts (`.msi`,
NSIS `.exe`, `.deb`, `.rpm`) alongside these — ignore them for USB use, they
install onto the host rather than running portably. The packaging scripts
below only pick out the three portable forms above.

### Minimizing host footprint when using an installer (MSI/NSIS)

If you must distribute an installer (MSI or NSIS) that will be placed on a
removable drive and run there, prefer creating a *portable* installation
that avoids writing data to the host machine's profile areas and registry.
Two practical approaches:

- Prefer shipping a ZIP/portable executable and instruct users to run the
	executable directly from the drive — this is the safest option and is the
	recommended distribution for Lockbox. The packaging scripts above are
	designed for this flow.
- If you must ship an MSI, build it so the user can choose a "portable"
	install location and avoid system-wide registration. For WiX-based MSI
	builds, set the install scope to per-user (not per-machine) and avoid
	creating auto-start or Start Menu shortcuts by default. Example WiX
	properties to consider when building or invoking the installer:

```text
	- InstallScope=perUser        # prefer per-user install (no machine-wide registry)
	- ARPNOREMOVE=1               # avoid adding uninstall entries if desired
	- ADD_SHORTCUTS=0             # custom property to skip creating Start Menu shortcuts
```

Exact property names depend on your WiX/NSIS script. The key goal is: when
the installer is used to place Lockbox on a removable drive, ensure it does
not create global system entries or write persistent configuration into
`%APPDATA%` / `HKLM` / `HKCU` — instead leave all data next to the executable
on the removable drive. Lockbox's runtime already prefers the executable's
parent directory as the vault root, so when the exe is run from the USB
drive it stores `Vault/` and `Apps/` next to the binary rather than on the
host.

If you want, I can help generate a WiX installer recipe that exposes a
"portable" option and documents the exact properties to pass at install
time.

## 2. Package onto a USB drive

Each script creates the `Vault/`, `Apps/`, `Tools/{win,mac,linux}/` layout
(if not already present) and copies the correct portable artifact to
`USB_ROOT` under its conventional name. Run the one matching the OS you
built on:

```powershell
# Windows
.\scripts\package-usb.ps1 -UsbDrivePath E:\
# or just double-click scripts\package-usb.bat and pass the drive letter
```

```bash
# macOS
./scripts/package-usb.sh /Volumes/LOCKBOX

# Linux
./scripts/package-usb.sh /media/$USER/LOCKBOX
```

Since there's no cross-compilation set up, packaging all three platforms
onto one drive means running the matching build + script on each OS (or
building in CI and downloading each platform's artifact locally before
running its script). Each script also checks for a real `rclone` binary
under `Tools/<os>/` and prints a reminder if one isn't there yet — download
it from https://rclone.org/downloads/ (Phase 4 only invokes it, it doesn't
fetch it).

> Updating an existing USB drive is safe: the packaging scripts preserve
> existing `Vault/`, `Apps/`, and `Tools/` content and only replace the
> Lockbox executable or app bundle itself. User data and installed apps are
> left intact.

## 3. Bypassing host OS security flags

All three OSes treat an unsigned executable arriving from removable media
with more suspicion than one that was "installed" normally. None of this is
Lockbox-specific — it's the same friction any unsigned portable app hits —
but it's worth knowing the exact commands since the whole point of this
project is running straight off the drive with no install step.

### macOS: Gatekeeper quarantine

The first time a `.app` is copied onto a Mac from another machine or a
mounted volume, macOS tags it with the `com.apple.quarantine` extended
attribute. Gatekeeper then refuses to launch it — often with the misleading
message *"Lockbox-macOS.app is damaged and can't be opened"*, which despite
the wording usually just means "quarantined and unsigned," not actually
corrupted.

Fastest fix, from Terminal:

```bash
xattr -cr /Volumes/LOCKBOX/Lockbox-macOS.app
```

(`-c` clears all extended attributes, `-r` recurses through the bundle.)

Without Terminal access: open **System Settings → Privacy & Security**,
scroll to the block notice for Lockbox, and click **Open Anyway** — this
only appears after the first blocked launch attempt.

The durable fix for real distribution is code-signing + notarization with
an Apple Developer ID account (`codesign` + `xcrun notarytool`) so Gatekeeper
trusts the binary outright. That's not set up in this project yet — it needs
a paid Apple Developer account and signing certificates that don't exist
here, so `xattr -cr` is the practical workaround until that's added.

### Linux: execute permission (and exFAT specifically)

```bash
chmod +x /media/$USER/LOCKBOX/Lockbox-Linux.AppImage
```

Worth knowing for this project specifically: **exFAT has no concept of Unix
permission bits at all.** Every file on an exFAT volume gets its executable
status from the *mount options* (`fmask`/`umask`), not from anything stored
per-file — so depending on how a given Linux distro auto-mounts exFAT
drives, the AppImage can silently lose its executable bit again the next
time the drive is unplugged and remounted, even though nothing on the drive
itself changed. If `chmod +x` seems to "not stick" across reboots/remounts,
that's why — either re-run `chmod +x` after each remount, or remount the
drive with an `fmask` that keeps files executable (e.g. `-o fmask=0000` in
the mount options, if you control how it's mounted).

Also worth knowing: some newer distros (Ubuntu 24.04+) ship without FUSE2,
which classic AppImages need to mount themselves. If launching produces a
FUSE-related error, either `sudo apt install libfuse2t64` (or `libfuse2` on
older releases), or run the AppImage with `--appimage-extract-and-run`,
which skips the FUSE mount entirely.

### Windows: SmartScreen

An unsigned `.exe` with no download reputation can trigger *"Windows
protected your PC"* from Defender SmartScreen the first time it's run on a
given machine, independent of where it's launched from. Click **More info**
→ **Run anyway** in that dialog.

If the executable does carry a zone-identifier mark (this happens if it was
downloaded directly onto an NTFS-formatted machine before being copied to
the exFAT drive — exFAT itself has no alternate-data-stream support, so the
mark doesn't survive being copied *onto* the USB drive, only *before* that),
it can be cleared from PowerShell:

```powershell
Unblock-File -Path "E:\Lockbox-Windows.exe"
```
The included `scripts/package-usb.ps1` now also attempts to unblock the copied
exe automatically when packaging onto a Windows USB drive.
As with macOS, the durable fix is Authenticode code-signing with a trusted
certificate, which builds SmartScreen reputation over time — not set up
here, same reason as the Gatekeeper case above.
