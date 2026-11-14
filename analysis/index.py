"""Pain Index: how much worse than free-flow a route is, on a 0-100 scale."""
import math

# Live/free-flow ratio at which the index saturates at 100.
CEILING_RATIO: float = 3.0

_RATIO_SQL = "(live_s / free_flow_s)"

INDEX_SQL: str = (
    f"CAST(floor(least(greatest(({_RATIO_SQL} - 1) / ({CEILING_RATIO} - 1), 0), 1)"
    " * 100 + 0.5) AS INTEGER)"
)
MINUTES_LOST_SQL: str = "greatest((live_s - free_flow_s) / 60.0, 0)"


def pain_index(live_s: float, free_flow_s: float) -> int:
    ratio = live_s / free_flow_s
    scaled = min(max((ratio - 1) / (CEILING_RATIO - 1), 0), 1)
    return int(math.floor(scaled * 100 + 0.5))


def minutes_lost(live_s: float, free_flow_s: float) -> float:
    return max((live_s - free_flow_s) / 60.0, 0.0)
