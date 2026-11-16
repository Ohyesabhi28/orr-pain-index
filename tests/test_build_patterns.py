import json
from datetime import datetime, timezone

import duckdb

from analysis.build import build
from analysis.load import load_raw
from collector.routes import Route
from tests.helpers import write_raw

NOW = datetime(2026, 11, 14, 6, 0, 0, tzinfo=timezone.utc)  # Saturday, IST week of 2026-11-09


def route(rid, name=None):
    return Route(rid, name or rid.upper(), "Corridor", "eastbound", ((12.9, 77.6), (12.95, 77.65)))


def ok(ts, rid, index, dist=5000):
    """An ok row whose pain index equals `index` (free flow 600 s)."""
    live = 600 * (1 + index / 50)  # ratio = 1 + 2*index/100
    return (ts, rid, live, 600, dist, "ok")


def miss(ts, rid):
    return (ts, rid, None, None, None, "missing")


def run(tmp_path, routes, rows, now=NOW):
    raw, out = tmp_path / "raw", tmp_path / "out"
    raw.mkdir(parents=True, exist_ok=True)
    if rows:
        write_raw(raw, rows)
    build(routes, raw, out, now)
    return out


def read(out, name):
    return json.loads((out / name).read_text())


def cell(out, rid, weekday, slot):
    cells = read(out, f"heatmap/{rid}.json")["cells"]
    return [c for c in cells if c["weekday"] == weekday and c["slot"] == slot][0]


# 03:07 UTC = 08:37 IST -> slot 08:30. Mondays: Oct 26, Nov 2, Nov 9.
MONDAYS = ["2026-10-26", "2026-11-02", "2026-11-09"]


def monday_rows(indexes, rid="a", time="03:07:00"):
    return [ok(f"{d}T{time}Z", rid, i) for d, i in zip(MONDAYS, indexes)]


def test_cell_ok_with_three_weeks(tmp_path):
    out = run(tmp_path, [route("a")], monday_rows([20, 50, 80]))
    c = cell(out, "a", 0, "08:30")
    assert c == {"weekday": 0, "slot": "08:30", "median_index": 50, "n": 3, "weeks": 3, "status": "ok"}


def test_three_rows_same_week_is_insufficient(tmp_path):
    rows = [ok("2026-11-02T03:07:00Z", "a", i) for i in (20, 50, 80)]
    out = run(tmp_path, [route("a")], rows)
    c = cell(out, "a", 0, "08:30")
    assert c["median_index"] is None and c["status"] == "insufficient"
    assert c["n"] == 3 and c["weeks"] == 1


def test_two_weeks_is_insufficient(tmp_path):
    rows = monday_rows([20, 50, 80])[:2] + [ok("2026-11-02T03:20:00Z", "a", 60)]
    out = run(tmp_path, [route("a")], rows)
    c = cell(out, "a", 0, "08:30")
    assert c["status"] == "insufficient" and c["median_index"] is None
    assert c["n"] == 3 and c["weeks"] == 2


def test_ist_bucketing_crosses_utc_midnight(tmp_path):
    rows = [ok("2026-11-15T18:37:00Z", "a", 40), ok("2026-11-16T00:07:00Z", "a", 40)]
    write_raw(tmp_path / "raw", rows)
    con = duckdb.connect()
    load_raw(tmp_path / "raw", ["a"], con)
    got = con.execute("SELECT observed_at::VARCHAR, weekday, slot FROM obs ORDER BY observed_at").fetchall()
    assert got[0][1:] == (0, "00:00")  # Sunday UTC is Monday 00:07 IST
    assert got[1][1:] == (0, "05:30")
    out = run(tmp_path / "x", [route("a")], rows)
    cells = read(out, "heatmap/a.json")["cells"]
    assert sum(c["n"] for c in cells) == 1
    assert cell(out, "a", 0, "05:30")["n"] == 1


def test_heatmap_always_252_cells(tmp_path):
    out = run(tmp_path, [route("a"), route("empty", "Empty")], monday_rows([20, 50, 80]))
    for rid in ("a", "empty"):
        data = read(out, f"heatmap/{rid}.json")
        assert len(data["cells"]) == 252
        assert data["slot_minutes"] == 30 and data["route_id"] == rid
        slots = sorted({c["slot"] for c in data["cells"]})
        assert slots[0] == "05:30" and slots[-1] == "23:00" and len(slots) == 36
    empty = read(out, "heatmap/empty.json")
    assert empty["name"] == "Empty"
    assert all(c["status"] == "insufficient" and c["n"] == 0 and c["weeks"] == 0
               and c["median_index"] is None for c in empty["cells"])


def test_heatmap_no_raw_dir_at_all(tmp_path):
    out = tmp_path / "out"
    build([route("a")], tmp_path / "raw", out, NOW)
    assert len(read(out, "heatmap/a.json")["cells"]) == 252
    assert read(out, "departures/a.json")["weekdays"][0]["morning"] == {"best": None, "worst": None}
    assert read(out, "trends.json")["weeks"] == []


def test_median_index_rounds_half_up_and_ignores_missing(tmp_path):
    rows = monday_rows([20, 51, 80])  # median 51
    rows += [ok("2026-11-09T03:20:00Z", "a", 30)]  # even count in week 3 -> sorted 20,30,51,80 -> 40.5
    rows += [miss("2026-11-02T03:20:00Z", "a")]
    out = run(tmp_path, [route("a")], rows)
    c = cell(out, "a", 0, "08:30")
    assert c["n"] == 4 and c["weeks"] == 3
    assert c["median_index"] == 41  # 40.5 rounds half up


