#!/usr/bin/env bash
# Builds dist/Gothysis-Windows.zip: one Gothysis.exe (the app is embedded) plus README.txt.
# Gothysis opens in a Microsoft Edge app window (Edge ships with Windows 10/11), so no browser
# runtime is bundled. Needs Go 1.22+ and node (for the tests).
set -euo pipefail
cd "$(dirname "$0")"
node --test test/*.test.js
go vet ./... && go test ./...
mkdir -p dist/Gothysis
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o dist/Gothysis/Gothysis.exe .
cp README.txt dist/Gothysis/README.txt
rm -f dist/Gothysis-Windows.zip
python3 - <<'PY'
import zipfile
with zipfile.ZipFile("dist/Gothysis-Windows.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in ("Gothysis.exe", "README.txt"):
        z.write(f"dist/Gothysis/{f}", f"Gothysis/{f}")
PY
ls -lh dist/Gothysis/Gothysis.exe dist/Gothysis-Windows.zip
