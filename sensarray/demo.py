"""End-to-end walkthrough on synthetic data:  python -m sensarray.demo"""
from __future__ import annotations

import numpy as np

from . import interpolate, matching, spc
from .gonogo import Template, evaluate
from .metrics import summarize
from .mission import (MissionConfig, StartCondition, WaferStatus, max_length_s,
                      recording_start_time)
from .simulate import synthetic_mission
from .wafer import SensorState, ring_layout

SS = {"pick": "extreme"}


def main() -> None:
    layout = ring_layout()
    layout.sensors[64].state = SensorState.FACTORY_DISABLED
    layout.set_state(40, SensorState.DISABLED)
    n = len(layout.enabled())
    print(f"Wafer: {len(layout.sensors)} sensors, {n} enabled")

    # --- Mission Controller ---------------------------------------------------
    status = WaferStatus("FAB-0001", "2.1.90", battery_pct=82, usage_time_remaining_h=120,
                         usage_time_total_h=380, temperature_cycles=211)
    max_len = max_length_s(memory_samples=2_000_000, n_enabled_sensors=n, sampling_period_s=1.0)
    cfg = MissionConfig(sampling_period_s=1.0, acquisition_time_s=300, delay_s=5,
                        start_condition=StartCondition.AT_TEMPERATURE, trigger_temp_c=40)
    cfg.validate(max_len)
    print(f"Max length at 1.000 s: {max_len:.0f} s; ready problems: "
          f"{status.readiness(cfg.acquisition_s(max_len)) or 'none'}")

    # --- Missions on three chambers + 10 baseline runs ------------------------
    ref = synthetic_mission(layout, tags={"chamber": "PM1"}, seed=1)
    pre = synthetic_mission(layout, seed=99)
    print(f"Start-at-temperature (40 C, +5 s delay) begins recording at "
          f"t = {recording_start_time(cfg, pre.t, pre.temps):.0f} s")
    chambers = {
        "PM2": synthetic_mission(layout, Tset=351.0, seed=2),
        "PM3": synthetic_mission(layout, Tset=346.0, bowl=6.0, t_on=28, seed=3),
    }

    s = summarize(ref, SS)
    print("\nPM1 summary:")
    for k in ("ss_mean", "ss_range", "ss_three_sigma", "ss_nonuniformity_pct",
              "rise_time_s", "overshoot_pct", "settling_time_s", "time_constant_s"):
        print(f"  {k:22s} {s[k]:.3f}")

    # --- Data Interpolator ----------------------------------------------------
    m = (ref.t >= s["ss_start_s"]) & (ref.t <= s["ss_end_s"])
    ss_vals = ref.temps[m].mean(axis=0)
    xy = layout.positions(ref.sensor_ids)
    X, Y, Z = interpolate.wafer_map(xy, ss_vals, layout.radius_mm, resolution_mm=5)
    ms = interpolate.map_stats(Z)
    print(f"\nInterpolated map: mean {ms['mean']:.2f}, range {ms['range']:.2f}, "
          f"center-to-edge {interpolate.center_to_edge(xy, ss_vals, layout.radius_mm):+.2f} C")

    # --- Template / Control limits / Go-No-Go ---------------------------------
    baseline = [summarize(synthetic_mission(layout, Tset=350 + 0.3 * np.sin(i), seed=10 + i), SS)
                for i in range(10)]
    tmpl = Template.from_baseline("350C qual", baseline, ["ss_mean", "ss_range", "rise_time_s"])
    for name, data in chambers.items():
        res = evaluate(summarize(data, SS), tmpl)
        bad = [d["metric"] for d in res.details if not d["pass"]]
        print(f"Go/No-Go {name}: {'GO' if res.go else 'NO-GO ' + str(bad)}")

    # --- SPC ------------------------------------------------------------------
    hist = np.array([b["ss_mean"] for b in baseline])
    chart = spc.imr_limits(hist)
    new = np.append(hist, [summarize(d, SS)["ss_mean"] for d in chambers.values()])
    print(f"\nSPC I-chart: CL {chart.center:.2f}  UCL {chart.ucl:.2f}  LCL {chart.lcl:.2f}")
    print(f"Western Electric violations: {spc.western_electric(new, chart.center, chart.sigma)}")
    print(f"Capability vs 345-355: {spc.capability(hist, 345, 355)}")

    # --- Chamber matching -----------------------------------------------------
    print("\nChamber matching vs PM1:")
    for row in matching.chamber_matching(ref, chambers, rms_tol=1.5, sensor_tol=2.0,
                                         ss_window=(s["ss_start_s"], s["ss_end_s"])):
        print(f"  {row['chamber']}: lag {row['lag_s']:+.0f} s, rms {row['rms_diff']:.2f}, "
              f"worst sensor {row['worst_sensor_delta']:.2f}, match={row['match']}")


if __name__ == "__main__":
    main()
