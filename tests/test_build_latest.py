import json
from datetime import datetime, timezone

import duckdb

from analysis.build import build
from analysis.load import load_raw
from collector.routes import Route
from tests.helpers import write_raw

NOW = datetime(2026, 11, 14, 6, 0, 0, tzinfo=timezone.utc)


def route(rid, name=None):
    return Route(rid, name or rid.upper(), "Corridor", "eastbound", ((12.9, 77.6), (12.95, 77.65)))


def run(tmp_path, routes, rows):
    raw, out = tmp_path / "raw", tmp_path / "out"
    if rows is not None:
        write_raw(raw, rows)
    build(routes, raw, out, NOW)
    latest = json.loads((out / "latest.json").read_text())
    rankings = json.loads((out / "rankings.json").read_text())
    return latest, rankings


def ok(ts, rid, live, free, dist=5000):
    return (ts, rid, live, free, dist, "ok")


def miss(ts, rid):
    return (ts, rid, None, None, None, "missing")


def test_latest_uses_most_recent_run(tmp_path):
    rows = [
        ok("2026-11-14T03:00:00Z", "a", 600, 600),
        ok("2026-11-14T03:30:00Z", "a", 1200, 600),
    ]
    latest, _ = run(tmp_path, [route("a")], rows)
    assert latest["generated_at_utc"] == "2026-11-14T06:00:00Z"
    assert latest["observed_at_utc"] == "2026-11-14T03:30:00Z"
    r = latest["routes"][0]
    assert r["status"] == "ok"
    assert r["live_s"] == 1200 and r["free_flow_s"] == 600 and r["distance_m"] == 5000
    assert r["pain_index"] == 50
    assert r["minutes_lost"] == 10.0
    assert r["name"] == "A" and r["corridor"] == "Corridor" and r["direction"] == "eastbound"


def test_latest_sorted_with_missing_last(tmp_path):
    ts = "2026-11-14T03:00:00Z"
    rows = [ok(ts, "a", 700, 600), miss(ts, "b"), ok(ts, "c", 1500, 600)]
    latest, _ = run(tmp_path, [route("a"), route("b"), route("c")], rows)
    assert [r["route_id"] for r in latest["routes"]] == ["c", "a", "b"]
    b = latest["routes"][2]
    assert b["status"] == "missing"
    assert b["live_s"] is None and b["pain_index"] is None and b["minutes_lost"] is None


def test_unknown_route_in_raw_is_ignored(tmp_path):
    ts = "2026-11-14T03:00:00Z"
    latest, rankings = run(tmp_path, [route("a")], [ok(ts, "a", 900, 600), ok(ts, "zzz", 3000, 600)])
    assert [r["route_id"] for r in latest["routes"]] == ["a"]
    assert [r["route_id"] for r in rankings["windows"]["7d"]] == ["a"]


def test_new_route_without_rows_is_missing(tmp_path):
    ts = "2026-11-14T03:00:00Z"
    latest, rankings = run(tmp_path, [route("a"), route("new")], [ok(ts, "a", 900, 600)])
    new = [r for r in latest["routes"] if r["route_id"] == "new"][0]
    assert new["status"] == "missing" and new["pain_index"] is None
    assert [r["route_id"] for r in rankings["windows"]["7d"]] == ["a"]


def test_no_raw_data(tmp_path):
    (tmp_path / "raw").mkdir()
    latest, rankings = run(tmp_path, [route("a"), route("b")], None)
    assert latest["observed_at_utc"] is None
    assert all(r["status"] == "missing" for r in latest["routes"])
    assert len(latest["routes"]) == 2
    assert rankings["windows"] == {"7d": [], "28d": []}


def test_no_raw_dir_at_all(tmp_path):
    latest, rankings = run(tmp_path, [route("a")], None)
    assert latest["observed_at_utc"] is None
    assert rankings["windows"] == {"7d": [], "28d": []}


def test_rankings_window(tmp_path):
    rows = [
        ok("2026-11-06T06:00:00Z", "a", 1200, 600),  # 8 days before NOW
        ok("2026-11-13T06:00:00Z", "b", 900, 600),
    ]
    _, rankings = run(tmp_path, [route("a"), route("b")], rows)
    assert [r["route_id"] for r in rankings["windows"]["7d"]] == ["b"]
    assert [r["route_id"] for r in rankings["windows"]["28d"]] == ["a", "b"]
    a = rankings["windows"]["28d"][0]
    assert a == {"route_id": "a", "name": "A", "avg_index": 50.0, "avg_minutes_lost": 10.0, "n": 1}


def test_rankings_exclude_future_rows(tmp_path):
    rows = [ok("2026-11-14T07:00:00Z", "a", 1200, 600)]
    _, rankings = run(tmp_path, [route("a")], rows)
    assert rankings["windows"] == {"7d": [], "28d": []}


def test_missing_rows_excluded_from_averages(tmp_path):
    rows = [
        ok("2026-11-13T03:00:00Z", "a", 1200, 600),
        ok("2026-11-13T03:30:00Z", "a", 900, 600),
        miss("2026-11-13T04:00:00Z", "a"),
    ]
    _, rankings = run(tmp_path, [route("a")], rows)
    a = rankings["windows"]["7d"][0]
    assert a["n"] == 2
    assert a["avg_index"] == 37.5
    assert a["avg_minutes_lost"] == 7.5


def test_reads_across_month_files(tmp_path):
    rows = [
        ok("2026-10-30T03:00:00Z", "a", 1200, 600),
        ok("2026-11-13T03:00:00Z", "a", 900, 600),
    ]
    _, rankings = run(tmp_path, [route("a")], rows)
    assert (tmp_path / "raw" / "2026-10.csv").exists() and (tmp_path / "raw" / "2026-11.csv").exists()
    assert rankings["windows"]["28d"][0]["n"] == 2
    assert rankings["windows"]["7d"][0]["n"] == 1


def test_obs_ist_columns(tmp_path):
    # 2026-11-13T20:00:00Z is 2026-11-14 01:30 IST, a Saturday
    write_raw(tmp_path / "raw", [ok("2026-11-13T20:00:00Z", "a", 900, 600), miss("2026-11-13T20:00:00Z", "a")])
    con = duckdb.connect()
    load_raw(tmp_path / "raw", ["a"], con)
    rows = con.execute(
        "SELECT ist_date::VARCHAR, weekday, slot, iso_week, pain_index, minutes_lost, status "
        "FROM obs ORDER BY status"
    ).fetchall()
    assert rows[0] == ("2026-11-14", 5, "01:30", "2026-W46", None, None, "missing")
    assert rows[1][:4] == ("2026-11-14", 5, "01:30", "2026-W46")
    assert rows[1][4] == 25
