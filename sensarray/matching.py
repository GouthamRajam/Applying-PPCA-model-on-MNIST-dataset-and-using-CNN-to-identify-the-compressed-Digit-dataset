"""Profile Comparison, Match Analyzer, and Chamber Matching.

Two missions A (test) and B (reference) are compared after:
  1. Time alignment - the lag that maximises the cross-correlation of the
     wafer-mean derivatives dA/dt and dB/dt (so a late start does not count
     as a temperature difference).
  2. Resampling onto a common time grid (linear interpolation).
Then, using only sensors present in both:
    delta_ij      = A_ij - B_ij                     (time i, sensor j)
    mean_offset   = mean(delta)
    rms_diff      = sqrt(mean(delta^2))
    max_abs_diff  = max |delta|
    profile_r     = Pearson correlation of the two mean traces
    ss_sensor_delta_j = steady-state mean of sensor j in A minus in B
A chamber MATCHES the reference when rms_diff <= rms_tol and
max |ss_sensor_delta| <= sensor_tol.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .data import MissionData


def best_lag(t: np.ndarray, a: np.ndarray, b: np.ndarray, max_lag_s: float) -> float:
    """Shift (s) to add to B's time axis so its profile lines up with A."""
    dt = float(np.median(np.diff(t)))
    da, db = np.gradient(a, t), np.gradient(b, t)
    da, db = da - da.mean(), db - db.mean()
    n = int(round(max_lag_s / dt))
    best, best_k = -np.inf, 0
    for k in range(-n, n + 1):
        if k >= 0:
            c = np.dot(da[k:], db[:len(db) - k])
        else:
            c = np.dot(da[:k], db[-k:])
        if c > best:
            best, best_k = c, k
    return best_k * dt


@dataclass
class Comparison:
    lag_s: float
    t: np.ndarray
    sensor_ids: list[int]
    delta: np.ndarray              # (N, S) A - B
    mean_offset: float
    rms_diff: float
    max_abs_diff: float
    profile_r: float
    ss_sensor_delta: np.ndarray | None

    def matches(self, rms_tol: float, sensor_tol: float) -> bool:
        ok = self.rms_diff <= rms_tol
        if self.ss_sensor_delta is not None:
            ok = ok and float(np.max(np.abs(self.ss_sensor_delta))) <= sensor_tol
        return bool(ok)


def compare(a: MissionData, b: MissionData, align: bool = True, max_lag_s: float = 30.0,
            dt: float | None = None, ss_window: tuple[float, float] | None = None) -> Comparison:
    """Compare test mission `a` against reference `b`.
    ss_window: steady-state window on A's time axis for the per-sensor deltas."""
    ids = [i for i in a.sensor_ids if i in b.sensor_ids]
    if not ids:
        raise ValueError("missions share no sensors")
    a, b = a.select(ids), b.select(ids)
    dt = dt or float(min(np.median(np.diff(a.t)), np.median(np.diff(b.t))))

    lag = 0.0
    if align:
        tg = np.arange(max(a.t[0], b.t[0]), min(a.t[-1], b.t[-1]), dt)
        lag = best_lag(tg, np.interp(tg, a.t, a.temps.mean(1)),
                       np.interp(tg, b.t, b.temps.mean(1)), max_lag_s)
    tb = b.t + lag
    t0, t1 = max(a.t[0], tb[0]), min(a.t[-1], tb[-1])
    if t1 <= t0:
        raise ValueError("missions do not overlap in time")
    t = np.arange(t0, t1 + dt / 2, dt)
    A = np.column_stack([np.interp(t, a.t, a.temps[:, j]) for j in range(len(ids))])
    B = np.column_stack([np.interp(t, tb, b.temps[:, j]) for j in range(len(ids))])
    d = A - B
    ma, mb = A.mean(1), B.mean(1)
    r = float(np.corrcoef(ma, mb)[0, 1]) if ma.std() > 0 and mb.std() > 0 else float("nan")

    ss = None
    if ss_window is not None:
        m = (t >= ss_window[0]) & (t <= ss_window[1])
        if m.any():
            ss = d[m].mean(axis=0)
    return Comparison(lag, t, ids, d, float(d.mean()), float(np.sqrt(np.mean(d ** 2))),
                      float(np.abs(d).max()), r, ss)


def chamber_matching(reference: MissionData, chambers: dict[str, MissionData],
                     rms_tol: float = 1.0, sensor_tol: float = 2.0, **kw) -> list[dict]:
    """Rank chambers against a golden/reference chamber (best match first)."""
    rows = []
    for name, data in chambers.items():
        c = compare(data, reference, **kw)
        rows.append({"chamber": name, "lag_s": c.lag_s, "mean_offset": c.mean_offset,
                     "rms_diff": c.rms_diff, "max_abs_diff": c.max_abs_diff,
                     "profile_r": c.profile_r,
                     "worst_sensor_delta": None if c.ss_sensor_delta is None
                     else float(np.max(np.abs(c.ss_sensor_delta))),
                     "match": c.matches(rms_tol, sensor_tol)})
    return sorted(rows, key=lambda r: r["rms_diff"])


def match_matrix(missions: dict[str, MissionData], **kw) -> tuple[list[str], np.ndarray]:
    """Pairwise RMS difference between every pair of chambers (symmetric matrix)."""
    names = list(missions)
    M = np.zeros((len(names), len(names)))
    for i, ni in enumerate(names):
        for j in range(i + 1, len(names)):
            M[i, j] = M[j, i] = compare(missions[ni], missions[names[j]], **kw).rms_diff
    return names, M
