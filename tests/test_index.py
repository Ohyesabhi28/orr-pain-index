import duckdb, pytest
from analysis.index import pain_index, minutes_lost, INDEX_SQL, MINUTES_LOST_SQL

@pytest.mark.parametrize("live,free,expected", [
    (600, 600, 0), (900, 600, 25), (1200, 600, 50),
    (1800, 600, 100), (2400, 600, 100), (540, 600, 0),
    (603, 600, 0), (606, 600, 1),   # 0.25 -> 0, 0.5 -> 1 (half up)
])
def test_pain_index(live, free, expected):
    assert pain_index(live, free) == expected

def test_minutes_lost_clamped():
    assert minutes_lost(900, 600) == 5.0
    assert minutes_lost(540, 600) == 0.0

def test_sql_matches_python():
    for live, free in [(600, 600), (900, 600), (606, 600), (2400, 600), (540, 600)]:
        idx, lost = duckdb.sql(
            f"SELECT {INDEX_SQL}, {MINUTES_LOST_SQL} "
            f"FROM (SELECT {live} AS live_s, {free} AS free_flow_s)").fetchall()[0]
        assert idx == pain_index(live, free)
        assert lost == minutes_lost(live, free)
