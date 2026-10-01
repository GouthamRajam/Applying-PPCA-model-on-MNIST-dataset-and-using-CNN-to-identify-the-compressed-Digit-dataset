"""Mission data container and CSV import/export (Data Viewer / tagging)."""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


@dataclass
class MissionData:
    """One downloaded mission: temps[i, j] is sensor sensor_ids[j] at time t[i]."""
    t: np.ndarray                    # (N,) seconds from recording start
    temps: np.ndarray                # (N, S) degC
    sensor_ids: list[int]
    tags: dict[str, str] = field(default_factory=dict)  # tool, chamber, recipe, wafer id, ...

    def __post_init__(self):
        self.t = np.asarray(self.t, dtype=float)
        self.temps = np.asarray(self.temps, dtype=float)
        if self.temps.shape != (self.t.size, len(self.sensor_ids)):
            raise ValueError(f"temps shape {self.temps.shape} does not match "
                             f"({self.t.size}, {len(self.sensor_ids)})")

    def select(self, ids: list[int]) -> "MissionData":
        cols = [self.sensor_ids.index(i) for i in ids]
        return MissionData(self.t, self.temps[:, cols], list(ids), dict(self.tags))

    def window(self, t0: float, t1: float) -> "MissionData":
        m = (self.t >= t0) & (self.t <= t1)
        return MissionData(self.t[m], self.temps[m], list(self.sensor_ids), dict(self.tags))

    def tag(self, **tags: str) -> None:
        self.tags.update(tags)


def save_csv(data: MissionData, path: str | Path) -> None:
    """Writes '# key=value' tag lines, then 'time_s,S1,S2,...' rows."""
    with open(path, "w", newline="") as f:
        for k, v in data.tags.items():
            f.write(f"# {k}={v}\n")
        w = csv.writer(f)
        w.writerow(["time_s"] + [f"S{i}" for i in data.sensor_ids])
        for ti, row in zip(data.t, data.temps):
            w.writerow([f"{ti:.4f}"] + [f"{v:.4f}" for v in row])


def load_csv(path: str | Path) -> MissionData:
    tags: dict[str, str] = {}
    rows: list[list[str]] = []
    with open(path, newline="") as f:
        for line in f:
            if line.startswith("#"):
                k, _, v = line[1:].strip().partition("=")
                tags[k.strip()] = v.strip()
            elif line.strip():
                rows.append(next(csv.reader([line])))
    header, body = rows[0], np.array(rows[1:], dtype=float)
    ids = [int(h.lstrip("Ss")) for h in header[1:]]
    return MissionData(body[:, 0], body[:, 1:], ids, tags)
