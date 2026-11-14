# ORR Pain Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect ORR travel times every 15 minutes, turn them into a Pain Index, and publish rankings, heatmaps, best departure times and trends on a static dashboard.

**Architecture:** A Python collector appends raw observations to monthly CSVs. A Python + DuckDB build turns the CSVs into JSON. A GitHub Actions workflow runs both on a schedule and commits the results to a `data` branch. A static site on GitHub Pages fetches that JSON at runtime.

**Tech Stack:** Python 3.12, requests, PyYAML, DuckDB, pytest; vanilla HTML/CSS/JS (ES modules), Chart.js 4.4.1 from cdnjs, Node built-in test runner; GitHub Actions and Pages.

**Spec:** `docs/superpowers/specs/2026-11-14-orr-pain-index-design.md`

## Global Constraints

- Free tiers only. TomTom free allowance is 2,500 non-tile requests per day; planned usage is 20 routes x 72 runs = 1,440.
- Pain Index = `clamp((ratio - 1) / 2, 0, 1) * 100`, integer, half rounds up. The ceiling ratio 3.0 is one named constant, `CEILING_RATIO`.
- Raw data stores seconds, never the index. A missing value is never written as zero.
- Raw timestamps are UTC (`YYYY-MM-DDTHH:MM:SSZ`). All bucketing is in IST (`Asia/Kolkata`).
- Slot statistics use medians. A weekday/slot cell is published only with at least 3 `ok` observations from 3 different ISO weeks; otherwise its status is `insufficient`.
- Tests make no live API calls.
- The API key is read from the `TOMTOM_API_KEY` environment variable and is never written to a file or log.
- Out of scope: accounts, user-entered routes, alerts, prediction.

## Decisions this plan adds to the spec

- One `observed_at_utc` per collector run (the run start), shared by all routes in that run.
- Slots are 30 minutes, labelled by IST start time, from `05:30` to `23:00` (36 slots). Weekday is 0 = Monday.
- Peak windows: morning `07:00`–`11:00`, evening `16:30`–`21:00` (slot start times, end exclusive).
- Minutes lost is clamped at 0.
- Index bands for colour: 0–24 low, 25–49 moderate, 50–74 high, 75–100 severe.
- Pages is deployed by a workflow that uploads `site/`, because branch-based Pages can only serve `/` or `/docs`.

## Review Focus

1. **Month and day rollover.** A run at 18:35 UTC on the last day of a month is the next day, and next month, in IST. Raw files are named by UTC month; the build must bucket by IST across files. (Tests in Tasks 4 and 6.)
2. **No data yet.** A build with no raw files, or only `missing` rows, must write valid JSON with empty or `insufficient` content, and the site must say "still collecting". (Tests in Tasks 5, 6, 8.)
3. **Quota exhausted or API down.** Every call fails: the run writes 20 `missing` rows, retries each call once only, and exits 0 so the commit still happens. (Test in Task 4.)
4. **Route list changes.** Raw rows for a route no longer in `routes.yaml` are ignored; a new route with no rows appears in `latest.json` as `missing`. (Test in Task 5.)
5. **Site edge states.** Last night's data must not show as stale at 5:40am, and a failed JSON fetch must show an error message, not a blank page. (Tests in Task 8.)

## You do (not automatable)

- Create a TomTom developer account and API key.
- Read TomTom's terms on storing and publishing API results before the repository goes public (spec risk 1). If they forbid it, stop and tell the implementer: the fallback is a private data repository.
- Create an empty public GitHub repository and add the secret `TOMTOM_API_KEY`.

## File Structure

