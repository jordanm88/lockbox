//! Suppresses the console-window flash Windows shows when a GUI-subsystem
//! app spawns a console-subsystem helper (PowerShell, cmd, manage-bde,
//! rclone.exe, an NSIS installer, …). Every `std::process::Command` and
//! `tokio::process::Command` spawn of an external helper in this crate
//! should go through one of these instead of calling `.creation_flags(...)`
//! directly, so the platform gate lives in exactly one place.

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
pub fn hide_console(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console(_cmd: &mut std::process::Command) {
    // No console to flash on Linux desktops.
}

// `tokio::process::Command::creation_flags` is an inherent method on
// Windows (unlike `std::process::Command`'s, which comes from the
// `std::os::windows::process::CommandExt` trait) — no trait import needed
// or even accessible here; `tokio::process::CommandExt` exists in tokio's
// source but isn't publicly re-exported for this to `use`.
#[cfg(windows)]
pub fn tokio_hide_console(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn tokio_hide_console(_cmd: &mut tokio::process::Command) {}
