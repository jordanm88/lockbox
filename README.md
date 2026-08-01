> This application is a work in progress. Use at your own risk. Pull requests and contributions are welcome.

# Lockbox

[![Build Lockbox](https://github.com/jordanm88/lockbox/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/jordanm88/lockbox/actions/workflows/build.yml)
[![Windows](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/jordanm88/lockbox)
[![USB Portable](https://img.shields.io/badge/focus-USB%20portable-2b7a78)](https://github.com/jordanm88/lockbox)

Lockbox is a portable, encrypted vault and app launcher designed to run from a USB drive. It stores your files next to the app, keeps them encrypted at rest, and can install portable apps into the drive itself instead of the host machine.

## Why Lockbox

Lockbox is for people who want a self-contained workspace they can carry from machine to machine without leaving much behind. It keeps the vault on the drive, launches portable apps from the same place, and keeps the update story simple: rebuild Lockbox, repackage the drive, and the portable layout stays intact.

## Screenshot

This repository currently includes branding assets rather than a captured UI screenshot, so the project mark below stands in as a placeholder until a real vault/app-store screenshot is added.

![Lockbox project mark](src-tauri/icons/StoreLogo.png)

## Quick Start

1. Build Lockbox with `npm ci` followed by `npm run tauri -- build`.
2. Package the result onto a USB drive with the matching script for your OS.
3. Launch Lockbox from the USB copy, then use the Vault, App Store, and Cloud Sync screens.

## Contents

- [What It Does](#what-it-does)
- [Main Areas](#main-areas)
- [Build](#build)
- [Package Onto USB](#package-onto-usb)
- [Update Behavior](#update-behavior)
- [Portable App Paths](#portable-app-paths)
- [Security Notes](#security-notes)
- [Notes On Portable Installation](#notes-on-portable-installation)
- [Repository Layout](#repository-layout)
- [Useful Commands](#useful-commands)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What It Does

- Encrypts files into a vault that lives on the USB drive.
- Lets you browse folders and files with list or grid views.
- Previews common file types without writing decrypted temp files to disk.
- Installs portable apps into `Apps/<app-id>/` on the drive.
- Launches installed apps directly from the USB drive.
- Supports cloud sync through `rclone` for encrypted off-drive backups.
- Preserves existing vault data and installed apps when you repackage the drive.

## Main Areas

### Vault

The Vault is where encrypted files live. Lockbox treats the executable's parent directory as the vault root, so when the app runs from USB it stores data next to the binary instead of on the host machine.

In the Vault you can:

- Create folders.
- Upload files or whole folders.
- Drag and drop folders and files.
- Switch between list and grid views.
- Open folders to drill down.
- Preview files such as images, PDFs, and text.
- Delete files or folders from the vault.

### App Store

The App Store installs portable applications into the USB drive.

- Installed apps are copied into `Apps/<app-id>/`.
- The app card shows whether an app is already installed.
- Installed apps can be launched from the App Store.
- Uninstall removes that app folder from `Apps/`.
- Reinstalling an app refreshes its folder from the catalog.

The bundled catalog currently includes 19 apps across Development, Games,
Graphics & Pictures, Internet, Multimedia, Office, Security, and Utilities —
see `src-tauri/resources/catalog.json` for the full, current list.

### Cloud Sync

Cloud Sync uses `rclone` to back up the vault to an external cloud destination.

- Settings are saved encrypted in the vault.
- Sync and test actions stream live progress into the UI.
- The USB packaging script downloads the current official `rclone` release automatically, so the drive stays self-contained when you repackage it.
- If you assemble a drive manually, `rclone` must exist at `Tools/rclone.exe`.

## Build

CI builds on every push to `main` and on `v*` tags. If a push to `main`
carries a `package.json` version that doesn't have a matching tag yet, CI
creates that tag and publishes a real GitHub release automatically — bumping
the version with `npm run version:update -- x.y.z` and pushing to `main` is
the entire release process; no manual tagging step. Pushes that don't change
the version just build and stop there. To build locally:

```bash
npm ci
npm run tauri -- build
```

Or use the helper script:

```powershell
scripts\build-win.ps1
```

Building requires:

- A Rust toolchain on `PATH`.
- `cargo` available.
- Visual Studio/MSVC C++ build tools for the `x86_64-pc-windows-msvc` target.

## Package Onto USB

The packaging script creates this layout on the drive:

- `Vault/`
- `Apps/`
- `Third Party Apps/`
- `Tools/`

```powershell
.\scripts\package-usb.ps1 -UsbDrivePath E:\
# or double-click scripts\package-usb.bat and pass the drive letter
```

The script is update-safe:

- It preserves existing `Vault/`, `Apps/`, `Third Party Apps/`, and `Tools/` content.
- It replaces the Lockbox binary.
- It refreshes the bundled `rclone` binary from the current official release.

## Update Behavior

Lockbox does not have a background self-updater for installed apps.

What happens today:

- Rebuilding and repackaging Lockbox updates the Lockbox app itself.
- Reinstalling an app from the App Store replaces that app's folder with a fresh copy.
- The bundled portable tools on the USB drive are refreshed when you rerun the packaging scripts.

If you want a newer app version, reinstall it from the App Store after the catalog entry has been updated.

## Portable App Paths

Installed apps live under `Apps/<app-id>/` and are launched from there.

That means:

- The portable app goes where Lockbox expects it.
- Launching stays USB-local instead of depending on the host system.
- Uninstall is just folder removal from the drive.

## Security Notes

Lockbox is built to minimize host-machine residue. Unsigned executables may
trigger Windows SmartScreen the first time they run on a machine — use
**More info** → **Run anyway** if prompted (see `docs/DISTRIBUTION.md` for
details).

For how the vault itself is encrypted, and an honest assessment of what that
protects against (and what it doesn't), see [`docs/SECURITY.md`](docs/SECURITY.md).

## Notes On Portable Installation

If you use a portable installer or portable executable on the USB drive, the goal is to keep everything next to the app itself instead of writing into host locations like `%APPDATA%`, `HKLM`, or `HKCU`.

Lockbox already follows that model:

- The vault root is the USB drive's app location.
- Installed apps are written into `Apps/` on the same drive.
- The packaging scripts are designed to preserve user data on updates.

## Repository Layout

- `src/` - React frontend.
- `src-tauri/` - Rust backend and Tauri commands.
- `scripts/` - build and USB packaging helpers.
- `docs/` - distribution notes and packaging guidance.
- `README.md` - project overview and quick start.

## Useful Commands

```bash
npm run build
npm run tauri -- build
npm run build:windows
npm run version:update -- 0.1.1
```

## Troubleshooting

- If cloud sync fails, confirm that `rclone` exists in the `Tools/<os>/` folder on the USB drive.
- If an app install fails, reinstall it from the App Store and check the error message shown in the UI.
- If the drive still looks empty after launching, make sure you are running Lockbox from the USB copy, not a local build directory.

## License

Lockbox is licensed under the [Apache License 2.0](LICENSE).

That means you can use, modify, and redistribute the project under the terms of the license, including its patent grant and NOTICE requirements. Third-party dependencies and bundled app assets keep their own upstream licenses.
