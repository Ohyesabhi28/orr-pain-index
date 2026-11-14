"""Build the static JSON files the dashboard reads from raw collector CSVs."""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from analysis.load import load_raw
from collector.routes import Route, load_routes

_TS_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
WINDOWS = {"7d": 7, "28d": 28}


def _fmt(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime(_TS_FORMAT)


def _write_json(path: Path, data: dict) -> None:
    """Write via a temp file and rename so a failed build never leaves a partial file."""
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _num(value):
    """DuckDB DOUBLE -> int when whole, else float; None stays None."""
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


def _latest(routes: list[Route], con, now_utc: datetime) -> dict:
    (observed_at,) = con.execute("SELECT max(observed_at) FROM obs").fetchall()[0]
    by_route = {}
    if observed_at is not None:
        rows = con.execute(
            "SELECT route_id, status, live_s, free_flow_s, distance_m, pain_index, minutes_lost"
            " FROM obs WHERE observed_at = ?",
            [observed_at],
        ).fetchall()
        by_route = {r[0]: r for r in rows}
    entries = []
    for route in routes:
        row = by_route.get(route.id)
        entry = {"route_id": route.id, "name": route.name,
                 "corridor": route.corridor, "direction": route.direction}
        if row is None or row[1] != "ok":
            entry.update(status="missing", live_s=None, free_flow_s=None,
                         distance_m=_num(row[4]) if row else None,
                         pain_index=None, minutes_lost=None)
        else:
            entry.update(status="ok", live_s=_num(row[2]), free_flow_s=_num(row[3]),
                         distance_m=_num(row[4]), pain_index=row[5],
                         minutes_lost=round(row[6], 1))
        entries.append(entry)
    entries.sort(key=lambda e: (e["pain_index"] is None, -(e["pain_index"] or 0)))
    return {
        "generated_at_utc": _fmt(now_utc),
        "observed_at_utc": _fmt(observed_at.replace(tzinfo=timezone.utc)) if observed_at else None,
        "routes": entries,
    }


def _rankings(routes: list[Route], con, now_utc: datetime) -> dict:
    now_naive = now_utc.astimezone(timezone.utc).replace(tzinfo=None)
    names = {r.id: r.name for r in routes}
    windows = {}
    for label, days in WINDOWS.items():
        rows = con.execute(
            "SELECT route_id, avg(pain_index), avg(minutes_lost), count(*) FROM obs"
            " WHERE status = 'ok' AND pain_index IS NOT NULL"
            " AND observed_at > ? - to_days(?) AND observed_at <= ?"
            " GROUP BY route_id",
            [now_naive, days, now_naive],
        ).fetchall()
        ranked = [
            {"route_id": rid, "name": names[rid], "avg_index": round(idx, 1),
             "avg_minutes_lost": round(ml, 1), "n": n}
            for rid, idx, ml, n in rows if n > 0
        ]
        ranked.sort(key=lambda r: (-r["avg_index"], r["route_id"]))
        windows[label] = ranked
    return {"generated_at_utc": _fmt(now_utc), "windows": windows}


def build(routes: list[Route], raw_dir: Path, out_dir: Path, now_utc: datetime) -> None:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        load_raw(Path(raw_dir), [r.id for r in routes], con)
        latest = _latest(routes, con, now_utc)
        rankings = _rankings(routes, con, now_utc)
    finally:
        con.close()
    _write_json(out_dir / "latest.json", latest)
    _write_json(out_dir / "rankings.json", rankings)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build dashboard JSON from raw observations.")
    parser.add_argument("--routes", default="routes.yaml")
    parser.add_argument("--raw-dir", default="data/raw")
    parser.add_argument("--out-dir", default="data/public")
    args = parser.parse_args(argv)
    build(load_routes(args.routes), Path(args.raw_dir), Path(args.out_dir),
          datetime.now(timezone.utc).replace(microsecond=0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
