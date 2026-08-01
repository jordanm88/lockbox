# Packages a locally-built Lockbox Windows executable onto a USB drive laid
# out per the USB_ROOT / Vault / Apps / Tools convention.
#
# This script is update-safe for existing drives: it preserves any existing
# Vault/, Apps/, and Tools/ contents and only writes the new Lockbox binary.
#
# Run this AFTER `npm run tauri -- build` has produced
# src-tauri\target\release\Lockbox.exe.
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
$builtExe = Join-Path $repoRoot "src-tauri\target\release\Lockbox.exe"
$rcloneRoot = Join-Path $UsbDrivePath "Tools"
$rcloneExe = Join-Path $rcloneRoot "rclone.exe"

function Get-RcloneDownloadUri {
    if ([Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess) {
        return "https://downloads.rclone.org/rclone-current-windows-amd64.zip"
    }

    if ([Environment]::Is64BitOperatingSystem) {
        return "https://downloads.rclone.org/rclone-current-windows-amd64.zip"
    }

    return "https://downloads.rclone.org/rclone-current-windows-386.zip"
}

function Update-RcloneBinary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    New-Item -ItemType Directory -Force -Path $rcloneRoot | Out-Null

    $downloadUri = Get-RcloneDownloadUri
    $zipPath = Join-Path $env:TEMP "rclone-current.zip"
    $extractDir = Join-Path $env:TEMP ("rclone-" + [Guid]::NewGuid().ToString("N"))

    Write-Host "Downloading current rclone release from $downloadUri ..."
    Invoke-WebRequest -Uri $downloadUri -OutFile $zipPath

    try {
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        $sourceExe = Get-ChildItem -Path $extractDir -Recurse -Filter "rclone.exe" | Select-Object -First 1
        if (-not $sourceExe) {
            throw "rclone.exe was not found in the downloaded archive."
        }

        Copy-Item -Path $sourceExe.FullName -Destination $DestinationPath -Force
    }
    finally {
        Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path $builtExe)) {
    $legacyExe = Join-Path $repoRoot "src-tauri\target\release\lockbox.exe"
    if (Test-Path $legacyExe) {
        $builtExe = $legacyExe
    } else {
        throw "Built executable not found at $builtExe. Run 'npm run tauri -- build' first."
    }
}

Write-Host "Setting up USB folder layout at $UsbDrivePath ..."
foreach ($dir in @("Vault", "Apps", "Third Party Apps", "Tools")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $UsbDrivePath $dir) | Out-Null
}

$destExe = Join-Path $UsbDrivePath "Lockbox-Windows.exe"
$backupExe = Join-Path $UsbDrivePath "Lockbox-Windows.exe.bak"

if (Test-Path $destExe) {
    Write-Host "Backing up existing executable to Lockbox-Windows.exe.bak ..."
    Copy-Item -Path $destExe -Destination $backupExe -Force
}

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

Update-RcloneBinary -DestinationPath $rcloneExe
Write-Host "Updated rclone.exe at $rcloneExe from the current official release"

Write-Host ""
Write-Host "Done. USB layout:"
Write-Host "  $UsbDrivePath\Lockbox-Windows.exe"
Write-Host "  $UsbDrivePath\Vault\"
Write-Host "  $UsbDrivePath\Apps\"
Write-Host "  $UsbDrivePath\Third Party Apps\"
Write-Host "  $UsbDrivePath\Tools\rclone.exe"
Write-Host ""
Write-Host "If Windows SmartScreen blocks the exe on first run, see docs/DISTRIBUTION.md."
