#!/usr/bin/env bash
# Build the IRIDIA portable Windows x64 package and RAR archive.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER=$(node -p "require('$ROOT/package.json').version")
FFDIR=${FFDIR:-/home/claude/dl/gyan/ffmpeg-9.0.2-full_build}
OUT=${OUT:-/home/claude/build}
STAGE="$OUT/stage"
NAME="IRIDIA-$VER-portable-win64"
rm -rf "$STAGE" "$OUT/$NAME" "$OUT/IRIDIA-win32-x64"; mkdir -p "$STAGE"
cp -r "$ROOT/src" "$STAGE/src"
node -e "const p=require('$ROOT/package.json'); delete p.devDependencies; p.scripts={start:'electron .'}; require('fs').writeFileSync('$STAGE/package.json', JSON.stringify(p,null,2))"
(cd "$STAGE" && npm install --omit=dev --no-audit --no-fund >/dev/null)
# keep only the Windows x64 koffi binary
find "$STAGE/node_modules/koffi/build/koffi" -mindepth 1 -maxdepth 1 ! -name win32_x64 -exec rm -rf {} +
rm -rf "$STAGE/node_modules/koffi/src" "$STAGE/node_modules/koffi/vendor" "$STAGE/node_modules/koffi/doc"
cd "$OUT"
npx --prefix "$ROOT" electron-packager "$STAGE" IRIDIA --platform=win32 --arch=x64 --out="$OUT" --overwrite \
  --icon="$ROOT/src/renderer/assets/icon.ico" --electron-version=45.2.3 --no-asar --app-version="$VER" --build-version="$VER" \
  --app-copyright="IRIDIA contributors — GPL-3.0" \
  --win32metadata.CompanyName="IRIDIA" --win32metadata.FileDescription="IRIDIA CD Ripper" \
  --win32metadata.ProductName="IRIDIA" --win32metadata.InternalName="IRIDIA" --win32metadata.OriginalFilename="IRIDIA.exe" \
  --ignore='IRIDIA-data' --ignore='\.git'
mv "$OUT/IRIDIA-win32-x64" "$OUT/$NAME"
D="$OUT/$NAME"
# trim locales (English only UI)
find "$D/locales" -type f ! -name 'en-US.pak' ! -name 'en-GB.pak' -delete
mkdir -p "$D/ffmpeg"
cp "$FFDIR/bin/ffmpeg.exe" "$D/ffmpeg/"
cp "$FFDIR/LICENSE" "$D/ffmpeg/LICENSE-FFmpeg.txt"
cp "$FFDIR/README.txt" "$D/ffmpeg/README-FFmpeg-build.txt"
cp "$ROOT/dist-extras/README.txt" "$D/README.txt"
cp "$ROOT/LICENSE" "$D/LICENSE.txt"
mkdir -p "$D/IRIDIA-data"
echo "Portable data folder — settings are stored here. Delete it to reset IRIDIA." > "$D/IRIDIA-data/_readme.txt"
rm -f "$OUT/$NAME.rar"
(cd "$OUT" && rar a -r -m5 -ma5 -md128m -s -htb -rr3% -idq "$NAME.rar" "$NAME")
ls -la "$OUT/$NAME.rar"
