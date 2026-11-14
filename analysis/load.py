"""Load raw collector CSVs into a DuckDB `obs` table with IST bucketing columns."""
from pathlib import Path

import duckdb

from analysis.index import INDEX_SQL, MINUTES_LOST_SQL

# IST is a fixed UTC+05:30 offset with no DST, so bucketing adds a constant
# interval to the naive UTC timestamp. This does not depend on the machine's
# time zone or on DuckDB's ICU extension.
IST_OFFSET_MINUTES = 330

_RAW_COLUMNS = (
    "{'observed_at_utc': 'VARCHAR', 'route_id': 'VARCHAR', 'live_s': 'VARCHAR',"
    " 'free_flow_s': 'VARCHAR', 'distance_m': 'VARCHAR', 'status': 'VARCHAR'}"
)


def load_raw(raw_dir: Path, route_ids: list[str], con: duckdb.DuckDBPyConnection) -> None:
    """Create table `obs` from raw_dir/*.csv, restricted to route_ids."""
    raw_dir = Path(raw_dir)
    files = sorted(raw_dir.glob("*.csv")) if raw_dir.is_dir() else []
    con.execute("DROP TABLE IF EXISTS obs")
    con.execute("DROP TABLE IF EXISTS _raw")
    if files:
        paths = [str(f) for f in files]
        con.execute(
            f"CREATE TEMP TABLE _raw AS SELECT * FROM read_csv(?, header = true,"
            f" columns = {_RAW_COLUMNS}, all_varchar = true)",
            [paths],
        )
    else:
        con.execute(
            "CREATE TEMP TABLE _raw (observed_at_utc VARCHAR, route_id VARCHAR, live_s VARCHAR,"
            " free_flow_s VARCHAR, distance_m VARCHAR, status VARCHAR)"
        )
    con.execute(
        f"""
        CREATE TABLE obs AS
        WITH typed AS (
            SELECT
                strptime(observed_at_utc, '%Y-%m-%dT%H:%M:%SZ') AS observed_at,
                route_id,
                TRY_CAST(NULLIF(trim(live_s), '') AS DOUBLE) AS live_s,
                TRY_CAST(NULLIF(trim(free_flow_s), '') AS DOUBLE) AS free_flow_s,
                TRY_CAST(NULLIF(trim(distance_m), '') AS DOUBLE) AS distance_m,
                status
            FROM _raw
            WHERE list_contains(?, route_id)
        ),
        scored AS (
            SELECT *,
                observed_at + INTERVAL {IST_OFFSET_MINUTES} MINUTE AS ist_ts,
                CASE WHEN status = 'ok' THEN {INDEX_SQL} END AS pain_index,
                CASE WHEN status = 'ok' THEN {MINUTES_LOST_SQL} END AS minutes_lost
            FROM typed
        )
        SELECT
            observed_at, route_id, live_s, free_flow_s, distance_m, status,
            pain_index, minutes_lost, ist_ts,
            CAST(ist_ts AS DATE) AS ist_date,
            CAST(isodow(ist_ts) - 1 AS INTEGER) AS weekday,
            strftime(time_bucket(INTERVAL 30 MINUTE, ist_ts), '%H:%M') AS slot,
            printf('%04d-W%02d', isoyear(ist_ts), weekofyear(ist_ts)) AS iso_week
        FROM scored
        """,
        [list(route_ids)],
    )
    con.execute("DROP TABLE _raw")
