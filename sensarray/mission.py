"""Mission Controller logic: mission settings, wafer status, start conditions.

Start conditions follow the published KLA manuals (EtchTemp Wafer User Manual):
  * Start Immediately   - mission starts when the wafer leaves its station/bay.
  * Start After Delay   - mission starts once the delay time has expired.
  * Start at Temperature - mission starts when the temperature trigger is met;
    if a delay is also set, the delay only starts counting AFTER the trigger.

"Max Length" is not defined publicly. Here it is modelled as the longest recording
the wafer memory and battery allow at the chosen sampling period (an assumption).
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np


class StartCondition(str, Enum):
    IMMEDIATE = "start_immediately"
    AFTER_DELAY = "start_after_delay"
    AT_TEMPERATURE = "start_at_temperature"


class TriggerDirection(str, Enum):
    RISING = "rising"    # start when temperature goes ABOVE the trigger
    FALLING = "falling"  # start when temperature goes BELOW the trigger


@dataclass
class WaferStatus:
    """The side panel in Mission Controller."""
    fab_wafer_id: str
    firmware_version: str
    battery_pct: float
    usage_time_remaining_h: float
    usage_time_total_h: float
    temperature_cycles: int

    def readiness(self, mission_length_s: float, min_battery_pct: float = 20.0) -> list[str]:
        """Reasons the wafer is NOT ready for this mission (empty list = ready)."""
        problems = []
        if self.battery_pct < min_battery_pct:
            problems.append(f"battery {self.battery_pct:.0f}% below {min_battery_pct:.0f}%")
        if self.usage_time_remaining_h * 3600 < mission_length_s:
            problems.append("usage time remaining is shorter than the mission")
        return problems


def max_length_s(memory_samples: int, n_enabled_sensors: int, sampling_period_s: float,
                 battery_limit_s: float | None = None) -> float:
    """Longest mission: memory holds `memory_samples` sensor readings in total.

    max_time = memory_samples / n_enabled * sampling_period, capped by battery.
    Fewer enabled sensors or a slower sampling period gives a longer mission.
    """
    if n_enabled_sensors <= 0 or sampling_period_s <= 0:
        raise ValueError("need at least one enabled sensor and a positive sampling period")
    t = memory_samples / n_enabled_sensors * sampling_period_s
    return min(t, battery_limit_s) if battery_limit_s is not None else t


@dataclass
class MissionConfig:
    sampling_period_s: float = 1.0
    acquisition_time_s: float | None = None   # None = "Max Length"
    delay_s: float = 0.0
    start_condition: StartCondition = StartCondition.IMMEDIATE
    trigger_temp_c: float | None = None
    trigger_direction: TriggerDirection = TriggerDirection.RISING

    def validate(self, max_len_s: float | None = None) -> None:
        if self.sampling_period_s <= 0:
            raise ValueError("sampling period must be > 0")
        if self.delay_s < 0:
            raise ValueError("delay time must be >= 0")
        if self.acquisition_time_s is not None:
            if self.acquisition_time_s <= 0:
                raise ValueError("custom acquisition time must be > 0")
            if max_len_s is not None and self.acquisition_time_s > max_len_s:
                raise ValueError(f"custom acquisition time exceeds max length ({max_len_s:.0f} s)")
        if self.start_condition == StartCondition.AT_TEMPERATURE and self.trigger_temp_c is None:
            raise ValueError("start at temperature needs a trigger temperature")

    def acquisition_s(self, max_len_s: float) -> float:
        return max_len_s if self.acquisition_time_s is None else self.acquisition_time_s

    def n_samples(self, max_len_s: float) -> int:
        return int(np.floor(self.acquisition_s(max_len_s) / self.sampling_period_s)) + 1


def recording_start_time(cfg: MissionConfig, t: np.ndarray, temps: np.ndarray,
                         removed_at_s: float = 0.0) -> float | None:
    """When recording begins, given the wafer's temperature history.

    t: (N,) seconds; temps: (N,) or (N, S) - the trigger uses the hottest sensor
    for RISING and the coldest for FALLING. Returns None if the trigger never fires.
    """
    if cfg.start_condition == StartCondition.IMMEDIATE:
        return removed_at_s
    if cfg.start_condition == StartCondition.AFTER_DELAY:
        return removed_at_s + cfg.delay_s
    temps = np.asarray(temps, dtype=float)
    if temps.ndim == 2:
        temps = temps.max(axis=1) if cfg.trigger_direction == TriggerDirection.RISING else temps.min(axis=1)
    after = t >= removed_at_s
    if cfg.trigger_direction == TriggerDirection.RISING:
        hit = np.flatnonzero(after & (temps >= cfg.trigger_temp_c))
    else:
        hit = np.flatnonzero(after & (temps <= cfg.trigger_temp_c))
    if hit.size == 0:
        return None
    return float(t[hit[0]]) + cfg.delay_s
