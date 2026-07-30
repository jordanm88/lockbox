param(
    [string]$OutputDir = "build"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    if (-not (Test-Path "$repoRoot\package.json")) {
        throw "This script must be run from the repository root."
    }

    Write-Host "Installing npm dependencies if needed..."
    npm install | Out-Null

    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Warning "Cargo was not found on PATH. A Rust toolchain is required to build the Tauri Windows executable."
        Write-Warning "Install Rust with rustup: https://rustup.rs/"
        throw "cargo not found"
    }

    Write-Host "Building frontend..."
    npm run build

    Write-Host "Building Tauri Windows executable..."
    npx tauri build --target x86_64-pc-windows-msvc

    $builtExe = Join-Path $repoRoot "src-tauri\target\release\lockbox.exe"
    if (-not (Test-Path $builtExe)) {
        throw "Built executable not found at $builtExe. Ensure the Rust toolchain and Visual Studio/MSVC build tools are installed."
    }

    $outputPath = Join-Path $repoRoot $OutputDir
    if (-not (Test-Path $outputPath)) {
        New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
    }

    if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
        Unblock-File -Path $builtExe -ErrorAction SilentlyContinue
    }

    $destExe = Join-Path $outputPath "Lockbox-Windows.exe"
    Copy-Item -Path $builtExe -Destination $destExe -Force

    if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
        Unblock-File -Path $destExe -ErrorAction SilentlyContinue
        Write-Host "Built and unblocked: $destExe"
    } else {
        Write-Host "Built: $destExe"
        Write-Warning "Unable to automatically unblock the output file on this system. Use Unblock-File if Windows blocks it."
    }

    Write-Host "Windows build complete. Raw portable exe is in $outputPath"
} finally {
    Pop-Location
}
