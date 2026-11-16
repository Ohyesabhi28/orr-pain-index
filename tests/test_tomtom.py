import json
import logging
from pathlib import Path

import pytest
import requests

from collector.routes import Route
from collector.tomtom import Observation, fetch_route

KEY = "SECRETKEY123"
FIXTURES = Path(__file__).parent / "fixtures" / "tomtom"
ROUTE = Route("r1", "Test", "ORR", "AtoB", ((12.95, 77.65), (12.97, 77.70)))
MISSING = Observation("r1", None, None, None, "missing")


class FakeResponse:
    def __init__(self, status_code=200, body=None, text=None):
        self.status_code = status_code
        self._body = body
        self.text = text

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeSession:
    def __init__(self, *items):
        self.items = list(items)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params, timeout))
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def fixture():
    return json.loads((FIXTURES / "ok.json").read_text())


def ok_resp(live=1642, free=1111, dist=11873):
    body = {"routes": [{"summary": {"travelTimeInSeconds": live,
                                    "noTrafficTravelTimeInSeconds": free,
                                    "lengthInMeters": dist}}]}
    return FakeResponse(200, body)


def run(session):
    sleeps = []
    obs = fetch_route(ROUTE, KEY, session, sleep=sleeps.append)
    return obs, sleeps


def test_ok():
    s = FakeSession(FakeResponse(200, fixture()))
    obs, sleeps = run(s)
    summary = fixture()["routes"][0]["summary"]
    assert obs == Observation("r1", summary["travelTimeInSeconds"],
                              summary["noTrafficTravelTimeInSeconds"],
                              summary["lengthInMeters"], "ok")
    assert sleeps == []
    url, params, timeout = s.calls[0]
    assert url.endswith("/12.95,77.65:12.97,77.7/json")
    assert params == {"key": KEY, "traffic": "true", "computeTravelTimeFor": "all",
                      "routeType": "fastest", "travelMode": "car"}
    assert timeout == 8


def test_http_error_retries_once_then_missing():
    s = FakeSession(FakeResponse(500), FakeResponse(500))
    obs, sleeps = run(s)
    assert obs == MISSING
    assert len(s.calls) == 2
    assert sleeps == [2]


def test_retry_succeeds():
    s = FakeSession(FakeResponse(500), FakeResponse(200, fixture()))
    obs, sleeps = run(s)
    assert obs.status == "ok"
    assert sleeps == [2]


def test_quota_403_is_missing():
    obs, _ = run(FakeSession(FakeResponse(403), FakeResponse(403)))
    assert obs == MISSING


def test_network_exception_is_missing():
    err = requests.ConnectionError("boom")
    obs, _ = run(FakeSession(err, err))
    assert obs == MISSING


def test_malformed_body_is_missing():
    body = json.loads((FIXTURES / "malformed.json").read_text())
    s = FakeSession(FakeResponse(200, body), FakeResponse(200, body))
    obs, sleeps = run(s)
    assert obs == MISSING
    assert len(s.calls) == 2


def test_non_json_body_is_missing():
    obs, _ = run(FakeSession(FakeResponse(200, None), FakeResponse(200, None)))
    assert obs == MISSING


def test_non_positive_duration_is_missing():
    s = FakeSession(ok_resp(live=0))
    obs, sleeps = run(s)
    assert obs == MISSING
    assert len(s.calls) == 1  # bounds failures are not retried
    assert sleeps == []


def test_live_under_half_free_flow_is_missing():
    obs, _ = run(FakeSession(ok_resp(live=299, free=600)))
    assert obs == MISSING
    obs, _ = run(FakeSession(ok_resp(live=300, free=600)))
    assert obs == Observation("r1", 300, 600, 11873, "ok")


def test_key_not_in_exception_or_repr(caplog):
    err = requests.ConnectionError(f"https://api.tomtom.com/x?key={KEY}&traffic=true")
    caplog.set_level(logging.DEBUG)
    obs, _ = run(FakeSession(err, err))
    assert KEY not in repr(obs)
    assert KEY not in caplog.text
    for rec in caplog.records:
        assert KEY not in rec.getMessage()
        assert rec.exc_info is None
