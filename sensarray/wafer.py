"""Wafer sensor layout and sensor states (the wafer map in Mission Controller)."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import numpy as np


class SensorState(str, Enum):
    ENABLED = "enabled"
    DISABLED = "disabled"                  # turned off by the user for this mission
    FACTORY_DISABLED = "factory_disabled"  # turned off at calibration; user cannot re-enable


@dataclass
class Sensor:
    sensor_id: int
    x_mm: float
    y_mm: float
    state: SensorState = SensorState.ENABLED

    @property
    def radius_mm(self) -> float:
        return float(np.hypot(self.x_mm, self.y_mm))


@dataclass
class WaferLayout:
    diameter_mm: float
    sensors: list[Sensor] = field(default_factory=list)

    @property
    def radius_mm(self) -> float:
        return self.diameter_mm / 2.0

    def enabled(self) -> list[Sensor]:
        return [s for s in self.sensors if s.state == SensorState.ENABLED]

    def enabled_ids(self) -> list[int]:
        return [s.sensor_id for s in self.enabled()]

    def positions(self, ids: list[int] | None = None) -> np.ndarray:
        """(n, 2) array of x, y in mm for the given sensor ids (default: enabled)."""
        lookup = {s.sensor_id: s for s in self.sensors}
        ids = self.enabled_ids() if ids is None else ids
        return np.array([[lookup[i].x_mm, lookup[i].y_mm] for i in ids], dtype=float)

    def set_state(self, sensor_id: int, state: SensorState) -> None:
        sensor = next(s for s in self.sensors if s.sensor_id == sensor_id)
        if sensor.state == SensorState.FACTORY_DISABLED:
            raise ValueError(f"sensor {sensor_id} is factory disabled and cannot be changed")
        if state == SensorState.FACTORY_DISABLED:
            raise ValueError("factory-disabled state can only be set at calibration")
        sensor.state = state


def ring_layout(diameter_mm: float = 300.0, rings: tuple[int, ...] = (1, 8, 16, 24, 16),
                edge_exclusion_mm: float = 10.0) -> WaferLayout:
    """Concentric-ring sensor layout.

    The default (1+8+16+24+16 = 65 sensors on a 300 mm wafer) matches the published
    sensor count of the HighTemp-400 wafer. The exact factory coordinates are not public,
    so load the real coordinates from your wafer's sensor map when you have them.
    """
    usable = diameter_mm / 2.0 - edge_exclusion_mm
    n_rings = len(rings)
    sensors: list[Sensor] = []
    sid = 1
    for k, count in enumerate(rings):
        r = 0.0 if count == 1 and k == 0 else usable * k / (n_rings - 1)
        offset = np.pi / count if k % 2 else 0.0
        for j in range(count):
            theta = offset + 2 * np.pi * j / count
            sensors.append(Sensor(sid, r * np.cos(theta), r * np.sin(theta)))
            sid += 1
    return WaferLayout(diameter_mm, sensors)
