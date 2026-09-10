# Building, packaging, and running Lockbox from a USB drive

Lockbox's primary distribution is the Windows portable exe described below —
a self-contained binary you run straight from a USB drive, with `Vault/` and
`Apps/` living right next to it. Sections 1 through 3 cover that flow end to
end. Linux is distributed differently, as a conventional `.deb` package —
see "Linux (.deb)" near the bottom for how that build works and how it
differs from the portable-exe model.

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

The packaging script creates the `Vault/`, `Apps/`, `Third Party Apps/`,
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
> existing `Vault/`, `Apps/`, `Third Party Apps/`, and `Tools/` content and
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

## Linux (.deb)

Unlike the Windows portable exe, the `.deb` installs Lockbox to a normal,
fixed system location (`/usr/bin/lockbox`), the same way any other
apt-installed application works. That means the "just run it from wherever
the exe sits" trick the Windows build relies on doesn't apply here — see
"Where the vault lives" below for what happens instead.

### Build

```
npm ci
npm run tauri -- build
```

Or the included helper script:

```bash
scripts/build-linux.sh
```

This builds the frontend, runs the Tauri Linux build, and copies the
resulting `.deb` into `build/`.

> Requires a Rust toolchain (via [rustup](https://rustup.rs/)) plus Tauri's
> Linux system prerequisites: `pkg-config`, `libwebkit2gtk-4.1-dev`,
> `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`,
> `patchelf`, and `build-essential`. On Debian/Ubuntu:
> `sudo apt-get install pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential`

This produces `src-tauri/target/release/Lockbox` (the raw Linux binary) and,
under `src-tauri/target/release/bundle/`, both `deb/*.deb` and
`appimage/*.AppImage` (Tauri's bundler builds every target valid for the
host OS since `tauri.conf.json`'s `bundle.targets` is `"all"`). CI
(`.github/workflows/build.yml`) builds this on `ubuntu-24.04` — a specific
version pinned rather than `ubuntu-latest` so the `.deb`'s glibc requirement
doesn't creep up whenever GitHub bumps the default runner, and 24.04
specifically (not 22.04) because the AppImage bundles its build system's
actual webkit2gtk/GLib/Mesa rather than just linking against them at
runtime — built on 22.04 (GLib 2.72), that bundle is old enough to fail
outright (EGL display creation errors, GIO module symbol mismatches) when
run on a reasonably current host, even one with a perfectly working native
GPU/EGL stack otherwise. Every GitHub release attaches both the `.deb` and
the `.AppImage` alongside the Windows artifacts.

### Install

```bash
sudo dpkg -i lockbox_<version>_amd64.deb
```

(or double-click it in a file manager that hands `.deb` files to GNOME
Software/KDE Discover). This installs `lockbox` as a normal application —
Start Menu-equivalent entry included — with no removable-drive requirement.
The AppImage needs no install step: `chmod +x` it and run it directly.

### Blank window on launch (AppImage especially)

If the window opens but stays completely blank — no error, nothing in the
console — this is WebKitGTK disagreeing with your GPU/driver combo (common
with proprietary NVIDIA drivers, some VM/software rendering setups, and
disproportionately common under AppImage). It's a widely reported
WebKitGTK/Tauri issue on Linux in general, not specific to Lockbox — see
Tauri's own [Linux Graphics
Issues](https://v2.tauri.app/develop/debug/linux-graphics/) troubleshooting
page. `lib.rs::apply_linux_webview_workarounds` sets all three of that
page's documented workarounds automatically before Tauri starts (unless
you've already set any of them yourself), so this shouldn't come up in
practice — but if it does anyway (e.g. running an older build), set them by
hand, in this order (each is a bigger hammer than the last):

```bash
__NV_DISABLE_EXPLICIT_SYNC=1 ./Lockbox.AppImage
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Lockbox.AppImage
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./Lockbox.AppImage
```

If none of these help, run it from a terminal and check for anything
printed to stdout/stderr — worth including if you end up filing an issue.
In particular, `Could not create default EGL display: EGL_BAD_PARAMETER`
alongside `undefined symbol` errors from `gio`/`gvfs` is a different,
more specific problem than the env vars above address: it means the
AppImage's *bundled* webkit2gtk/GLib/Mesa are too old for the host system
(see the CI base-image note above — this is exactly why it's built on
`ubuntu-24.04` rather than something older). If you're building locally,
building on a distro from roughly the last two years, not an old LTS
chosen only for glibc compatibility, is the actual fix; no environment
variable papers over a library version this far apart.

### Where the vault lives

On first launch, Lockbox tries to create `Vault/` next to its own binary
exactly like the Windows build does. Since `/usr/bin` isn't writable, that
fails, and Lockbox instead looks for a vault that's already plugged in — if
exactly one mounted removable drive (under `/media`, `/run/media`, or
`/mnt`) already has a `Vault/` on it, that's used automatically with no
prompt at all. This is what makes a drive set up on Windows "just work" the
first time it's plugged into a Linux machine, and vice versa: the vault
format itself (encryption, file index) has no OS dependency, so the only
thing that ever needed solving was *finding* it. If nothing's found (a
genuinely fresh drive/folder, or more than one candidate), Lockbox asks via
a native folder picker instead, starting from wherever it did find a
removable drive so there's minimal navigating even then. Whatever's chosen
or found is remembered in `~/.config/lockbox/config.json` and reused on
every later launch without asking again. Settings → "Vault Location" shows
the folder currently in use. If the remembered folder ever goes missing
(e.g. the drive it was on isn't plugged in, or the same drive mounts at a
different path this time), Lockbox re-detects/asks again rather than
failing outright.

Running the AppImage directly *from* a USB drive is a special case worth
calling out: `usb_root::find_usb_root` uses `$APPIMAGE` (the real path to
the `.AppImage` file, set by every AppImage runtime) rather than the
running binary's own location, specifically because those two differ.
FUSE-mounts it to a read-only path under `/tmp`; without FUSE (common on
current distros — see the AppImage note under "Build" above), it instead
*extracts* to a writable directory under `/tmp`. That second case is the
dangerous one if `$APPIMAGE` weren't checked first: the write would
silently succeed in that throwaway `/tmp` directory, so every launch would
create-or-reuse an unrelated, temporary vault there instead of ever
touching the real one on the drive — no error, no prompt, just silently
the wrong vault.

### Portable apps across OSes

Apps installed through the App Store live at `Apps/<app>/<os>/` (not just
`Apps/<app>/`), since a Windows build and a Linux build of the same app are
entirely different binaries — this lets the same drive carry both at once
without one overwriting the other when you install "the same" app from
both a Windows machine and a Linux machine. Only catalog entries with a
`linux` target (see `src-tauri/resources/catalog.json`) are installable on
Linux at all; anything without one just shows as unavailable there. Apps
installed by an older Lockbox version, before this per-OS split existed,
are still found and still launch — this only changes where a fresh
"Install" click puts new files, not what's already on a drive.

### Cloud Sync needs a system `rclone`

The `.deb` doesn't bundle an `rclone` binary the way a manually-assembled
portable USB layout can (`Tools/rclone` — see section 2 above). Install it
from your distro's package manager before using Cloud Sync:

```bash
sudo apt-get install rclone
```

### Eject and drive-encryption checks

The Windows build's "Eject USB" button and BitLocker-status check have real
Linux equivalents rather than just being disabled: eject unmounts and powers
off the drive via `udisksctl` (the same mechanism a file manager's own
"Eject" option uses), and the drive-encryption check looks for a LUKS
(`cryptsetup`) volume via `lsblk` instead of BitLocker. Both correctly report
"nothing to do here" when the vault is stored under `$HOME` on the main
disk rather than on a separate removable drive.

### Updates

The in-app updater can't swap a `.deb`-installed binary in place the way it
swaps the Windows portable exe — that file is owned by `dpkg`, and doing so
without root would either fail or drift out of sync with what `dpkg` thinks
is installed. Instead, "Update now" downloads the new release's `.deb` and
opens it with your desktop's package-install UI (GNOME Software, KDE
Discover, etc.), which handles the `sudo`/polkit prompt itself — Lockbox
never runs anything as root. Finish the install there, then relaunch
Lockbox.
