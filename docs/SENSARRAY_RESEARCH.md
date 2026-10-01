# SensArray software: research notes and math reference

Not affiliated with KLA. Everything here is either (a) from public sources listed
at the bottom, (b) from the operator's own description of the screens, or
(c) marked **ASSUMPTION** where nothing public exists.

## 1. What the software is

| Item | Finding | Source |
|---|---|---|
| Product name | **SensArray Tools** ("SA Tools"); Mission Controller and Data Viewer are applications inside it | EtchTemp manual, Automation FOUP manual |
| Analysis suites | **PlasmaSuite** (PlasmaView, PlasmaControl) for etch wafers; **ThermalSuite** for high-temp wafers; common UI | KLA press release, AVS 2013 slides |
| Older tools | Thermal MAP 4 (with ISIS 5 wireless acquisition unit), Thermal TRACK | KLA / DirectIndustry |
| Mission types | **Automatic** (fab MES, Go/No-Go reported back), **User** (KT Automation Web UI), **Manual** (SA Tools on laptop) | Automation FOUP (AF100/AF120) manuals |
| Go/No-Go | Run reduced to a few control metrics, compared to user specs, one Go/No-Go per run; trends, excursions, chamber comparison | PlasmaControl description |
| Firmware | EtchTemp needs carrier firmware 2.1.90 or above | EtchTemp manual |
| Sensors | HT-400: 65 temperature sensors, intra-sensor interpolation; wireless up to ~4 Hz | AVS 2013 slides, IEEE 2017 |

## 2. Screens (operator description + manuals)

**Menu**
- Operations: Data Viewer, Manual Mission, Mission Controller
- Analysis: Go/No-Go, SPC Charting, Match Analyzer, Profile Comparison, Chamber Matching, Data Interpolator
- Configuration: Recipe Flow Configurator, Modify Mission Tagging, Create a Template, Create a Control Limit

**Mission Controller**
- FOUP auto-detected when the laptop connects. The status shows whether the wafer is ready.
  The manual warns that the FOUP LCD can update before the laptop does, so trust the laptop screen.
- Side panel: Battery, Usage time remaining, Usage time total, Temperature cycles, Wafer FW version, Fab Wafer ID
- Top: Run Mission, Cancel Mission, Manual Mission Download
- Acquisition Time: Max Length, or Custom (seconds)
- Sampling Period (s, e.g. 1.000), Delay Time (s, e.g. 0)
- **Start condition (from manual):**
  - *Start Immediately*: starts when the wafer is taken from its bay/station
  - *Start After Delay*: starts when the delay time expires
  - *Start at Temperature*: starts when the temperature trigger is met; **a delay only starts counting after the trigger**
- Wafer map: each sensor Enabled / Disabled / Factory Disabled
- Bottom: continuous status log (connection/IP, progress)

**Workflow (EtchTemp manual):** Start application, Run a Mission, Download and Tag Mission Data, Check Tagged Data, View Mission Data.

## 3. Math implemented (`sensarray/` package)

### Mission (`mission.py`)
- **ASSUMPTION, Max Length:** `max_time = memory_samples / n_enabled_sensors * sampling_period`, capped by battery.
  This explains why max length grows when you disable sensors or slow sampling. Replace `memory_samples` with the real value for your wafer.
- `n_samples = floor(acquisition_time / sampling_period) + 1`
- Start time: immediate = t_removed; after delay = t_removed + delay; at temperature = first crossing (hottest sensor when rising, coldest when falling) + delay.
- **ASSUMPTION, Factory Disabled:** cannot be changed by the user (set at calibration).

### Uniformity (`metrics.py`), per sample across S enabled sensors
```
mean = sum(T_j)/S        range = max - min
sigma = sqrt(sum(T_j - mean)^2/(S-1))      3sigma = 3*sigma
non-uniformity % = 100 * 3sigma / mean     (WIWNU convention, 0 % ideal)
```
Steady state: a rolling window where |slope| <= 0.05 °C/s and std <= 0.2 °C (both adjustable). Steady-state metrics use each sensor's time average inside that window.

### Transient (`metrics.py`), on the wafer-mean trace
```
rise time     = t(90%) - t(10%) of T0 -> Tss  (linear interpolation between samples)
overshoot %   = 100 * (peak - Tss)/(Tss - T0)
settling time = first time after which |m(t) - Tss| <= band forever
ramp rate     = max |dm/dt|
tau (lumped capacitance): m(t) = Tss - (Tss-T0) e^(-t/tau)
              => slope of ln((Tss-m)/(Tss-T0)) vs t = -1/tau  (fit on 5–95 %)
```
Check: for a first-order step, rise time = tau·ln 9 ≈ 2.197·tau (verified in tests).

