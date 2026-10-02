#!/usr/bin/env bash
# Builds dist/Gothysis-Windows.zip: one Gothysis.exe (the app is embedded), README.txt and the
# example add-ins (Add-ins/*.gaddin, packed from addins/).
# Gothysis opens in a Microsoft Edge app window (Edge ships with Windows 10/11), so no browser
# runtime is bundled. Needs Go 1.22+, node (for the tests) and python3 (for zipping).
set -euo pipefail
cd "$(dirname "$0")"
node --test test/*.test.js
go vet ./... && go test ./...
rm -rf dist/Gothysis && mkdir -p "dist/Gothysis/Add-ins"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o dist/Gothysis/Gothysis.exe .
cp README.txt dist/Gothysis/README.txt
python3 - <<'EOF'
import json, os, zipfile
# Each folder in addins/ becomes an installable .gaddin (a zip of the folder's contents).
for d in sorted(os.listdir("addins")):
    src = os.path.join("addins", d)
    if not os.path.isfile(os.path.join(src, "addin.json")):
        continue
    name = json.load(open(os.path.join(src, "addin.json")))["name"]
    with zipfile.ZipFile(f"dist/Gothysis/Add-ins/{name}.gaddin", "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(src):
            for f in sorted(files):
                p = os.path.join(root, f)
                z.write(p, os.path.relpath(p, src))
    print("packed", name + ".gaddin")
with zipfile.ZipFile("dist/Gothysis-Windows.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk("dist/Gothysis"):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, "dist"))
EOF
ls -lh dist/Gothysis/Gothysis.exe dist/Gothysis-Windows.zip
