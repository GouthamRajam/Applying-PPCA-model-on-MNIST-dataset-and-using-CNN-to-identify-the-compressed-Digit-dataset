import numpy as np
import pytest

from sensarray import interpolate, matching, spc
from sensarray.data import MissionData, load_csv, save_csv
from sensarray.gonogo import ControlLimit, Template, evaluate
from sensarray.metrics import spatial_stats, steady_state_window, summarize, transient_metrics
from sensarray.mission import (MissionConfig, StartCondition, TriggerDirection, WaferStatus,
                               max_length_s, recording_start_time)
from sensarray.simulate import synthetic_mission
from sensarray.wafer import SensorState, ring_layout


@pytest.fixture
def layout():
    return ring_layout()


def test_layout_65_sensors_inside_wafer(layout):
    assert len(layout.sensors) == 65
    assert max(s.radius_mm for s in layout.sensors) <= layout.radius_mm


def test_factory_disabled_cannot_be_changed(layout):
    layout.sensors[0].state = SensorState.FACTORY_DISABLED
    with pytest.raises(ValueError):
        layout.set_state(1, SensorState.ENABLED)
    layout.set_state(2, SensorState.DISABLED)
    assert 1 not in layout.enabled_ids() and 2 not in layout.enabled_ids()


def test_max_length_scales_with_sensors_and_period():
    assert max_length_s(6500, 65, 1.0) == pytest.approx(100.0)
    assert max_length_s(6500, 65, 2.0) == pytest.approx(200.0)
    assert max_length_s(6500, 13, 1.0) == pytest.approx(500.0)
    assert max_length_s(6500, 65, 1.0, battery_limit_s=50) == 50


def test_mission_validation():
    MissionConfig(acquisition_time_s=100).validate(max_len_s=200)
    with pytest.raises(ValueError):
        MissionConfig(acquisition_time_s=300).validate(max_len_s=200)
    with pytest.raises(ValueError):
        MissionConfig(start_condition=StartCondition.AT_TEMPERATURE).validate()
    assert MissionConfig(sampling_period_s=0.5, acquisition_time_s=10).n_samples(99) == 21


def test_start_conditions():
    t = np.arange(0, 100.0)
    temps = 20 + t  # crosses 50 C at t = 30
    assert recording_start_time(MissionConfig(), t, temps, removed_at_s=3) == 3
    assert recording_start_time(MissionConfig(start_condition=StartCondition.AFTER_DELAY, delay_s=10),
                                t, temps) == 10
    cfg = MissionConfig(start_condition=StartCondition.AT_TEMPERATURE, trigger_temp_c=50, delay_s=5)
    assert recording_start_time(cfg, t, temps) == 35  # delay counts AFTER the trigger
    cool = MissionConfig(start_condition=StartCondition.AT_TEMPERATURE, trigger_temp_c=10,
                         trigger_direction=TriggerDirection.FALLING)
    assert recording_start_time(cool, t, temps) is None


def test_wafer_readiness():
    s = WaferStatus("W1", "2.1.90", 10, 0.01, 100, 5)
    assert len(s.readiness(mission_length_s=600)) == 2


def test_spatial_stats_known_values():
    st = spatial_stats(np.array([[99.0, 100.0, 101.0]]))
    assert st["mean"][0] == 100 and st["range"][0] == 2
    assert st["sigma"][0] == pytest.approx(1.0)
    assert st["nonuniformity_pct"][0] == pytest.approx(3.0)


def test_first_order_transient_recovers_tau():
    t = np.arange(0, 400, 0.5)
    y = 300 - 275 * np.exp(-t / 30.0)
    tm = transient_metrics(t, y, steady_value=300)
    assert tm.time_constant_s == pytest.approx(30, rel=1e-3)
    assert tm.rise_time_s == pytest.approx(30 * np.log(9), rel=1e-2)
    assert tm.overshoot_pct == pytest.approx(0, abs=1e-9)
    assert tm.settling_time_s == pytest.approx(30 * np.log(275), abs=0.6)


def test_overshoot():
    t = np.arange(0, 100.0)
    y = np.concatenate([np.linspace(0, 110, 20), np.full(80, 100.0)])
    assert transient_metrics(t, y, steady_value=100).overshoot_pct == pytest.approx(10)


def test_steady_state_window_finds_plateau():
    t = np.arange(0, 200.0)
    y = np.where(t < 50, 25 + 6 * t, 325.0)
    ss = steady_state_window(t, y, pick="extreme")
    assert ss[0] <= 52 and ss[1] == 199