```
routes.yaml                    corridor definitions
requirements.txt               requests, PyYAML, duckdb, pytest
collector/routes.py            load and validate routes.yaml
collector/tomtom.py            one API call -> Observation
collector/run.py               run all routes, append CSV, CLI
analysis/index.py              Pain Index in Python and as SQL
analysis/load.py               raw CSVs -> DuckDB relation with IST fields
analysis/build.py              write all JSON files, CLI
tests/                         pytest, with tests/fixtures/tomtom/*.json
site/index.html                Live now
site/corridor.html             Corridor detail (?route=<id>)
site/trends.html               Trends
site/methodology.html          Methodology
site/lib.js                    pure logic (freshness, bands)
site/data.js                   JSON loading and error display
site/config.js                 DATA_BASE url
site/style.css
site/fixtures/                 sample JSON for local viewing
site/tests/lib.test.js         node --test
.github/workflows/collect.yml  scheduled collect + build + commit
.github/workflows/ci.yml       tests on push
.github/workflows/pages.yml    deploy site/
notebooks/methodology.ipynb
```

---

### Task 1: Project setup and the Pain Index

**Files:**
- Create: `requirements.txt`, `.gitignore`, `analysis/__init__.py`, `analysis/index.py`
- Test: `tests/test_index.py`

**Interfaces:**
- Produces: `CEILING_RATIO: float = 3.0`; `pain_index(live_s: float, free_flow_s: float) -> int`; `minutes_lost(live_s: float, free_flow_s: float) -> float`; `INDEX_SQL: str` and `MINUTES_LOST_SQL: str`, SQL expressions over columns `live_s` and `free_flow_s` that give the same results.

- [ ] **Step 1: Set up.** Run `git init`, create a Python 3.12 virtual environment, write `requirements.txt` (`requests`, `PyYAML`, `duckdb`, `pytest`) and install it. `.gitignore` covers `.venv/`, `__pycache__/`, `data/`.

- [ ] **Step 2: Write the failing tests**

```python
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
            f"FROM (SELECT {live} AS live_s, {free} AS free_flow_s)").fetchone()
        assert idx == pain_index(live, free)
        assert lost == minutes_lost(live, free)
```

- [ ] **Step 3: Run** `pytest tests/test_index.py -v`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement `analysis/index.py`.** Build both SQL strings from `CEILING_RATIO` so there is one source for the constant. Use `floor(x + 0.5)` in both, not `round`.
- [ ] **Step 5: Run** `pytest tests/test_index.py -v`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: pain index calculation`.

---

### Task 2: Routes file and loader

**Files:**
- Create: `routes.yaml`, `collector/__init__.py`, `collector/routes.py`
- Test: `tests/test_routes.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) Route(id: str, name: str, corridor: str, direction: str, points: tuple[tuple[float, float], ...])` where points are `(lat, lon)` in travel order; `load_routes(path: str | Path) -> list[Route]`, raising `ValueError` on invalid input.

`routes.yaml` shape:

```yaml
routes:
  - id: silkboard-marathahalli
    name: Silk Board to Marathahalli
    corridor: Silk Board – Marathahalli
    direction: northbound
    points: [[12.9177, 77.6238], [12.9255, 77.6760], [12.9569, 77.7011]]
```

- [ ] **Step 1: Write the failing tests** in `tests/test_routes.py`, each writing YAML to `tmp_path`:
  - `test_loads_valid_route`: the example above gives one `Route` with 3 points.
  - `test_rejects_duplicate_id`, `test_rejects_fewer_than_two_points`: `pytest.raises(ValueError)`.
  - `test_rejects_point_outside_bengaluru`: a point outside lat 12.7–13.3, lon 77.3–77.9 raises `ValueError`.
  - `test_project_routes_file`: `load_routes("routes.yaml")` returns exactly 20 routes, and every corridor appears exactly twice.
- [ ] **Step 2: Run** `pytest tests/test_routes.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement `load_routes`.**
- [ ] **Step 4: Write `routes.yaml`** with the spec's 10 corridors in both directions. Put a mid-route waypoint on the ORR carriageway for every route. The reverse direction needs its own waypoints on the opposite carriageway.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Verify paths by eye (spec risk 5).** For each route, open the points in a map and confirm the path follows the intended road. Record "verified" with the date as a comment on each route.
- [ ] **Step 7: Commit** `feat: route definitions and loader`.

