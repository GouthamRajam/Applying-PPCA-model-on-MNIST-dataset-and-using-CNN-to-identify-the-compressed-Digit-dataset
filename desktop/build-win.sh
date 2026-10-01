#!/usr/bin/env bash
# Builds a portable Windows app: dist/Senson-win-x64.zip (unzip, then run Senson.exe).
# Works on Linux/macOS/Git-Bash; needs curl, python3. No installer, no admin rights needed.
set -euo pipefail
cd "$(dirname "$0")"
EV=33.2.1
CACHE=.cache; OUT=dist/Senson; mkdir -p "$CACHE" dist
ZIP="$CACHE/electron-v$EV-win32-x64.zip"
[ -f "$ZIP" ] || curl -fL --retry 4 -o "$ZIP" "https://github.com/electron/electron/releases/download/v$EV/electron-v$EV-win32-x64.zip"
rm -rf "$OUT" && mkdir -p "$OUT"
python3 - "$ZIP" "$OUT" <<'PY'
import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
PY
mv "$OUT/electron.exe" "$OUT/Senson.exe"
rm -f "$OUT/resources/default_app.asar"
APP="$OUT/resources/app"; mkdir -p "$APP/app"
cp main.js preload.js watcher.js package.json "$APP/"
node prepare-app.js "$APP/app/index.html"
cp README-windows.txt "$OUT/README.txt"
rm -f dist/Senson-win-x64.zip
python3 - <<'PY'
import os, zipfile
with zipfile.ZipFile("dist/Senson-win-x64.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk("dist/Senson"):
        for f in files:
            p = os.path.join(root, f); z.write(p, os.path.relpath(p, "dist"))
PY
ls -lh dist/Senson-win-x64.zip
