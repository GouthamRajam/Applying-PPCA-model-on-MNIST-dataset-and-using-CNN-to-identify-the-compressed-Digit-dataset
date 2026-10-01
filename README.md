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