---

### Task 3: TomTom client

**Files:**
- Create: `collector/tomtom.py`, `tests/fixtures/tomtom/ok.json`, `tests/fixtures/tomtom/malformed.json`
- Test: `tests/test_tomtom.py`

**Interfaces:**
- Consumes: `Route` from Task 2.
- Produces: `@dataclass(frozen=True) Observation(route_id: str, live_s: int | None, free_flow_s: int | None, distance_m: int | None, status: str)` with status `"ok"` or `"missing"`; `fetch_route(route: Route, api_key: str, session: requests.Session, sleep=time.sleep) -> Observation`. It never raises for API or network failures.

Request: `GET https://api.tomtom.com/routing/1/calculateRoute/{lat,lon:lat,lon:...}/json` with params `key`, `traffic=true`, `computeTravelTimeFor=all`, `routeType=fastest`, `travelMode=car`, timeout 20 seconds. Read `routes[0].summary`: `travelTimeInSeconds` is live, `noTrafficTravelTimeInSeconds` is free flow, `lengthInMeters` is distance.

- [ ] **Step 1: Confirm the response shape.** Make one real call for one route with your key, check the three field names above against the response, and save it (key removed) as `tests/fixtures/tomtom/ok.json`. If the field names differ, update this task before continuing.
- [ ] **Step 2: Write the failing tests** using a fake session whose `get` returns queued responses or raises:
  - `test_ok`: the fixture gives `status == "ok"` with the three integers from the fixture.
  - `test_http_error_retries_once_then_missing`: two 500 responses give `Observation(route.id, None, None, None, "missing")`; `get` was called exactly 2 times; `sleep` was called once with `2`.
  - `test_retry_succeeds`: a 500 then the fixture gives `ok`.
  - `test_quota_403_is_missing`, `test_network_exception_is_missing`, `test_malformed_body_is_missing`.
  - `test_non_positive_duration_is_missing`: live 0 gives `missing`.
  - `test_live_under_half_free_flow_is_missing`: live 299, free flow 600 gives `missing`; live 300 gives `ok`.
  - `test_key_not_in_exception_or_repr`: no log record or returned value contains the key.
- [ ] **Step 3: Run** `pytest tests/test_tomtom.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement `fetch_route`.** Retry covers HTTP errors, exceptions and malformed bodies; bounds failures are not retried.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat: TomTom routing client`.

---

### Task 4: Collector run and raw CSV

**Files:**
- Create: `collector/run.py`
- Test: `tests/test_run.py`

**Interfaces:**
- Consumes: `load_routes`, `fetch_route`, `Observation`.
- Produces: `collect(routes, fetch: Callable[[Route], Observation]) -> list[Observation]`; `append_rows(observations: list[Observation], observed_at: datetime, raw_dir: Path) -> Path`; CLI `python -m collector.run --routes routes.yaml --raw-dir data/raw`.
- Raw file: `raw/YYYY-MM.csv` by UTC month, header `observed_at_utc,route_id,live_s,free_flow_s,distance_m,status`, empty fields for missing durations.

- [ ] **Step 1: Write the failing tests**
  - `test_creates_file_with_header`: first append to an empty dir creates `2026-11.csv` with the header and one row per observation.
  - `test_appends_without_second_header`.
  - `test_missing_row_has_empty_fields`: the line is `2026-11-14T03:07:00Z,r1,,,,missing`.
  - `test_file_named_by_utc_month`: `observed_at` of `2026-11-30T18:37:00Z` writes to `2026-11.csv`, not `2026-12.csv`.
  - `test_all_calls_fail_still_writes_and_exits_zero`: with a fetch that always returns `missing` for 20 routes, `main()` returns 0 and the file has 20 `missing` rows.
  - `test_same_run_timestamp_for_all_rows`.
  - `test_main_without_key_exits_nonzero_and_writes_nothing`.
