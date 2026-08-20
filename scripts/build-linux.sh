#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-build}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "package.json" ]; then
    echo "This script must be run from the repository root." >&2
    exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
    echo "Cargo was not found on PATH. A Rust toolchain is required to build the Tauri Linux app." >&2
    echo "Install Rust with rustup: https://rustup.rs/" >&2
    exit 1
fi

echo "Installing npm dependencies if needed..."
npm install >/dev/null

echo "Building frontend..."
npm run build

echo "Building Tauri Linux app..."
npx tauri build --target x86_64-unknown-linux-gnu

BUILT_BIN="$REPO_ROOT/src-tauri/target/release/Lockbox"
if [ ! -f "$BUILT_BIN" ]; then
    echo "Built binary not found at $BUILT_BIN. Ensure the Rust toolchain and Tauri's Linux" >&2
    echo "prerequisites (pkg-config, libwebkit2gtk-4.1-dev, libgtk-3-dev," >&2
    echo "libayatana-appindicator3-dev, librsvg2-dev, patchelf) are installed — see" >&2
    echo "docs/DISTRIBUTION.md." >&2
    exit 1
fi

mkdir -p "$REPO_ROOT/$OUTPUT_DIR"

cp "$BUILT_BIN" "$REPO_ROOT/$OUTPUT_DIR/Lockbox-Linux"
chmod +x "$REPO_ROOT/$OUTPUT_DIR/Lockbox-Linux"
echo "Built: $REPO_ROOT/$OUTPUT_DIR/Lockbox-Linux"

DEB_DIR="$REPO_ROOT/src-tauri/target/release/bundle/deb"
if [ -d "$DEB_DIR" ]; then
    for deb in "$DEB_DIR"/*.deb; do
        [ -e "$deb" ] || continue
        cp "$deb" "$REPO_ROOT/$OUTPUT_DIR/"
        echo "Built: $REPO_ROOT/$OUTPUT_DIR/$(basename "$deb")"
    done
fi

echo "Linux build complete. Output is in $REPO_ROOT/$OUTPUT_DIR"
