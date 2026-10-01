"""SPC Charting: individuals / moving-range chart, Western Electric rules, Cp/Cpk.

One point per mission (e.g. steady-state mean of every qualification run).
    MR_i   = |x_i - x_{i-1}|
    sigma  = MRbar / d2,   d2 = 1.128 (n = 2)
    UCL/LCL (X)  = xbar +/- 3 * sigma          (= xbar +/- 2.66 * MRbar)
    UCL (MR)     = D4 * MRbar, D4 = 3.267;  LCL (MR) = 0
Western Electric rules (zones measured from the center line in sigma):
    1: one point beyond 3 sigma
    2: 2 of 3 consecutive beyond 2 sigma, same side
    3: 4 of 5 consecutive beyond 1 sigma, same side
    4: 8 consecutive on the same side of the center line
Capability:
    Cp  = (USL - LSL) / (6 sigma)
    Cpk = min(USL - mu, mu - LSL) / (3 sigma)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

D2 = 1.128
D4 = 3.267


@dataclass
class ControlChart:
    center: float
    sigma: float
    ucl: float
    lcl: float
    mr_bar: float
    mr_ucl: float


def imr_limits(baseline: np.ndarray) -> ControlChart:
    """Compute limits from a baseline set of in-control runs (at least 2)."""
    x = np.asarray(baseline, dtype=float)
    if x.size < 2:
        raise ValueError("need at least 2 baseline points")
    mr_bar = float(np.mean(np.abs(np.diff(x))))
    sigma = mr_bar / D2
    c = float(x.mean())
    return ControlChart(c, sigma, c + 3 * sigma, c - 3 * sigma, mr_bar, D4 * mr_bar)


def western_electric(x: np.ndarray, center: float, sigma: float) -> dict[int, list[int]]:
    """Indices of the points that complete a violation of each rule."""
    x = np.asarray(x, dtype=float)
    z = (x - center) / sigma if sigma > 0 else np.zeros_like(x)
    out: dict[int, list[int]] = {1: [], 2: [], 3: [], 4: []}
    for i in range(len(x)):
        if abs(z[i]) > 3:
            out[1].append(i)
        for side in (1, -1):
            s = side * z
            if i >= 2 and np.sum(s[i - 2:i + 1] > 2) >= 2 and s[i] > 2:
                out[2].append(i)
            if i >= 4 and np.sum(s[i - 4:i + 1] > 1) >= 4 and s[i] > 1:
                out[3].append(i)
            if i >= 7 and np.all(s[i - 7:i + 1] > 0):
                out[4].append(i)
    return {k: sorted(set(v)) for k, v in out.items()}


def capability(x: np.ndarray, lsl: float | None = None, usl: float | None = None) -> dict[str, float | None]:
    x = np.asarray(x, dtype=float)
    mu, sigma = float(x.mean()), float(x.std(ddof=1))
    cp = (usl - lsl) / (6 * sigma) if lsl is not None and usl is not None and sigma > 0 else None
    sides = []
    if usl is not None:
        sides.append((usl - mu) / (3 * sigma))
    if lsl is not None:
        sides.append((mu - lsl) / (3 * sigma))
    cpk = min(sides) if sides and sigma > 0 else None
    return {"mean": mu, "sigma": sigma, "cp": cp, "cpk": cpk}
