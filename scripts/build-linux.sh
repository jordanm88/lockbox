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

# Tauri's AppImage bundler over-bundles libraries (libwayland-client above
# all) that must come from the host system, not be shipped inside the
# AppImage — see https://github.com/tauri-apps/tauri/issues/15665 and the
# matching CI step in .github/workflows/build.yml, which this mirrors.
# Left uncorrected, a bundled libwayland-client loaded against any host
# Mesa newer than this machine's makes EGL init fail on launch, aborting
# WebKitWebProcess before it ever paints anything — the window opens but
# stays permanently blank. Skipped gracefully (with a note) if
# appimagetool can't be fetched, rather than failing the whole build over
# what's still a usable — just not Mesa-25+-safe — AppImage.
APPIMAGE_DIR="$REPO_ROOT/src-tauri/target/release/bundle/appimage"
if [ -d "$APPIMAGE_DIR" ]; then
    for appimage in "$APPIMAGE_DIR"/*.AppImage; do
        [ -e "$appimage" ] || continue
        chmod +x "$appimage"
        workdir=$(mktemp -d)
        if (cd "$workdir" && "$appimage" --appimage-extract >/dev/null 2>&1) \
            && curl -sL -o "$workdir/appimagetool.AppImage" \
                https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage \
            && chmod +x "$workdir/appimagetool.AppImage"; then
            rm -f "$workdir"/squashfs-root/usr/lib/libwayland-client.so* \
                  "$workdir"/squashfs-root/usr/lib/libwayland-server.so* \
                  "$workdir"/squashfs-root/usr/lib/libglib-2.0.so* \
                  "$workdir"/squashfs-root/usr/lib/libgio-2.0.so* \
                  "$workdir"/squashfs-root/usr/lib/libgobject-2.0.so* \
                  "$workdir"/squashfs-root/usr/lib/libgmodule-2.0.so* \
                  "$workdir"/squashfs-root/usr/lib/libmount.so* \
                  "$workdir"/squashfs-root/usr/lib/libblkid.so* \
                  "$workdir"/squashfs-root/usr/lib/libselinux.so* \
                  "$workdir"/squashfs-root/usr/lib/libpcre2-8.so* \
                  "$workdir"/squashfs-root/usr/lib/libzstd.so* \
                  "$workdir"/squashfs-root/usr/lib/libelf.so* \
                  "$workdir"/squashfs-root/usr/lib/libffi.so*
            rm -f "$appimage"
            ARCH=x86_64 "$workdir/appimagetool.AppImage" --appimage-extract-and-run \
                "$workdir/squashfs-root" "$appimage"
            echo "Fixed over-bundled libraries in $(basename "$appimage")"
        else
            echo "warning: couldn't fix over-bundled AppImage libraries (offline? appimagetool unreachable?) — shipping as-is, may show a blank window on newer Mesa" >&2
        fi
        rm -rf "$workdir"
        [ -e "$appimage" ] && cp "$appimage" "$REPO_ROOT/$OUTPUT_DIR/"
        echo "Built: $REPO_ROOT/$OUTPUT_DIR/$(basename "$appimage")"
    done
fi

echo "Linux build complete. Output is in $REPO_ROOT/$OUTPUT_DIR"
