# SensArray-style calibration analytics

Open Python implementation of the math behind a SensArray calibration workflow.
It covers Mission Controller settings, uniformity metrics, the data interpolator,
SPC charting, templates with control limits and Go/No-Go, profile comparison,
and chamber matching. It runs on mission data exported to CSV.
Not affiliated with KLA. See [docs/SENSARRAY_RESEARCH.md](docs/SENSARRAY_RESEARCH.md)
for what is sourced and what is assumed, and for every formula.

```bash
pip install -r requirements.txt
python -m sensarray.demo      # end-to-end walkthrough on synthetic wafers
python -m pytest -q tests     # 17 tests
```

| Screen | Module |
|---|---|
| Mission Controller (start conditions, max length, wafer status, sensor states) | `sensarray/mission.py`, `sensarray/wafer.py` |
| Data Viewer / Modify Mission Tagging (CSV + tags) | `sensarray/data.py` |
| Uniformity, steady state, rise/settling/tau | `sensarray/metrics.py` |
| Data Interpolator (thin-plate spline / IDW, radial profile) | `sensarray/interpolate.py` |
| SPC Charting (I-MR, Western Electric, Cp/Cpk) | `sensarray/spc.py` |
| Create a Template / Create a Control Limit / Go-No-Go | `sensarray/gonogo.py` |
| Profile Comparison / Match Analyzer / Chamber Matching | `sensarray/matching.py` |

CSV format: optional `# key=value` tag lines, then a header `time_s,S1,S2,...`.

## Windows desktop app (`desktop/`)

Senson as a Windows app: watches the mission-data folder (default `C:\LAM SensArray`), opens new
mission files in Data Viewer automatically or after a pop-up, shows the USB/network link to the
SensArray FOUP (adapter on `192.168.10.x`), and saves exports to disk. It never sends anything to
the FOUP; missions are still started in the vendor software.

```bash
cd desktop
npm install && npm start      # run from source (Windows, macOS or Linux)
npm test                      # folder-watcher and link-check tests
bash build-win.sh             # -> dist/Senson-win-x64.zip (portable: unzip, run Senson.exe)
bash build-lite.sh            # -> dist/Senson-Windows.zip (~3 MB Senson.exe, needs Go)
```

`build-lite.sh` makes the small build (`desktop/lite/`, Go): one `Senson.exe` that serves the page on
127.0.0.1 and opens it in a Microsoft Edge app window (Edge is part of Windows 10/11), with the same
folder watcher, FOUP link check and file saving as the Electron build.

`build-win.sh` also writes `dist/parts/`: five 24 MB pieces plus `JOIN-Senson.bat`. Put them in one
folder on Windows and double-click the .bat; it joins them, unzips, and starts `Senson\Senson.exe`.
On the first run, Windows SmartScreen may warn about an unsigned app: choose More info → Run anyway.

## Gothysis (`gothysis/`)

A small desktop statistics app for Windows: distributions, Fit Y by X (regression, one-way ANOVA,
contingency), correlations, and PCA / probabilistic PCA (Tipping & Bishop) on CSV, TSV or .xlsx data.
One `Gothysis.exe` (Go) embeds the page in `gothysis/app/` and opens it in a Microsoft Edge app window;
the statistics run in `app/stats.js` and are checked against SciPy and scikit-learn values.
Independent tool, not affiliated with JMP or SAS.

```bash
cd gothysis
bash build.sh                 # tests, then dist/Gothysis-Windows.zip (Gothysis.exe + README.txt)
node --test test/*.test.js    # statistics tests only
```

`app/index.html` also works opened straight in a browser.

Add-ins (`.gaddin`, a zip with `addin.json` + JavaScript) add analyses and tools; see
[gothysis/docs/ADDINS.md](gothysis/docs/ADDINS.md). `gothysis/addins/process-capability/` is an
example. JMP `.jmpaddin` files are recognised and their contents reported, since JSL needs JMP.