- [ ] **Step 2: Run** `pytest tests/test_run.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** `main` takes the run timestamp once, truncated to seconds, before any call.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Run it for real** with your key into a scratch directory and check 20 rows with plausible values.
- [ ] **Step 6: Commit** `feat: collector run and raw CSV output`.

---

### Task 5: Build — loading, latest and rankings

**Files:**
- Create: `analysis/load.py`, `analysis/build.py`, `tests/helpers.py`
- Test: `tests/test_build_latest.py`

**Interfaces:**
- Consumes: `INDEX_SQL`, `MINUTES_LOST_SQL`, `load_routes`.
- Produces:
  - `load_raw(raw_dir: Path, route_ids: list[str], con: duckdb.DuckDBPyConnection) -> None`, creating table `obs` with the raw columns plus `pain_index`, `minutes_lost`, `ist_ts`, `ist_date`, `weekday` (0 = Monday), `slot` (`"HH:MM"`), `iso_week` (`"YYYY-Www"`), restricted to the given route ids. An empty or absent `raw_dir` gives an empty table.
  - `build(routes: list[Route], raw_dir: Path, out_dir: Path, now_utc: datetime) -> None`; CLI `python -m analysis.build --routes routes.yaml --raw-dir data/raw --out-dir data/public`.
  - Test helper `write_raw(raw_dir: Path, rows: list[tuple]) -> None`.

`latest.json`:
```json
{"generated_at_utc": "…Z", "observed_at_utc": "…Z or null",
 "routes": [{"route_id": "", "name": "", "corridor": "", "direction": "",
             "status": "ok", "live_s": 0, "free_flow_s": 0, "distance_m": 0,
             "pain_index": 0, "minutes_lost": 0.0}]}
```
`observed_at_utc` is the latest run timestamp in the data. Every route in `routes.yaml` appears, in descending `pain_index` with `missing` routes last; a route with no row in that run has status `missing` and null values.

`rankings.json`:
```json
{"generated_at_utc": "…Z",
 "windows": {"7d": [{"route_id": "", "name": "", "avg_index": 0.0,
                     "avg_minutes_lost": 0.0, "n": 0}], "28d": []}}
```
Mean over `ok` rows in the window ending at `now_utc`, one decimal, descending by `avg_index`. Routes with `n == 0` are omitted.

- [ ] **Step 1: Write the failing tests**
  - `test_latest_uses_most_recent_run`: two runs; values come from the later one; a route at live 1200 / free 600 has `pain_index == 50`, `minutes_lost == 10.0`.
  - `test_latest_sorted_with_missing_last`.
  - `test_unknown_route_in_raw_is_ignored` and `test_new_route_without_rows_is_missing`.
  - `test_no_raw_data`: with an empty dir, `latest.json` has `observed_at_utc: null` and every route `missing`; `rankings.json` has two empty lists; nothing raises.
  - `test_rankings_window`: a row 8 days before `now_utc` counts in `28d` but not `7d`.
  - `test_missing_rows_excluded_from_averages`.
  - `test_reads_across_month_files`.
- [ ] **Step 2: Run** `pytest tests/test_build_latest.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read CSVs with all columns typed explicitly so empty fields become NULL. Write each JSON file to a temp name and rename, so a failed build never leaves a half-written file.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: build latest and rankings JSON`.

---

### Task 6: Build — heatmap, departures and trends

**Files:**
- Modify: `analysis/build.py`
- Test: `tests/test_build_patterns.py`

**Interfaces:**
- Consumes: table `obs` from Task 5.
- Produces three more outputs from `build`:

`heatmap/<route_id>.json` — always 7 x 36 = 252 cells:
```json
{"route_id": "", "name": "", "slot_minutes": 30,
 "cells": [{"weekday": 0, "slot": "05:30", "median_index": 0, "n": 0,
            "weeks": 0, "status": "ok"}]}