def _dep_rows(entries):
    """entries: {(slot_utc_time, index)} on three Mondays each."""
    rows = []
    for time, idx in entries:
        rows += monday_rows([idx] * 3, time=time)
    return rows


def test_departures_best_and_worst(tmp_path):
    # 01:37Z=07:07 IST(07:00) 03:07Z=08:30 04:37Z=10:00 ; evening 11:37Z=17:07 IST(17:00)
    rows = _dep_rows([("01:37:00", 30), ("03:07:00", 70), ("04:37:00", 50), ("11:37:00", 20)])
    out = run(tmp_path, [route("a")], rows)
    d = read(out, "departures/a.json")
    assert d["route_id"] == "a" and d["name"] == "A" and len(d["weekdays"]) == 7
    mon = d["weekdays"][0]
    assert mon["weekday"] == 0
    assert mon["morning"]["best"] == {"slot": "07:00", "median_index": 30, "median_minutes_lost": 6.0}
    assert mon["morning"]["worst"] == {"slot": "08:30", "median_index": 70, "median_minutes_lost": 14.0}
    assert mon["evening"]["best"]["slot"] == "17:00" == mon["evening"]["worst"]["slot"]
    assert d["weekdays"][1]["morning"] == {"best": None, "worst": None}


def test_departures_tie_goes_to_earlier_slot(tmp_path):
    rows = _dep_rows([("03:07:00", 40), ("01:37:00", 40), ("03:37:00", 40)])  # 08:30, 07:00, 09:00
    out = run(tmp_path, [route("a")], rows)
    m = read(out, "departures/a.json")["weekdays"][0]["morning"]
    assert m["best"]["slot"] == "07:00" and m["worst"]["slot"] == "07:00"


def test_departures_window_edges(tmp_path):
    # 11:00 IST (05:30Z) is outside morning; 16:30 IST (11:00Z) is inside evening; 21:00 (15:30Z) outside
    rows = _dep_rows([("05:30:00", 90), ("11:00:00", 10), ("15:30:00", 95)])
    d = read(run(tmp_path, [route("a")], rows), "departures/a.json")["weekdays"][0]
    assert d["morning"] == {"best": None, "worst": None}
    assert d["evening"]["best"]["slot"] == "16:30" and d["evening"]["worst"]["slot"] == "16:30"


def test_departures_null_without_ok_cells(tmp_path):
    rows = monday_rows([20, 50, 80])[:2]  # insufficient only
    d = read(run(tmp_path, [route("a")], rows), "departures/a.json")
    assert all(w["morning"] == {"best": None, "worst": None}
               and w["evening"] == {"best": None, "worst": None} for w in d["weekdays"])


def test_trends_week_start_is_ist_monday(tmp_path):
    # Sunday 2026-11-08 20:00Z = Monday 2026-11-09 01:30 IST -> week_start 2026-11-09
    rows = [ok("2026-11-08T20:00:00Z", "a", 40), ok("2026-11-08T03:00:00Z", "a", 20)]
    t = read(run(tmp_path, [route("a")], rows), "trends.json")
    assert t["generated_at_utc"] == "2026-11-14T06:00:00Z"
    assert [(w["week_start"], w["routes"]) for w in t["weeks"]] == [
        ("2026-11-02", {"a": 20.0}), ("2026-11-09", {"a": 40.0})]


def test_current_week_is_partial(tmp_path):
    rows = [ok("2026-11-04T03:00:00Z", "a", 20), ok("2026-11-12T03:00:00Z", "a", 40)]
    t = read(run(tmp_path, [route("a")], rows), "trends.json")
    assert [(w["week_start"], w["partial"]) for w in t["weeks"]] == [
        ("2026-11-02", False), ("2026-11-09", True)]


def test_worst_days_requires_40_rows(tmp_path):
    day_ok = [ok(f"2026-11-10T{h:02d}:{m:02d}:00Z", "a", 60) for h in range(2, 4) for m in range(0, 60, 3)][:40]
    day_few = [ok(f"2026-11-11T02:{m:02d}:00Z", "a", 90) for m in range(0, 39)]
    day_pad = [miss(f"2026-11-11T03:{m:02d}:00Z", "a") for m in range(0, 30)]
    t = read(run(tmp_path, [route("a")], day_ok + day_few + day_pad), "trends.json")
    assert t["worst_days"] == [{"date": "2026-11-10", "avg_index": 60.0, "avg_minutes_lost": 12.0}]


def test_worst_days_top_10_sorted(tmp_path):
    rows = []
    for day in range(1, 13):
        rows += [ok(f"2026-11-{day:02d}T{2 + m // 60:02d}:{m % 60:02d}:00Z", "a", day * 5) for m in range(40)]
    t = read(run(tmp_path, [route("a")], rows), "trends.json")
    assert len(t["worst_days"]) == 10
    assert t["worst_days"][0]["date"] == "2026-11-12" and t["worst_days"][-1]["date"] == "2026-11-03"


def test_month_rollover(tmp_path):
    rows = [ok("2026-11-30T18:37:00Z", "a", 40)]
    write_raw(tmp_path / "raw", rows)
    assert (tmp_path / "raw" / "2026-11.csv").exists()
    con = duckdb.connect()
    load_raw(tmp_path / "raw", ["a"], con)
    assert con.execute("SELECT ist_date::VARCHAR FROM obs").fetchall() == [("2026-12-01",)]
