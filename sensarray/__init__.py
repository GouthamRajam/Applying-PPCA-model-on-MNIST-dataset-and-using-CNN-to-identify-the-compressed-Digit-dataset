"""Open re-implementation of the analysis math behind a SensArray-style workflow:
mission setup, uniformity metrics, interpolation, SPC, Go/No-Go, and chamber matching.

Not affiliated with KLA. It works on mission data you export (CSV) from your own tool.
"""
from .data import MissionData, load_csv, save_csv
from .gonogo import ControlLimit, Template, evaluate
from .metrics import spatial_stats, steady_state_window, summarize, transient_metrics
from .mission import (MissionConfig, StartCondition, TriggerDirection, WaferStatus,
                      max_length_s, recording_start_time)
from .wafer import Sensor, SensorState, WaferLayout, ring_layout

__all__ = [
    "MissionData", "load_csv", "save_csv",
    "ControlLimit", "Template", "evaluate",
    "spatial_stats", "steady_state_window", "summarize", "transient_metrics",
    "MissionConfig", "StartCondition", "TriggerDirection", "WaferStatus",
    "max_length_s", "recording_start_time",
    "Sensor", "SensorState", "WaferLayout", "ring_layout",
]
