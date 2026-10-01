"""Data Interpolator: full-wafer temperature maps from discrete sensors.

Thin-plate spline (default) - radial basis kernel phi(r) = r^2 * ln(r) plus a
first-order polynomial; it passes exactly through every sensor and needs no
scale parameter:
    T(x) = a0 + a1*x + a2*y + sum_j w_j * phi(||x - x_j||)
Inverse-distance weighting (alternative, never overshoots the measured range):
    T(x) = sum_j T_j / d_j^p  /  sum_j 1 / d_j^p
Radial profile: average of the map over rings of equal radius (center-to-edge).
"""
from __future__ import annotations

import numpy as np
from scipy.interpolate import RBFInterpolator


def interpolate_points(xy_sensors: np.ndarray, values: np.ndarray, xy_query: np.ndarray,
                       method: str = "tps", smoothing: float = 0.0, power: float = 2.0) -> np.ndarray:
    xy_sensors = np.asarray(xy_sensors, dtype=float)
    values = np.asarray(values, dtype=float)
    xy_query = np.asarray(xy_query, dtype=float)
    if method == "tps":
        rbf = RBFInterpolator(xy_sensors, values, kernel="thin_plate_spline", smoothing=smoothing)
        return rbf(xy_query)
    if method == "idw":
        d = np.linalg.norm(xy_query[:, None, :] - xy_sensors[None, :, :], axis=2)
        exact = d < 1e-9
        w = 1.0 / np.where(exact, 1.0, d) ** power
        out = (w * values).sum(axis=1) / w.sum(axis=1)
        hit_rows, hit_cols = np.nonzero(exact)
        out[hit_rows] = values[hit_cols]
        return out
    raise ValueError(f"unknown method {method!r}")


def wafer_map(xy_sensors: np.ndarray, values: np.ndarray, radius_mm: float,
              resolution_mm: float = 2.0, method: str = "tps", **kw):
    """Gridded map over the wafer disk. Returns (X, Y, Z) with NaN outside the wafer."""
    g = np.arange(-radius_mm, radius_mm + resolution_mm / 2, resolution_mm)
    X, Y = np.meshgrid(g, g)
    inside = X ** 2 + Y ** 2 <= radius_mm ** 2
    Z = np.full(X.shape, np.nan)
    Z[inside] = interpolate_points(xy_sensors, values, np.column_stack([X[inside], Y[inside]]), method, **kw)
    return X, Y, Z


def map_stats(Z: np.ndarray) -> dict[str, float]:
    """Uniformity of the interpolated map (area-weighted, since grid cells are equal)."""
    z = Z[~np.isnan(Z)]
    mean = float(z.mean())
    sigma = float(z.std(ddof=1))
    return {"mean": mean, "min": float(z.min()), "max": float(z.max()),
            "range": float(z.max() - z.min()), "three_sigma": 3 * sigma,
            "nonuniformity_pct": 100 * 3 * sigma / abs(mean) if mean else float("nan")}


def radial_profile(X: np.ndarray, Y: np.ndarray, Z: np.ndarray, n_bins: int = 15):
    """Azimuthally averaged temperature vs radius. Returns (r_centers, mean_T)."""
    r = np.hypot(X, Y)
    ok = ~np.isnan(Z)
    edges = np.linspace(0, r[ok].max(), n_bins + 1)
    idx = np.clip(np.digitize(r[ok], edges) - 1, 0, n_bins - 1)
    sums = np.bincount(idx, weights=Z[ok], minlength=n_bins)
    counts = np.bincount(idx, minlength=n_bins)
    with np.errstate(invalid="ignore"):
        prof = sums / counts
    return 0.5 * (edges[:-1] + edges[1:]), prof


def center_to_edge(xy_sensors: np.ndarray, values: np.ndarray, radius_mm: float,
                   edge_fraction: float = 0.8) -> float:
    """Mean(edge sensors, r >= edge_fraction*R) - mean(center sensors, r <= (1-edge_fraction)*R).
    Positive = edge hotter than center."""
    r = np.linalg.norm(np.asarray(xy_sensors, dtype=float), axis=1)
    values = np.asarray(values, dtype=float)
    edge = values[r >= edge_fraction * radius_mm]
    center = values[r <= (1 - edge_fraction) * radius_mm]
    if edge.size == 0 or center.size == 0:
        raise ValueError("no sensors in the center or edge zone")
    return float(edge.mean() - center.mean())