### Data Interpolator (`interpolate.py`)
- Thin-plate spline: `T(x) = a0 + a1 x + a2 y + sum w_j r_j^2 ln r_j`. It passes exactly through the sensors and has no tuning parameter.
- Inverse-distance weighting: `T = sum(T_j/d_j^p) / sum(1/d_j^p)`. It never overshoots the measured range.
- Map stats on the gridded disk, radial profile (ring averages), center-to-edge delta.

### SPC (`spc.py`)
```
I-MR chart: sigma = MRbar/1.128;  UCL/LCL = xbar ± 3 sigma (= ± 2.66 MRbar);  MR UCL = 3.267 MRbar
Western Electric: (1) 1 pt > 3σ  (2) 2 of 3 > 2σ same side  (3) 4 of 5 > 1σ same side  (4) 8 in a row same side
Cp = (USL-LSL)/6σ    Cpk = min(USL-μ, μ-LSL)/3σ   (target Cpk >= 1.33)
```

### Templates / Control limits / Go-No-Go (`gonogo.py`)
- Template = named list of `{metric, LSL, USL, target}`, saved as JSON.
- Limits from known-good baseline: `mean ± k·sigma` (k = 3 default).
- GO only if every metric is within limits. A metric that can't be computed counts as NO-GO.

### Profile Comparison / Match Analyzer / Chamber Matching (`matching.py`)
1. Align: the lag maximizing cross-correlation of d(mean)/dt, so a late start isn't counted as a temperature error.
2. Resample both onto a common time grid.
3. `delta = A - B` per sensor/time. Report mean offset, RMS difference, max |delta|, Pearson r of the mean traces, and per-sensor steady-state delta.
4. Match if `RMS <= rms_tol` and `max|ss sensor delta| <= sensor_tol`. Rank chambers against a golden reference, plus a pairwise RMS matrix.

## 4. Still unknown publicly
Exact definitions inside KLA's Match Analyzer, Profile Comparison, Recipe Flow Configurator, Modify Mission Tagging, and the real memory size per wafer model. The full manuals are public FCC filings (links below). They were blocked by this environment's network policy, so only search-engine excerpts were used.

## Sources
- EtchTemp Wafer User Manual (FCC filing): https://fcc.report/FCC-ID/QTA-RFSC812A/2420628.pdf
- KLA Automation User Guide 9022549-000 (AF120): https://fcc.report/FCC-ID/QTA-AF120/4711400.pdf
- SensArray Automation FOUP User Manual (AF100): https://fccid.io/QTA-AF100/User-Manual/Users-Manual-3372429
- Wafer Based Temperature Metrology, AVS 2013: https://nccavs-usergroups.avs.org/wp-content/uploads/PAG2013/PA2013_11Wen.pdf
- KLA In Situ Process Management: https://www.kla.com/products/chip-manufacturing/in-situ-process-management
- KLA SensArray Etch Measurement Suite press release: https://ir.kla.com/news-events/press-releases/detail/348/kla-tencor-extends-metrology-portfolio-with-sensarray-etch
- HighTemp-400 in CVD tools (IEEE): https://ieeexplore.ieee.org/document/7969219/
- US 11,784,071 (wafer temperature calibration and data interpolation): https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11784071
- US 6,922,603 (quantifying wafer uniformity patterns): https://patents.google.com/patent/US6922603
- Western Electric rules / control limits: https://www.symestic.com/en-us/what-is/control-limits

## 5. Wafer Viewer behaviour (from Lam Research patent US7945085B2, via search excerpts)
- Interpolation: inverse distance, weight ∝ 1/rⁿ; Soft n = 2, Harsh n = 4, Normal = n from the number of sites (fewer sites → higher n).
- Point density: Low 50×50, Normal 100×100, High 200×200 interpolation grid.
- Statistics: mean, 3-sigma (3 × standard deviation about the mean), range; scale limits Max/Min, 3-sigma or user.
- Warning / control limits: sites above the upper or below the lower limit are highlighted; 1-sigma display mode.
- Spatial statistics: center-to-edge, side-to-side and annular selections; the selection is the "black region", the rest the "white region".
- Radial / angular distribution measured from the geometric center or the center of mass.
- Wafer collections: the first wafer sets the master site pattern; other wafers are interpolated onto it for layer math.
- Not found publicly: the exact center-of-mass formula ("Bias: Distance") and the exact "Normal" n formula.
Source: https://patents.google.com/patent/US7945085B2/en