```
`median_index` is null when status is `insufficient`.

`departures/<route_id>.json`:
```json
{"route_id": "", "name": "",
 "weekdays": [{"weekday": 0,
   "morning": {"best": {"slot": "07:00", "median_index": 0, "median_minutes_lost": 0.0},
               "worst": {"slot": "", "median_index": 0, "median_minutes_lost": 0.0}},
   "evening": {"best": null, "worst": null}}]}
```
Best is the lowest `median_index` among `ok` cells in the peak window, worst the highest; ties go to the earlier slot; both are null when the window has no `ok` cell.

`trends.json`:
```json
{"generated_at_utc": "…Z",
 "weeks": [{"week_start": "2026-11-09", "partial": false,
            "routes": {"<route_id>": 0.0}}],
 "worst_days": [{"date": "2026-11-12", "avg_index": 0.0, "avg_minutes_lost": 0.0}]}
```
`week_start` is the IST Monday; `partial` is true for the week containing `now_utc`; `worst_days` is the top 10 IST dates by mean index across all routes, counting only dates with at least 40 `ok` rows.

- [ ] **Step 1: Write the failing tests**
  - `test_cell_ok_with_three_weeks`: 3 rows on three consecutive Mondays at 03:07 UTC (08:37 IST) with indexes 20, 50, 80 give weekday 0, slot `08:30`, `median_index == 50`, `n == 3`, `weeks == 3`, status `ok`.
  - `test_three_rows_same_week_is_insufficient`: `median_index` is null.
  - `test_two_weeks_is_insufficient`.
  - `test_ist_bucketing_crosses_utc_midnight`: a row at `2026-11-15T18:37:00Z` (Sunday UTC) has weekday 0 (Monday) and slot `00:00` in `obs`, and appears in no heatmap cell because that slot is outside the 36 published ones; a row at `2026-11-16T00:07:00Z` lands on weekday 0, slot `05:30`.
  - `test_heatmap_always_252_cells`, including for a route with no data.
  - `test_departures_best_and_worst`, `test_departures_tie_goes_to_earlier_slot`, `test_departures_null_without_ok_cells`.
  - `test_trends_week_start_is_ist_monday` and `test_current_week_is_partial`.
  - `test_worst_days_requires_40_rows`.
  - `test_month_rollover`: rows at `2026-11-30T18:37:00Z` in `2026-11.csv` have `ist_date == 2026-12-01`.
- [ ] **Step 2: Run** `pytest tests/test_build_patterns.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Generate the full weekday x slot grid and left-join the aggregates onto it, so empty cells exist.
- [ ] **Step 4: Run** the whole suite: `pytest -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: build heatmap, departures and trends JSON`.

---

### Task 7: Scheduled workflow and CI

**Files:**
- Create: `.github/workflows/collect.yml`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: both CLIs.
- Produces: a `data` branch containing `raw/YYYY-MM.csv` and `public/**.json`, updated every run.

- [ ] **Step 1: Write `ci.yml`**: on push and pull request to `main`, Python 3.12, install requirements, `pytest`, then `node --test site/tests/` (the Node step is added in Task 8).
- [ ] **Step 2: Write `collect.yml`:**
  - triggers: `schedule: cron "7,22,37,52 0-17 * * *"` and `workflow_dispatch`;
  - `concurrency: {group: collect, cancel-in-progress: false}`; `permissions: contents: write`;
  - check out `main` at the root and the `data` branch into `data/`;
  - run the collector with `TOMTOM_API_KEY` from secrets, then the build;
  - in `data/`: commit `raw` and `public` as `github-actions[bot]` with message `data: <observed_at_utc>`, and push; skip the commit when nothing changed;
  - if the build fails after a successful collect, still commit `raw/` and fail the job.
