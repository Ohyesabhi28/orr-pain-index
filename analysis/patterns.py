"""Heatmap, best/worst departure and weekly-trend aggregates over the `obs` table."""
import math
from datetime import datetime, timedelta, timezone

from analysis.load import IST_OFFSET_MINUTES
from collector.routes import Route

SLOT_MINUTES = 30
FIRST_SLOT_MINUTES = 5 * 60 + 30  # 05:30
SLOT_COUNT = 36  # 05:30 .. 23:00
SLOTS = [
    f"{(FIRST_SLOT_MINUTES + i * SLOT_MINUTES) // 60:02d}:{(FIRST_SLOT_MINUTES + i * SLOT_MINUTES) % 60:02d}"
    for i in range(SLOT_COUNT)
]
# Peak windows as slot start times, end exclusive. "HH:MM" strings compare correctly.
PEAKS = {"morning": ("07:00", "11:00"), "evening": ("16:30", "21:00")}
MIN_CELL_OBS = 3
MIN_CELL_WEEKS = 3
# 1,000 of a possible 1,440 ok rows (20 routes x 72 runs): a day must be mostly collected.
MIN_DAY_ROWS = 1000
WORST_DAYS = 10


def _half_up(x: float) -> int:
    return math.floor(x + 0.5)


def _cells(route_id: str, con) -> dict[tuple[int, str], dict]:
    """Full 7 x 36 grid for one route; cells without enough data are `insufficient`."""
    rows = con.execute(
        "SELECT weekday, slot, count(*), count(DISTINCT iso_week), median(pain_index),"
        " median(minutes_lost) FROM obs"
        " WHERE route_id = ? AND status = 'ok' AND pain_index IS NOT NULL GROUP BY weekday, slot",
        [route_id],
    ).fetchall()
    agg = {(wd, slot): (n, weeks, mi, ml) for wd, slot, n, weeks, mi, ml in rows}
    grid = {}
    for wd in range(7):
        for slot in SLOTS:
            n, weeks, mi, ml = agg.get((wd, slot), (0, 0, None, None))
            is_ok = n >= MIN_CELL_OBS and weeks >= MIN_CELL_WEEKS
            grid[(wd, slot)] = {
                "weekday": wd, "slot": slot,
                "median_index": _half_up(mi) if is_ok else None,
                "n": n, "weeks": weeks,
                "status": "ok" if is_ok else "insufficient",
                "_minutes_lost": round(ml, 1) if is_ok else None,
            }
    return grid


def heatmap(route: Route, con) -> dict:
    cells = [{k: v for k, v in c.items() if not k.startswith("_")}
             for c in _cells(route.id, con).values()]
    return {"route_id": route.id, "name": route.name, "slot_minutes": SLOT_MINUTES, "cells": cells}


def _pick(cells: list[dict]) -> dict:
    """best/worst among ok cells (already in slot order, so min/max keep the earlier slot on ties)."""
    ok = [c for c in cells if c["status"] == "ok"]
    if not ok:
        return {"best": None, "worst": None}

    def shape(c):
        return {"slot": c["slot"], "median_index": c["median_index"],
                "median_minutes_lost": c["_minutes_lost"]}

    best = min(ok, key=lambda c: c["median_index"])
    worst = ok[0]
    for c in ok[1:]:
        if c["median_index"] > worst["median_index"]:
            worst = c
    if worst is best:  # a single cell or an all-tie window: no different slot to avoid
        return {"best": shape(best), "worst": None}
    return {"best": shape(best), "worst": shape(worst)}


def departures(route: Route, con) -> dict:
    grid = _cells(route.id, con)
    weekdays = []
    for wd in range(7):
        entry = {"weekday": wd}
        for name, (start, end) in PEAKS.items():
            entry[name] = _pick([grid[(wd, s)] for s in SLOTS if start <= s < end])
        weekdays.append(entry)
    return {"route_id": route.id, "name": route.name, "weekdays": weekdays}


def trends(con, now_utc: datetime, fmt) -> dict:
    now_ist = now_utc.astimezone(timezone.utc).replace(tzinfo=None) + timedelta(minutes=IST_OFFSET_MINUTES)
    current_week = (now_ist.date() - timedelta(days=now_ist.weekday())).isoformat()
    week_rows = con.execute(
        "SELECT (ist_date - CAST(weekday AS INTEGER))::VARCHAR AS week_start, route_id,"
        " avg(pain_index) FROM obs WHERE status = 'ok' AND pain_index IS NOT NULL"
        " GROUP BY 1, 2 ORDER BY 1, 2"
    ).fetchall()
    weeks: dict[str, dict] = {}
    for week_start, rid, avg in week_rows:
        w = weeks.setdefault(week_start, {"week_start": week_start,
                                          "partial": week_start == current_week, "routes": {}})
        w["routes"][rid] = round(avg, 1)
    first = con.execute("SELECT min(ist_date)::VARCHAR FROM obs").fetchone()[0]
    if first is not None:  # collection began mid-week: that first week is incomplete too
        first_date = datetime.strptime(first, "%Y-%m-%d").date()
        first_week = (first_date - timedelta(days=first_date.weekday())).isoformat()
        if first_date.weekday() != 0 and first_week in weeks:
            weeks[first_week]["partial"] = True
    day_rows = con.execute(
        "SELECT ist_date::VARCHAR, avg(pain_index), avg(minutes_lost) FROM obs"
        " WHERE status = 'ok' AND pain_index IS NOT NULL AND ist_date < CAST(? AS DATE)"
        " GROUP BY ist_date"
        " HAVING count(*) >= ? ORDER BY avg(pain_index) DESC, ist_date DESC LIMIT ?",
        [now_ist.date().isoformat(), MIN_DAY_ROWS, WORST_DAYS],
    ).fetchall()
    return {
        "generated_at_utc": fmt(now_utc),
        "weeks": list(weeks.values()),
        "worst_days": [{"date": d, "avg_index": round(i, 1), "avg_minutes_lost": round(m, 1)}
                       for d, i, m in day_rows],
    }
