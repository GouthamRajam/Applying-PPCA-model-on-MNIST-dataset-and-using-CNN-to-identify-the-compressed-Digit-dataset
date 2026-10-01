"""Temperature metrics: spatial uniformity, steady state, and transient response.

Spatial (per time sample, across the S enabled sensors):
    mean      = sum(T_j) / S
    range     = max(T_j) - min(T_j)
    sigma     = sqrt( sum (T_j - mean)^2 / (S - 1) )        (sample std dev)
    3sigma    = 3 * sigma                                   (WIWNU convention)
    nonunif % = 100 * 3sigma / mean                         (0 % is ideal)

Transient (on the wafer-mean trace m(t), from T0 = m(0) to Tss = steady value):
    rise time      = t(90 %) - t(10 %) of the step T0 -> Tss
    overshoot %    = 100 * (peak - Tss) / (Tss - T0)
    settling time  = first time after which m(t) stays within +/- band of Tss
    ramp rate      = max |dm/dt|  (degC/s)
    time constant  tau from the lumped-capacitance model
                   m(t) = Tss - (Tss - T0) * exp(-t / tau)
                   => ln((Tss - m)/(Tss - T0)) = -t / tau   (least-squares slope)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .data import MissionData


def spatial_stats(temps: np.ndarray) -> dict[str, np.ndarray]:
    """Per-sample statistics across sensors. temps: (N, S) -> dict of (N,) arrays."""
    temps = np.atleast_2d(temps)
    mean = temps.mean(axis=1)
    sigma = temps.std(axis=1, ddof=1) if temps.shape[1] > 1 else np.zeros(len(temps))
    with np.errstate(divide="ignore", invalid="ignore"):
        nonunif = np.where(mean != 0, 100.0 * 3 * sigma / np.abs(mean), np.nan)
    return {
        "mean": mean,
        "min": temps.min(axis=1),
        "max": temps.max(axis=1),
        "range": temps.max(axis=1) - temps.min(axis=1),
        "sigma": sigma,
        "three_sigma": 3 * sigma,
        "nonuniformity_pct": nonunif,
    }


def steady_state_window(t: np.ndarray, y: np.ndarray, window_s: float = 10.0,
                        max_slope: float = 0.05, max_std: float = 0.2,
                        pick: str = "longest") -> tuple[float, float] | None:
    """Stretch where a rolling window has |slope| <= max_slope (degC/s) and
    std <= max_std (degC). Returns (t_start, t_end) or None.

    pick: "longest" plateau, "last" plateau, or "extreme" (the plateau furthest
    from the starting temperature - use it to skip a long room-temperature wait)."""
    dt = float(np.median(np.diff(t)))
    w = max(3, int(round(window_s / dt)) + 1)
    if y.size < w:
        return None
    yw = sliding_window_view(y, w)
    tw = sliding_window_view(t, w)
    tc = tw - tw.mean(axis=1, keepdims=True)
    slope = (tc * (yw - yw.mean(axis=1, keepdims=True))).sum(axis=1) / (tc ** 2).sum(axis=1)
    ok = (np.abs(slope) <= max_slope) & (yw.std(axis=1) <= max_std)
    # every sample covered by an ok window is steady
    steady = np.zeros(y.size, dtype=bool)
    for i in np.flatnonzero(ok):
        steady[i:i + w] = True
    if not steady.any():
        return None
    edges = np.diff(np.concatenate(([0], steady.astype(int), [0])))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1) - 1
    if pick == "last":
        k = len(starts) - 1
    elif pick == "extreme":
        k = int(np.argmax([abs(y[s:e + 1].mean() - y[0]) for s, e in zip(starts, ends)]))
    elif pick == "longest":
        k = int(np.argmax(t[ends] - t[starts]))
    else:
        raise ValueError(f"unknown pick {pick!r}")
    return float(t[starts[k]]), float(t[ends[k]])


def _crossing_time(t: np.ndarray, y: np.ndarray, level: float, rising: bool) -> float | None:
    idx = np.flatnonzero(y >= level) if rising else np.flatnonzero(y <= level)
    if idx.size == 0:
        return None
    i = idx[0]
    if i == 0:
        return float(t[0])
    # linear interpolation between samples i-1 and i
    y0, y1 = y[i - 1], y[i]
    return float(t[i - 1] + (level - y0) * (t[i] - t[i - 1]) / (y1 - y0))


@dataclass
class TransientMetrics:
    t0_value: float
    steady_value: float
    rise_time_s: float | None
    overshoot_pct: float
    settling_time_s: float | None
    max_ramp_rate: float
    time_constant_s: float | None


def transient_metrics(t: np.ndarray, y: np.ndarray, steady_value: float | None = None,
                      settle_band: float = 1.0) -> TransientMetrics:
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    T0 = float(y[0])
    Tss = float(np.mean(y[-max(3, y.size // 10):])) if steady_value is None else float(steady_value)
    step = Tss - T0
    rising = step >= 0

    rise = None
    if abs(step) > 1e-9:
        t10 = _crossing_time(t, y, T0 + 0.1 * step, rising)
        t90 = _crossing_time(t, y, T0 + 0.9 * step, rising)
        if t10 is not None and t90 is not None:
            rise = t90 - t10

    peak = y.max() if rising else y.min()
    overshoot = 100.0 * (peak - Tss) / step if abs(step) > 1e-9 else 0.0
    overshoot = max(overshoot, 0.0)

    outside = np.flatnonzero(np.abs(y - Tss) > settle_band)
    if outside.size == 0:
        settling = float(t[0])
    elif outside[-1] == y.size - 1:
        settling = None  # never settles inside the band
    else:
        settling = float(t[outside[-1] + 1])

    ramp = float(np.max(np.abs(np.gradient(y, t)))) if y.size > 1 else 0.0

    tau = None
    if abs(step) > 1e-9:
        frac = (Tss - y) / step          # 1 at start, 0 at steady state
        m = (frac > 0.05) & (frac < 0.95)
        if m.sum() >= 3:
            slope = np.polyfit(t[m] - t[0], np.log(frac[m]), 1)[0]
            tau = float(-1.0 / slope) if slope < 0 else None

    return TransientMetrics(T0, Tss, rise, overshoot, settling, ramp, tau)


def summarize(data: MissionData, steady_kwargs: dict | None = None,
              settle_band: float = 1.0) -> dict[str, float | None]:
    """All headline metrics for one mission (inputs to Go/No-Go, SPC, matching)."""
    stats = spatial_stats(data.temps)
    mean_trace = stats["mean"]
    ss = steady_state_window(data.t, mean_trace, **(steady_kwargs or {}))
    out: dict[str, float | None] = {}
    if ss is not None:
        m = (data.t >= ss[0]) & (data.t <= ss[1])
        ss_temps = data.temps[m].mean(axis=0)   # time-averaged per-sensor steady temperature
        ss_stats = spatial_stats(ss_temps[None, :])
        out.update({
            "ss_start_s": ss[0], "ss_end_s": ss[1],
            "ss_mean": float(ss_stats["mean"][0]),
            "ss_min": float(ss_stats["min"][0]),
            "ss_max": float(ss_stats["max"][0]),
            "ss_range": float(ss_stats["range"][0]),
            "ss_three_sigma": float(ss_stats["three_sigma"][0]),
            "ss_nonuniformity_pct": float(ss_stats["nonuniformity_pct"][0]),
            "ss_temporal_std": float(mean_trace[m].std(ddof=1)) if m.sum() > 1 else 0.0,
        })
        steady_value = out["ss_mean"]
        # transient is analysed up to the end of the steady window
        tm = transient_metrics(data.t[data.t <= ss[1]], mean_trace[data.t <= ss[1]],
                               steady_value, settle_band)
    else:
        tm = transient_metrics(data.t, mean_trace, None, settle_band)
    out.update({
        "peak_max": float(data.temps.max()),
        "peak_range": float(stats["range"].max()),
        "start_mean": tm.t0_value,
        "rise_time_s": tm.rise_time_s,
        "overshoot_pct": tm.overshoot_pct,
        "settling_time_s": tm.settling_time_s,
        "max_ramp_rate": tm.max_ramp_rate,
        "time_constant_s": tm.time_constant_s,
    })
    return out
