import argparse
import csv
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import requests

from collector.routes import Route, load_routes
from collector.tomtom import Observation, fetch_route

log = logging.getLogger(__name__)

HEADER = ["observed_at_utc", "route_id", "live_s", "free_flow_s", "distance_m", "status"]


def collect(routes: list[Route], fetch: Callable[[Route], Observation]) -> list[Observation]:
    return [fetch(route) for route in routes]


def _cell(value) -> str:
    return "" if value is None else str(value)


def append_rows(observations: list[Observation], observed_at: datetime, raw_dir: Path) -> Path:
    """Append one row per observation to raw_dir/YYYY-MM.csv (UTC month)."""
    observed_at = observed_at.astimezone(timezone.utc).replace(microsecond=0)
    stamp = observed_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / f"{observed_at:%Y-%m}.csv"
    write_header = not path.exists() or path.stat().st_size == 0
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        if write_header:
            writer.writerow(HEADER)
        for o in observations:
            writer.writerow([stamp, o.route_id, _cell(o.live_s), _cell(o.free_flow_s),
                             _cell(o.distance_m), o.status])
    return path


def main(argv: list[str] | None = None,
         fetch: Callable[[Route], Observation] | None = None,
         now: Callable[[], datetime] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect one observation per route.")
    parser.add_argument("--routes", default="routes.yaml")
    parser.add_argument("--raw-dir", default="data/raw")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if fetch is None:
        api_key = os.environ.get("TOMTOM_API_KEY")
        if not api_key:
            log.error("TOMTOM_API_KEY is not set")
            return 1
        session = requests.Session()

        def fetch(route: Route) -> Observation:
            return fetch_route(route, api_key, session)

    run_at = (now or (lambda: datetime.now(timezone.utc)))().replace(microsecond=0)
    routes = load_routes(args.routes)
    observations = collect(routes, fetch)
    path = append_rows(observations, run_at, Path(args.raw_dir))
    missing = sum(1 for o in observations if o.status != "ok")
    log.info("wrote %d rows (%d missing) to %s", len(observations), missing, path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
