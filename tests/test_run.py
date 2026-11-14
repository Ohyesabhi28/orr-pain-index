from datetime import datetime, timezone

import pytest

from collector import run
from collector.routes import Route
from collector.tomtom import Observation

HEADER = "observed_at_utc,route_id,live_s,free_flow_s,distance_m,status"
T = datetime(2026, 11, 14, 3, 7, 0, tzinfo=timezone.utc)


def ok(route_id, live=600):
    return Observation(route_id, live, 400, 5000, "ok")


def missing(route_id):
    return Observation(route_id, None, None, None, "missing")


def make_routes(n):
    return [Route(f"r{i}", "n", "ORR", "AtoB", ((12.95, 77.65), (12.97, 77.70)))
            for i in range(1, n + 1)]


def lines(path):
    return path.read_bytes().decode("utf-8").split("\n")


def write_routes_yaml(path, n):
    body = "routes:\n"
    for i in range(1, n + 1):
        body += (f"  - id: r{i}\n    name: n\n    corridor: ORR\n    direction: AtoB\n"
                 "    points: [[12.95, 77.65], [12.97, 77.70]]\n")
    path.write_text(body, encoding="utf-8")


def test_creates_file_with_header(tmp_path):
    path = run.append_rows([ok("r1"), ok("r2", 700)], T, tmp_path)
    assert path == tmp_path / "2026-11.csv"
    assert lines(path) == [
        HEADER,
        "2026-11-14T03:07:00Z,r1,600,400,5000,ok",
        "2026-11-14T03:07:00Z,r2,700,400,5000,ok",
        "",
    ]


def test_appends_without_second_header(tmp_path):
    run.append_rows([ok("r1")], T, tmp_path)
    path = run.append_rows([ok("r1")], T.replace(minute=22), tmp_path)
    content = lines(path)
    assert content.count(HEADER) == 1
    assert len(content) == 4  # header + 2 rows + trailing empty


def test_missing_row_has_empty_fields(tmp_path):
    path = run.append_rows([missing("r1")], T, tmp_path)
    assert lines(path)[1] == "2026-11-14T03:07:00Z,r1,,,,missing"


def test_file_named_by_utc_month(tmp_path):
    path = run.append_rows([ok("r1")], datetime(2026, 11, 30, 18, 37, 0, tzinfo=timezone.utc), tmp_path)
    assert path.name == "2026-11.csv"
    assert not (tmp_path / "2026-12.csv").exists()


def test_all_calls_fail_still_writes_and_exits_zero(tmp_path, monkeypatch):
    monkeypatch.setenv("TOMTOM_API_KEY", "k")
    routes_file = tmp_path / "routes.yaml"
    write_routes_yaml(routes_file, 20)
    raw = tmp_path / "raw"
    code = run.main(["--routes", str(routes_file), "--raw-dir", str(raw)],
                    fetch=lambda route: missing(route.id), now=lambda: T)
    assert code == 0
    rows = lines(raw / "2026-11.csv")[1:-1]
    assert len(rows) == 20
    assert all(r.endswith(",missing") for r in rows)


def test_same_run_timestamp_for_all_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("TOMTOM_API_KEY", "k")
    routes_file = tmp_path / "routes.yaml"
    write_routes_yaml(routes_file, 5)
    times = iter([T.replace(second=5), T.replace(second=50)])
    run.main(["--routes", str(routes_file), "--raw-dir", str(tmp_path)],
             fetch=lambda route: ok(route.id), now=lambda: next(times))
    stamps = {r.split(",")[0] for r in lines(tmp_path / "2026-11.csv")[1:-1]}
    assert stamps == {"2026-11-14T03:07:05Z"}


def test_timestamp_truncated_to_seconds(tmp_path):
    t = T.replace(microsecond=987654)
    path = run.append_rows([ok("r1")], t, tmp_path)
    assert lines(path)[1].startswith("2026-11-14T03:07:00Z,")


def test_collect_calls_fetch_per_route():
    obs = run.collect(make_routes(3), lambda r: ok(r.id))
    assert [o.route_id for o in obs] == ["r1", "r2", "r3"]


def test_main_without_key_exits_nonzero_and_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    routes_file = tmp_path / "routes.yaml"
    write_routes_yaml(routes_file, 2)
    raw = tmp_path / "raw"
    code = run.main(["--routes", str(routes_file), "--raw-dir", str(raw)], now=lambda: T)
    assert code != 0
    assert not raw.exists() or list(raw.iterdir()) == []
