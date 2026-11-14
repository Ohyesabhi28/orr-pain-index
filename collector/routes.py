from dataclasses import dataclass
from pathlib import Path

import yaml

LAT_RANGE = (12.7, 13.3)
LON_RANGE = (77.3, 77.9)
_FIELDS = ("id", "name", "corridor", "direction")


@dataclass(frozen=True)
class Route:
    id: str
    name: str
    corridor: str
    direction: str
    points: tuple[tuple[float, float], ...]  # (lat, lon) in travel order


def _parse_point(route_id: str, raw) -> tuple[float, float]:
    if not isinstance(raw, (list, tuple)) or len(raw) != 2:
        raise ValueError(f"route {route_id}: point must be [lat, lon], got {raw!r}")
    try:
        lat, lon = float(raw[0]), float(raw[1])
    except (TypeError, ValueError):
        raise ValueError(f"route {route_id}: non-numeric point {raw!r}") from None
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LON_RANGE[0] <= lon <= LON_RANGE[1]):
        raise ValueError(f"route {route_id}: point {raw!r} is outside Bengaluru")
    return (lat, lon)


def load_routes(path: str | Path) -> list[Route]:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict) or not isinstance(data.get("routes"), list):
        raise ValueError("routes file must contain a 'routes' list")

    routes: list[Route] = []
    seen: set[str] = set()
    for entry in data["routes"]:
        if not isinstance(entry, dict):
            raise ValueError(f"route entry must be a mapping, got {entry!r}")
        for field in _FIELDS:
            if not isinstance(entry.get(field), str) or not entry[field]:
                raise ValueError(f"route {entry.get('id')!r}: missing or invalid '{field}'")
        route_id = entry["id"]
        if route_id in seen:
            raise ValueError(f"duplicate route id: {route_id}")
        seen.add(route_id)
        raw_points = entry.get("points")
        if not isinstance(raw_points, list) or len(raw_points) < 2:
            raise ValueError(f"route {route_id}: needs at least 2 points")
        points = tuple(_parse_point(route_id, p) for p in raw_points)
        routes.append(
            Route(route_id, entry["name"], entry["corridor"], entry["direction"], points)
        )
    return routes
