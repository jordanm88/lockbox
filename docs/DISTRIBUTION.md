# Building, packaging, and running Lockbox from a USB drive

Lockbox targets Windows only. This document describes the Windows build and
distribution flow end to end.

## 1. Build

CI (`.github/workflows/build.yml`) builds on every push to `main` and on
`v*` tags, and uploads the raw build output as a workflow artifact. To build
locally instead:

```
npm ci
npm run tauri -- build
```

Or use the included helper script:

```powershell
scripts\build-win.ps1
```

This builds the frontend, runs the bundled Tauri Windows build, and copies the raw
portable executable into `build\Lockbox-Windows.exe`.

> Windows builds require a Rust toolchain on PATH. Install Rust via rustup
> (https://rustup.rs/) and make sure `cargo` is available before running the
> helper script.
>
> If the build still fails, also install the Visual Studio/MSVC C++ build
> tools required by the `x86_64-pc-windows-msvc` target.

This produces `src-tauri/target/release/Lockbox.exe` — the raw portable exe
— alongside installer-style artifacts from Tauri's bundle config (`.msi`,
NSIS `.exe`) under `src-tauri/target/release/bundle/`. For USB use, ignore
the installers and use the portable exe: the packaging script below only
picks out the portable exe, since installers write onto the host rather than
running portably.

Every GitHub release (see "Automatic releases" below) attaches all three —
the portable exe, the MSI, and the NSIS installer — so someone who wants a
normal on-host install has that option too. The in-app self-updater
(`updates.rs`) only ever picks the portable exe from a release, explicitly
skipping anything with "setup" or "installer" in its filename, since it can
only swap a running exe in place, not run an installer.

## Automatic releases

Every push to `main` where `package.json`'s version doesn't already have a
matching `v<version>` tag gets tagged and published as a GitHub release by
CI automatically — see the `auto_tag_and_release` job in
`.github/workflows/build.yml`. Bumping the version with
`npm run version:update -- x.y.z` and pushing to `main` is the entire
release process; no manual tagging step needed. Pushing a commit that
doesn't change the version just builds and stops there.

### Minimizing host footprint when using an installer (MSI/NSIS)

If you must distribute an installer (MSI or NSIS) that will be placed on a
removable drive and run there, prefer creating a *portable* installation
that avoids writing data to the host machine's profile areas and registry.
Two practical approaches:

- Prefer shipping the raw portable executable and instruct users to run it
	directly from the drive — this is the safest option and is the
	recommended distribution for Lockbox. `scripts\package-usb.ps1` is
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

## 2. Package onto a USB drive

The packaging script creates the `Vault/`, `Apps/`, `ThirdPartyApps/`,
`Tools/` layout (if not already present) and copies the built executable to
`USB_ROOT` under its conventional name:

```powershell
.\scripts\package-usb.ps1 -UsbDrivePath E:\
# or just double-click scripts\package-usb.bat and pass the drive letter
```

The script also checks for a real `rclone` binary under `Tools/`, and
downloads the current official `rclone` release automatically to refresh it
in place, so the drive stays self-contained when you re-run packaging.

If you are assembling a drive by hand instead of using the packaging script,
copy `rclone.exe` into `Tools/rclone.exe`. Cloud Sync will not work until
that binary exists on the USB drive.

> Updating an existing USB drive is safe: the packaging script preserves
> existing `Vault/`, `Apps/`, `ThirdPartyApps/`, and `Tools/` content and
> only replaces the Lockbox executable itself. User data and installed apps
> are left intact.

## 2b. Running from a cloud-synced folder instead of a USB drive

Lockbox never assumes it's actually on removable media — at startup it just
resolves `USB_ROOT` as *whatever directory the executable currently lives
in* (`current_exe()`'s parent) and creates `Vault/`, `Apps/`, `Tools/` next
to it if they don't already exist. That means the exact same portable build
works if you drop it into a Dropbox, OneDrive, Google Drive, or iCloud Drive
folder instead of onto a USB stick — the drive is only ever a convenience,
never a requirement. Use whichever fits: a physical drive for carrying the
vault between machines by hand, or a synced folder for it to follow you
automatically.

One thing changes with a synced folder that doesn't apply to a USB stick:
it's now much easier to end up with the *same* vault open on two machines at
once (e.g. a laptop and a desktop both syncing the same folder, one of them
left open from yesterday). Lockbox guards against that with an exclusive
lock file at `Vault/.lockbox/instance.lock`, acquired once at startup and
held for the process's lifetime — a second instance pointed at the same
`Vault/` fails to start with a clear "already open elsewhere" error instead
of silently racing the first instance and corrupting or losing data. Close
the other instance first, let it fully sync, then relaunch.

## 3. Bypassing Windows SmartScreen

An unsigned `.exe` with no download reputation can trigger *"Windows
protected your PC"* from Defender SmartScreen the first time it's run on a
given machine, independent of where it's launched from. This isn't
Lockbox-specific — it's the same friction any unsigned portable app hits.
Click **More info** → **Run anyway** in that dialog.

If the executable does carry a zone-identifier mark (this happens if it was
downloaded directly onto an NTFS-formatted machine before being copied to
the exFAT drive — exFAT itself has no alternate-data-stream support, so the
mark doesn't survive being copied *onto* the USB drive, only *before* that),
it can be cleared from PowerShell:

```powershell
Unblock-File -Path "E:\Lockbox-Windows.exe"
```

`scripts\package-usb.ps1` also attempts to unblock the copied exe
automatically when packaging onto a USB drive. The durable fix is
Authenticode code-signing with a trusted certificate, which builds
SmartScreen reputation over time — not set up here, since it requires a paid
code-signing certificate that doesn't exist in this project yet.
