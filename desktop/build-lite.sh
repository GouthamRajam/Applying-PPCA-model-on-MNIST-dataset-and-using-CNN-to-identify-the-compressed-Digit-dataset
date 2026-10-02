#!/usr/bin/env bash
# Builds the small Windows app: dist/Senson-Windows.zip (about 3 MB) with a single Senson.exe.
# It opens Senson in a Microsoft Edge app window (Edge ships with Windows 10/11), so no browser
# runtime is bundled. Needs Go 1.22+ and node. Use build-win.sh for the self-contained Electron build.
set -euo pipefail
cd "$(dirname "$0")"
node prepare-app.js lite/app/index.html
cp brand/icon-32.png brand/icon-256.png lite/app/
# Windows resources: the Senson logo as the .exe icon, plus file version info.
(cd lite && go run github.com/tc-hib/go-winres@v0.3.3 make --in winres.json --arch amd64)
(cd lite && go vet ./... && go test ./... && \
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../dist/lite/Senson.exe .)
cp lite/README.txt dist/lite/README.txt
rm -f dist/Senson-Windows.zip
python3 - <<'PY'
import zipfile
with zipfile.ZipFile("dist/Senson-Windows.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in ("Senson.exe", "README.txt"):
        z.write(f"dist/lite/{f}", f"Senson/{f}")
PY
ls -lh dist/Senson-Windows.zip
