#!/usr/bin/env bash
# Packages a locally-built Lockbox app onto a USB drive laid out per the
# USB_ROOT / Vault / Apps / Tools convention.
#
# Run this AFTER `npm run tauri -- build` has produced the platform bundle
# for whichever OS you're running this script on (macOS or Linux — use
# scripts\package-usb.ps1 on Windows).
#
# Usage:
#   ./scripts/package-usb.sh /Volumes/LOCKBOX      # macOS
#   ./scripts/package-usb.sh /media/$USER/LOCKBOX  # Linux
set -euo pipefail

USB_ROOT="${1:-}"
if [[ -z "$USB_ROOT" ]]; then
  echo "Usage: $0 /path/to/usb/drive" >&2
  exit 1
fi
if [[ ! -d "$USB_ROOT" ]]; then
  echo "USB drive path '$USB_ROOT' does not exist." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/src-tauri/target/release/bundle"

download_rclone() {
  local dest_dir="$1"
  local os_name
  local arch_name
  local url
  local zip_path
  local extract_dir
  local source_path

  os_name="$(uname -s)"
  arch_name="$(uname -m)"

  case "$os_name" in
    Darwin)
      if [[ "$arch_name" == "arm64" ]]; then
        url="https://downloads.rclone.org/rclone-current-osx-arm64.zip"
      else
        url="https://downloads.rclone.org/rclone-current-osx-amd64.zip"
      fi
      ;;
    Linux)
      if [[ "$arch_name" == "aarch64" || "$arch_name" == "arm64" ]]; then
        url="https://downloads.rclone.org/rclone-current-linux-arm64.zip"
      else
        url="https://downloads.rclone.org/rclone-current-linux-amd64.zip"
      fi
      ;;
    *)
      echo "Unsupported OS for rclone download: $os_name" >&2
      return 1
      ;;
  esac

  zip_path="$(mktemp "${TMPDIR:-/tmp}/rclone-current.XXXXXX.zip")"
  extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/rclone-current.XXXXXX")"

  echo "Downloading current rclone release from $url ..."
  curl -fsSL "$url" -o "$zip_path"
  unzip -q "$zip_path" -d "$extract_dir"
  source_path="$(find "$extract_dir" -type f \( -name rclone -o -name rclone.exe \) | head -n 1)"

  if [[ -z "$source_path" ]]; then
    rm -rf "$extract_dir" "$zip_path"
    echo "rclone binary was not found in the downloaded archive." >&2
    return 1
  fi

  mkdir -p "$dest_dir"
  cp "$source_path" "$dest_dir/rclone"
  chmod +x "$dest_dir/rclone"
  rm -rf "$extract_dir" "$zip_path"
}

echo "Setting up USB folder layout at $USB_ROOT ..."
mkdir -p "$USB_ROOT/Vault" "$USB_ROOT/Apps" "$USB_ROOT/Tools/win" "$USB_ROOT/Tools/mac" "$USB_ROOT/Tools/linux"

OS_NAME="$(uname -s)"

if [[ "$OS_NAME" == "Darwin" ]]; then
  APP_BUNDLE=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app" 2>/dev/null | head -n 1)
  if [[ -z "$APP_BUNDLE" ]]; then
    echo "No .app bundle found under $BUNDLE_DIR/macos. Run 'npm run tauri -- build' first." >&2
    exit 1
  fi

  if [[ -d "$USB_ROOT/Lockbox-macOS.app" ]]; then
    echo "Backing up existing bundle to $USB_ROOT/Lockbox-macOS.app.bak ..."
    rm -rf "$USB_ROOT/Lockbox-macOS.app.bak"
    cp -R "$USB_ROOT/Lockbox-macOS.app" "$USB_ROOT/Lockbox-macOS.app.bak"
  fi

  rm -rf "$USB_ROOT/Lockbox-macOS.app"
  cp -R "$APP_BUNDLE" "$USB_ROOT/Lockbox-macOS.app"
  echo "Copied Lockbox-macOS.app to $USB_ROOT"
  echo "NOTE: macOS will quarantine this on first copy — see docs/DISTRIBUTION.md for the xattr workaround."

  RCLONE_DEST="$USB_ROOT/Tools/mac/rclone"
  download_rclone "$USB_ROOT/Tools/mac"

elif [[ "$OS_NAME" == "Linux" ]]; then
  APPIMAGE=$(find "$BUNDLE_DIR/appimage" -maxdepth 1 -name "*.AppImage" 2>/dev/null | head -n 1)
  if [[ -z "$APPIMAGE" ]]; then
    echo "No .AppImage found under $BUNDLE_DIR/appimage. Run 'npm run tauri -- build' first." >&2
    exit 1
  fi

  if [[ -f "$USB_ROOT/Lockbox-Linux.AppImage" ]]; then
    echo "Backing up existing AppImage to $USB_ROOT/Lockbox-Linux.AppImage.bak ..."
    rm -f "$USB_ROOT/Lockbox-Linux.AppImage.bak"
    cp "$USB_ROOT/Lockbox-Linux.AppImage" "$USB_ROOT/Lockbox-Linux.AppImage.bak"
  fi

  cp "$APPIMAGE" "$USB_ROOT/Lockbox-Linux.AppImage"
  chmod +x "$USB_ROOT/Lockbox-Linux.AppImage"
  echo "Copied Lockbox-Linux.AppImage to $USB_ROOT (chmod +x applied)"
  echo "NOTE: exFAT doesn't store the executable bit — you may need to re-run chmod +x each time it's remounted. See docs/DISTRIBUTION.md."

  RCLONE_DEST="$USB_ROOT/Tools/linux/rclone"
  download_rclone "$USB_ROOT/Tools/linux"

else
  echo "Unsupported OS: $OS_NAME (this script handles macOS and Linux; use scripts\\package-usb.ps1 on Windows)." >&2
  exit 1
fi

echo ""
echo "Done. USB layout:"
echo "  $USB_ROOT/Lockbox-*"
echo "  $USB_ROOT/Vault/"
echo "  $USB_ROOT/Apps/"
echo "  $USB_ROOT/Tools/{win,mac,linux}/"