def test_csv_roundtrip(tmp_path, layout):
    d = synthetic_mission(layout, duration_s=20, tags={"chamber": "PM1", "recipe": "R1"})
    save_csv(d, tmp_path / "m.csv")
    e = load_csv(tmp_path / "m.csv")
    assert e.sensor_ids == d.sensor_ids and e.tags == d.tags
    np.testing.assert_allclose(e.temps, d.temps, atol=1e-3)


def test_interpolation_exact_at_sensors_and_recovers_plane(layout):
    xy = layout.positions()
    vals = 300 + 0.01 * xy[:, 0] - 0.02 * xy[:, 1]
    for method in ("tps", "idw"):
        np.testing.assert_allclose(interpolate.interpolate_points(xy, vals, xy, method), vals, atol=1e-6)
    q = np.array([[37.0, -12.0]])
    assert interpolate.interpolate_points(xy, vals, q)[0] == pytest.approx(300 + 0.37 + 0.24, abs=1e-6)


def test_radial_profile_bowl(layout):
    xy = layout.positions()
    vals = 300 + 4 * (np.hypot(xy[:, 0], xy[:, 1]) / layout.radius_mm) ** 2
    X, Y, Z = interpolate.wafer_map(xy, vals, layout.radius_mm, resolution_mm=5)
    r, prof = interpolate.radial_profile(X, Y, Z, n_bins=10)
    assert np.all(np.diff(prof) > 0)
    assert interpolate.center_to_edge(xy, vals, layout.radius_mm) > 0


def test_spc_limits_and_rules():
    ch = spc.imr_limits(np.array([10, 11, 10, 11, 10, 11.0]))
    assert ch.mr_bar == 1 and ch.sigma == pytest.approx(1 / 1.128)
    assert ch.ucl == pytest.approx(ch.center + 2.66 * ch.mr_bar, rel=1e-3)
    v = spc.western_electric(np.array([0, 0, 0, 3.5, 0, 2.5, 2.5, 0]), 0, 1)
    assert v[1] == [3] and 6 in v[2]
    assert spc.western_electric(np.full(8, 0.5), 0, 1)[4] == [7]
    assert spc.western_electric(np.array([1.5, 1.5, 0, 1.5, 1.5]), 0, 1)[3] == [4]
    cap = spc.capability(np.array([9.0, 10, 11]), lsl=4, usl=13)  # sigma = 1
    assert cap["cp"] == pytest.approx(1.5) and cap["cpk"] == pytest.approx(1.0)


def test_gonogo_and_template_roundtrip(tmp_path):
    t = Template("qual", [ControlLimit("ss_mean", 349, 351), ControlLimit("ss_range", usl=3)])
    assert evaluate({"ss_mean": 350, "ss_range": 2}, t).go
    res = evaluate({"ss_mean": 352, "ss_range": None}, t)
    assert not res.go and [d["pass"] for d in res.details] == [False, False]
    t.save(tmp_path / "t.json")
    assert Template.load(tmp_path / "t.json") == t
    base = Template.from_baseline("b", [{"m": 1.0}, {"m": 3.0}], ["m"], k_sigma=1)
    assert base.limits[0].lsl == pytest.approx(2 - np.sqrt(2))


def test_matching_detects_lag_and_offset(layout):
    ref = synthetic_mission(layout, seed=1)
    same = synthetic_mission(layout, seed=2)
    late_hot = synthetic_mission(layout, t_on=30, Tset=353, seed=3)
    c = matching.compare(late_hot, ref, ss_window=(200, 300))
    assert c.lag_s == pytest.approx(10, abs=1)
    assert np.mean(c.ss_sensor_delta) == pytest.approx(3, abs=0.1)
    assert 0 < c.mean_offset < 3  # ramp portion differs by less than the 3 C setpoint gap
    assert matching.compare(same, ref).matches(rms_tol=0.5, sensor_tol=0.5)
    rows = matching.chamber_matching(ref, {"good": same, "bad": late_hot}, ss_window=(200, 300))
    assert [r["chamber"] for r in rows] == ["good", "bad"] and rows[0]["match"] and not rows[1]["match"]
    names, M = matching.match_matrix({"a": ref, "b": same, "c": late_hot})
    assert M.shape == (3, 3) and np.allclose(M, M.T) and M[0, 2] > M[0, 1]


def test_summarize_end_to_end(layout):
    d = synthetic_mission(layout, tau=20, bowl=3)
    s = summarize(d, {"pick": "extreme"})
    assert s["ss_mean"] == pytest.approx(350 + 3 * np.mean(
        (np.hypot(*layout.positions().T) / layout.radius_mm) ** 2), abs=0.2)
    assert s["time_constant_s"] == pytest.approx(20, rel=0.05)
    assert isinstance(MissionData, type)
