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

#[cfg(windows)]
pub fn tokio_hide_console(cmd: &mut tokio::process::Command) {
    use tokio::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn tokio_hide_console(_cmd: &mut tokio::process::Command) {}