- [ ] **Step 3: Create the `data` branch once**: an orphan branch holding only a short `README.md`, pushed to the remote.
- [ ] **Step 4: Push `main`, run the workflow manually** from the Actions tab. Expected: a new commit on `data` with `raw/2026-11.csv` (20 rows) and `public/latest.json`.
- [ ] **Step 5: Check the schedule** after one hour. Expected: about 4 more commits on `data`. Note the delay between schedule and `observed_at_utc`.
- [ ] **Step 6: Commit** `ci: scheduled collection and tests`.
- [ ] **Step 7: One week later**, count runs against the expected 504. If more than 10% are missing, open a follow-up for an external trigger (spec risk 3). At 45 days, check whether the workflow shows an inactivity warning (spec risk 2).

---

### Task 8: Dashboard shell and Live now

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/config.js`, `site/lib.js`, `site/data.js`, `site/live.js`, `site/fixtures/latest.json`, `site/fixtures/latest-empty.json`, `.github/workflows/pages.yml`
- Test: `site/tests/lib.test.js`

**Interfaces:**
- Consumes: `latest.json` from Task 5.
- Produces (`site/lib.js`): `freshness(observedAtIso: string | null, nowMs: number) -> "fresh" | "stale" | "overnight" | "empty"`; `band(index: number) -> "low" | "moderate" | "high" | "severe"`; `istClock(iso: string) -> string` like `"8:37 am"`.
- Produces (`site/data.js`): `loadJson(path: string) -> Promise<object>`, rejecting with an `Error` whose message names the file; `showError(message: string) -> void`, which renders a visible banner.
- `site/config.js` exports `DATA_BASE` (`https://raw.githubusercontent.com/<owner>/<repo>/data/public/`). The query string `?data=fixtures` switches it to `./fixtures/`.

`freshness` rules, in IST: `null` gives `empty`. Outside 05:30–23:30 gives `overnight`. Between 05:30 and 06:15, data older than 45 minutes gives `overnight`. Otherwise older than 45 minutes gives `stale`, else `fresh`.

- [ ] **Step 1: Write the failing tests** with `node:test`:

```js
test("fresh within 45 minutes", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:44:00Z")), "fresh"));
test("stale after 45 minutes in collection hours", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:46:00Z")), "stale"));
test("overnight at 1am IST", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-15T19:30:00Z")), "overnight"));
test("last night's data at 5:40am IST is not stale", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-16T00:10:00Z")), "overnight"));
test("last night's data at 6:20am IST is stale", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-16T00:50:00Z")), "stale"));
test("no observation yet", () => assert.equal(freshness(null, Date.now()), "empty"));
test("bands", () => assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 100].map(band),
  ["low", "low", "moderate", "moderate", "high", "high", "severe", "severe"]));
```

- [ ] **Step 2: Run** `node --test site/tests/`. Expected: FAIL.
- [ ] **Step 3: Implement `lib.js` and `data.js`.**
- [ ] **Step 4: Run** `node --test site/tests/`. Expected: PASS. Add the Node step to `ci.yml`.
- [ ] **Step 5: Build `index.html`, `style.css`, `live.js`.** A ranked list of routes: name, direction, Pain Index coloured by band, minutes lost, and live versus free-flow minutes. A header line shows "Updated 8:37 am". Notices: `stale` shows "Data is stale. Last update 8:37 am."; `overnight` shows "Collection resumes at 5:30am."; `empty` shows "Still collecting. First data arrives soon." A `missing` route shows "no reading" in place of numbers. The layout must work at phone width.
- [ ] **Step 6: Check in a browser** by serving `site/` locally: `?data=fixtures` renders the ranked list; pointing at `latest-empty.json` shows the collecting message; a wrong `DATA_BASE` shows the error banner and no blank page.
- [ ] **Step 7: Write `pages.yml`** (on push to `main`, upload `site/` with `actions/upload-pages-artifact`, deploy with `actions/deploy-pages`), set Pages source to GitHub Actions, push, and confirm the live URL shows real data.
- [ ] **Step 8: Commit** `feat: dashboard shell and Live now page`.

