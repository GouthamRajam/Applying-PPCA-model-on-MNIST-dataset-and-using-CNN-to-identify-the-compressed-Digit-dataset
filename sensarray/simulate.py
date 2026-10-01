"""Synthetic missions for demos and tests (no real wafer needed).

Each sensor follows a first-order heating step with its own spatial offset:
    T_j(t) = T0 + (Tset + offset_j - T0) * (1 - exp(-(t - t_on)/tau))   for t >= t_on
    offset_j = bowl * (r_j / R)^2 + tilt * x_j / R        (center-to-edge + tilt)
plus Gaussian sensor noise.
"""
from __future__ import annotations

import numpy as np

from .data import MissionData
from .wafer import WaferLayout


def synthetic_mission(layout: WaferLayout, duration_s: float = 300.0, period_s: float = 1.0,
                      t_on: float = 20.0, T0: float = 25.0, Tset: float = 350.0, tau: float = 25.0,
                      bowl: float = 3.0, tilt: float = 0.0, noise: float = 0.05,
                      seed: int | None = 0, tags: dict | None = None) -> MissionData:
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, duration_s + period_s / 2, period_s)
    xy = layout.positions()
    R = layout.radius_mm
    offset = bowl * (np.hypot(xy[:, 0], xy[:, 1]) / R) ** 2 + tilt * xy[:, 0] / R
    rise = np.where(t >= t_on, 1 - np.exp(-(t - t_on) / tau), 0.0)
    temps = T0 + rise[:, None] * (Tset + offset[None, :] - T0)
    temps += rng.normal(0, noise, temps.shape)
    return MissionData(t, temps, layout.enabled_ids(), dict(tags or {}))
