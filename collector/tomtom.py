import logging
import time
from dataclasses import dataclass

import requests

from collector.routes import Route

log = logging.getLogger(__name__)

BASE_URL = "https://api.tomtom.com/routing/1/calculateRoute"
TIMEOUT_S = 20
RETRY_DELAY_S = 2


@dataclass(frozen=True)
class Observation:
    route_id: str
    live_s: int | None
    free_flow_s: int | None
    distance_m: int | None
    status: str  # "ok" or "missing"


class _Retryable(Exception):
    """Transient failure; carries only a key-free reason."""


def _missing(route: Route) -> Observation:
    return Observation(route.id, None, None, None, "missing")


def _request(route: Route, api_key: str, session: requests.Session) -> tuple[int, int, int]:
    coords = ":".join(f"{lat},{lon}" for lat, lon in route.points)
    params = {
        "key": api_key,
        "traffic": "true",
        "computeTravelTimeFor": "all",
        "routeType": "fastest",
        "travelMode": "car",
    }
    try:
        resp = session.get(f"{BASE_URL}/{coords}/json", params=params, timeout=TIMEOUT_S)
    except Exception as exc:  # message may embed the URL and key: keep only the type
        raise _Retryable(type(exc).__name__) from None
    if resp.status_code != 200:
        raise _Retryable(f"HTTP {resp.status_code}")
    try:
        summary = resp.json()["routes"][0]["summary"]
        return (
            int(summary["travelTimeInSeconds"]),
            int(summary["noTrafficTravelTimeInSeconds"]),
            int(summary["lengthInMeters"]),
        )
    except (ValueError, KeyError, IndexError, TypeError):
        raise _Retryable("malformed body") from None


def _in_bounds(live: int, free: int, dist: int) -> bool:
    return live > 0 and free > 0 and dist > 0 and live * 2 >= free


def fetch_route(route: Route, api_key: str, session: requests.Session,
                sleep=time.sleep) -> Observation:
    """One routing call (with a single retry). Never raises for API/network failures."""
    for attempt in (1, 2):
        try:
            live, free, dist = _request(route, api_key, session)
        except _Retryable as exc:
            log.warning("route %s attempt %d failed: %s", route.id, attempt, exc)
            if attempt == 1:
                sleep(RETRY_DELAY_S)
            continue
        if not _in_bounds(live, free, dist):
            log.warning("route %s out-of-bounds values live=%s free=%s dist=%s",
                        route.id, live, free, dist)
            return _missing(route)
        return Observation(route.id, live, free, dist, "ok")
    return _missing(route)
