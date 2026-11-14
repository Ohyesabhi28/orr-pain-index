from collections import Counter

import pytest

from collector.routes import Route, load_routes

VALID = """
routes:
  - id: silkboard-marathahalli
    name: Silk Board to Marathahalli
    corridor: Silk Board – Marathahalli
    direction: northbound
    points: [[12.9177, 77.6238], [12.9255, 77.6760], [12.9569, 77.7011]]
"""


def write(tmp_path, text):
    path = tmp_path / "routes.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def test_loads_valid_route(tmp_path):
    routes = load_routes(write(tmp_path, VALID))
    assert len(routes) == 1
    route = routes[0]
    assert isinstance(route, Route)
    assert route.id == "silkboard-marathahalli"
    assert route.direction == "northbound"
    assert len(route.points) == 3
    assert route.points[0] == (12.9177, 77.6238)


def test_rejects_duplicate_id(tmp_path):
    body = VALID + VALID.split("routes:\n")[1]
    with pytest.raises(ValueError):
        load_routes(write(tmp_path, body))


def test_rejects_fewer_than_two_points(tmp_path):
    text = VALID.replace(
        "[[12.9177, 77.6238], [12.9255, 77.6760], [12.9569, 77.7011]]",
        "[[12.9177, 77.6238]]",
    )
    with pytest.raises(ValueError):
        load_routes(write(tmp_path, text))


def test_rejects_point_outside_bengaluru(tmp_path):
    text = VALID.replace("[12.9255, 77.6760]", "[13.5000, 77.6760]")
    with pytest.raises(ValueError):
        load_routes(write(tmp_path, text))


def test_project_routes_file():
    routes = load_routes("routes.yaml")
    assert len(routes) == 20
    counts = Counter(r.corridor for r in routes)
    assert len(counts) == 10
    assert set(counts.values()) == {2}