---

### Task 9: Corridor detail, Trends and Methodology pages

**Files:**
- Create: `site/corridor.html`, `site/corridor.js`, `site/trends.html`, `site/trends.js`, `site/methodology.html`, fixtures `site/fixtures/heatmap/<id>.json`, `site/fixtures/departures/<id>.json`, `site/fixtures/trends.json`, `site/fixtures/rankings.json`
- Modify: `site/lib.js`, `site/tests/lib.test.js`, `site/index.html` (links to each route's detail page)

**Interfaces:**
- Consumes: the Task 5 and 6 JSON, `loadJson`, `showError`, `band`.
- Produces (`site/lib.js`): `heatmapGrid(cells) -> {slots: string[], rows: Cell[][]}` with 7 rows (Monday first) of 36 cells; `slotRange(slot: string) -> string` like `"8:30–9:00 am"`.

- [ ] **Step 1: Write the failing tests**: `heatmapGrid` on 252 shuffled cells gives 7 rows of 36 in slot order; `slotRange("08:30") == "8:30–9:00 am"`; `slotRange("11:30") == "11:30 am–12:00 pm"`.
- [ ] **Step 2: Run** `node --test site/tests/`. Expected: FAIL. Implement, then PASS.
- [ ] **Step 3: Corridor page.** A weekday x time heatmap as a CSS grid coloured by band; `insufficient` cells are hatched grey with the tooltip "still collecting". Below it, per weekday, the best and worst departure window for each peak, shown with `slotRange`, or "still collecting" when null. An unknown `?route=` shows the error banner.
- [ ] **Step 4: Trends page.** A Chart.js line chart of weekly average index per route, with the partial week drawn dashed; a 7-day versus 28-day ranking table from `rankings.json`; the worst-days list. With no weeks yet it shows "still collecting".
- [ ] **Step 5: Methodology page.** State the formula with the current ceiling, the data source and polling schedule, the median and minimum sample rule, the sanity bounds, and the limitations: fixed routes, 15-minute resolution, modelled free-flow time, gaps from skipped runs.
- [ ] **Step 6: Check each page in a browser** against fixtures, including one route fixture where every cell is `insufficient`, then against live data.
- [ ] **Step 7: Commit** `feat: corridor, trends and methodology pages`.

---

### Task 10: Methodology notebook and ceiling review

Start only when the `data` branch holds at least four weeks of observations.

**Files:**
- Create: `notebooks/methodology.ipynb`
- Modify (only if the ceiling changes): `analysis/index.py`, `tests/test_index.py`, `site/methodology.html`

- [ ] **Step 1: Load the raw CSVs** with `analysis.load.load_raw`, so the notebook and the site share one definition.
- [ ] **Step 2: Data quality section**: runs expected versus received per day, share of `missing` rows per route, distribution of delay between schedule and timestamp.
- [ ] **Step 3: Ceiling review**: the distribution of congestion ratios with the 90th, 95th and 99th percentiles. Keep 3.0 if the 99th percentile is between 2.5 and 3.5; otherwise propose a new value and state why.
- [ ] **Step 4: If the ceiling changes**: change `CEILING_RATIO`, update the expected values in `tests/test_index.py`, run `pytest`, and record the change with its date on the methodology page.
- [ ] **Step 5: Findings**: the worst corridor and direction, the worst weekday and slot, how much leaving 30 minutes earlier or later saves on the three worst routes, and the Monday-to-Friday pattern. Each finding has one chart and one sentence.
- [ ] **Step 6: Link the notebook** from the methodology page and the README, and commit `docs: methodology notebook`.
