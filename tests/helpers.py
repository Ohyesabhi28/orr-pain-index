import csv
from pathlib import Path

HEADER = ["observed_at_utc", "route_id", "live_s", "free_flow_s", "distance_m", "status"]


def write_raw(raw_dir: Path, rows: list[tuple]) -> None:
    """Write rows (observed_at_utc, route_id, live_s, free_flow_s, distance_m, status)
    into raw_dir/YYYY-MM.csv files. None becomes an empty field."""
    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    by_month: dict[str, list[tuple]] = {}
    for row in rows:
        by_month.setdefault(row[0][:7], []).append(row)
    for month, month_rows in by_month.items():
        with open(raw_dir / f"{month}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(HEADER)
            for r in month_rows:
                w.writerow(["" if v is None else v for v in r])
