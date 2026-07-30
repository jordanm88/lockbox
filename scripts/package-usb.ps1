# Packages a locally-built Lockbox Windows executable onto a USB drive laid
# out per the USB_ROOT / Vault / Apps / Tools convention.
#
# Run this AFTER `npm run tauri -- build` has produced
# src-tauri\target\release\lockbox.exe.
#
# Usage:
#   .\scripts\package-usb.ps1 -UsbDrivePath E:\

param(
    [Parameter(Mandatory = $true)]
    [string]$UsbDrivePath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $UsbDrivePath)) {
    throw "USB drive path '$UsbDrivePath' does not exist. Plug in the drive and pass its path, e.g. -UsbDrivePath E:\"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$builtExe = Join-Path $repoRoot "src-tauri\target\release\lockbox.exe"

if (-not (Test-Path $builtExe)) {
    throw "Built executable not found at $builtExe. Run 'npm run tauri -- build' first."
}

Write-Host "Setting up USB folder layout at $UsbDrivePath ..."
foreach ($dir in @("Vault", "Apps", "Tools\win", "Tools\mac", "Tools\linux")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $UsbDrivePath $dir) | Out-Null
}

$destExe = Join-Path $UsbDrivePath "Lockbox-Windows.exe"

if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
    Unblock-File -Path $builtExe -ErrorAction SilentlyContinue
}
Copy-Item -Path $builtExe -Destination $destExe -Force

if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
    Unblock-File -Path $destExe -ErrorAction SilentlyContinue
    Write-Host "Copied and unblocked Lockbox-Windows.exe to $UsbDrivePath"
} else {
    Write-Host "Copied Lockbox-Windows.exe to $UsbDrivePath"
    Write-Warning "Unable to run Unblock-File on this PowerShell version. If Windows still blocks the exe, use: Unblock-File -Path '$destExe'"
}

$rcloneDest = Join-Path $UsbDrivePath "Tools\win\rclone.exe"
if (-not (Test-Path $rcloneDest)) {
    Write-Warning "No rclone.exe at Tools\win\rclone.exe yet. Cloud Sync (Phase 4) needs a real rclone binary there — download it from https://rclone.org/downloads/ and copy it in manually."
}

Write-Host ""
Write-Host "Done. USB layout:"
Write-Host "  $UsbDrivePath\Lockbox-Windows.exe"
Write-Host "  $UsbDrivePath\Vault\"
Write-Host "  $UsbDrivePath\Apps\"
Write-Host "  $UsbDrivePath\Tools\win\ (mac\, linux\ also created, empty)"
Write-Host ""
Write-Host "If Windows SmartScreen blocks the exe on first run, see docs/DISTRIBUTION.md."
