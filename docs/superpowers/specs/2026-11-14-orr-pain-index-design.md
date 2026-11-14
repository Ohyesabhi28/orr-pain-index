# ORR Pain Index — Design

Date: 2026-11-14
Status: awaiting review

## Purpose

A portfolio project that showcases data analysis. It tracks travel times on
Bengaluru's Outer Ring Road tech corridors, turns them into a defined "Pain
Index", and publishes rankings, trends and best departure times on a public
dashboard.

Success means:

- a public link a recruiter can open and understand in under a minute;
- a metric with a written, defensible methodology;
- insights backed by real data collected by this project.

Constraints: free tiers only, no deadline, one developer.

Out of scope: user accounts, personal route input, alerts or notifications,
mobile apps, traffic prediction, anything outside the fixed corridor list.

## The metric

For each route at each observation, the API returns the live travel time and
the free-flow (no traffic) travel time.

- **Congestion ratio** = live seconds / free-flow seconds.
- **Pain Index** = `clamp((ratio - 1) / 2, 0, 1) * 100`, rounded to an integer.
  It is 0 at free flow and 100 at 3x free-flow or worse.
- **Minutes lost** = (live seconds - free-flow seconds) / 60.

The 3x ceiling is a starting value. It is a single named constant, and it is
revisited once four weeks of data show the real distribution. Any change is
recorded in the methodology page, and the index is recomputed from raw data,
which is why raw seconds are stored and the index is not.

## Data source

TomTom Routing API (Calculate Route), requested with travel times for all
traffic modes so one call returns both live and no-traffic durations.

- Free allowance: 2,500 non-tile requests per day, no card required; requests
  over the cap are blocked, not billed.
- Planned usage: 20 directional routes x 72 runs per day = 1,440 requests.
- Google Routes API was rejected: its India free cap for traffic-aware
  requests (35,000 per month) is below the roughly 43,000 per month needed.

## Routes

`routes.yaml` holds about 10 corridors, each in both directions (20 routes).
Each entry has an id, a display name, start and end coordinates, and
waypoints that pin the path to the intended road so the API cannot reroute
around congestion.

Starting list, to be finalised with exact coordinates during the build:

1. Silk Board – Marathahalli
2. Marathahalli – KR Puram
3. KR Puram – Hebbal
4. Silk Board – Electronic City
5. Marathahalli – Whitefield (ITPL)
6. Bellandur – Sarjapur Road junction
7. Hebbal – Manyata Tech Park
8. Silk Board – Bellandur (Ecospace)
9. KR Puram – Whitefield
10. Hebbal – Kempegowda Airport trumpet

## Architecture

Four units, each with one job, connected only by files.

```
routes.yaml -> collector -> raw CSV (data branch) -> analysis build -> JSON (data branch) -> dashboard
```

### 1. Collector (`collector/`, Python)

- Input: `routes.yaml`, the API key from the environment.
- Output: rows appended to `raw/YYYY-MM.csv`.
- Row: `observed_at_utc, route_id, live_s, free_flow_s, distance_m, status`.
- `status` is `ok` or `missing`. A failed call is retried once after a short
  wait; if it fails again a `missing` row is written with empty durations.
  A missing value is never written as zero.
- Sanity bounds: a response with a non-positive duration, or live time under
  half of free-flow, is recorded as `missing`.

### 2. Analysis build (`analysis/`, Python + DuckDB SQL)

- Input: all raw CSVs.
- Output: JSON files in `public/`:
  - `latest.json` — most recent observation per route, with index and
    minutes lost, and the collection timestamp;
  - `rankings.json` — routes ranked by average index over the last 7 and 28
    days;
  - `heatmap/<route_id>.json` — median index per weekday and 30-minute slot;
  - `departures/<route_id>.json` — the best and worst departure windows per
    weekday, for morning and evening peaks;
  - `trends.json` — weekly average index per route, and the worst days.
- All time bucketing is in IST. Raw timestamps stay in UTC.
- Minimum sample rule: a weekday/slot cell is published only with at least
  3 observations from 3 different weeks. Below that the cell is marked
  `insufficient` and the dashboard shows "still collecting".
- Medians are used instead of means so one accident does not define a slot.

### 3. Scheduler (GitHub Actions)

- One workflow runs the collector, then the analysis build, then commits the
  raw CSV and the JSON to the `data` branch in a single commit.
- Schedule: minutes 7, 22, 37 and 52 of UTC hours 0–17, which is about
  05:37 to 23:22 IST. Minutes are offset from the top of the hour because
  GitHub delays scheduled runs under load, most often on the hour.
- Late runs are acceptable because each row records its real timestamp.
- The workflow uses a concurrency group so two runs never commit at once.
- The API key is a repository secret.
- The repository is public, which gives free Actions minutes and Pages.

### 4. Dashboard (`site/`, static HTML, CSS and JavaScript)

- Hosted on GitHub Pages from `main`. It fetches JSON from the `data` branch
  at runtime, so new data does not require a redeploy.
- Pages:
  - **Live now** — corridors ranked by current Pain Index, with minutes lost
    and "last updated";
  - **Corridor detail** — weekday-by-time heatmap and best departure windows;
  - **Trends** — week-over-week change and the worst days;
  - **Methodology** — the formula, the data source, the sample rule and the
    limitations.
- If `latest.json` is older than 45 minutes during collection hours, the
  page shows a "data is stale" notice with the last update time. Outside
  collection hours it shows "collection resumes at 5:30am".

### Methodology notebook (`notebooks/`)

A Jupyter notebook that explains the metric, validates it against the data
(distribution of ratios, choice of ceiling) and presents the main findings.
It reads the same raw CSVs.

## Build order

1. Routes file and collector, then the scheduled workflow. This goes live
   first so history accumulates during the rest of the build.
2. Analysis build with tests.
3. Dashboard: Live now, then Corridor detail, Trends, Methodology.
4. Notebook, once four weeks of data exist; tune the index ceiling then.

## Testing

- Index calculation: unit tests for free flow, the ceiling, values past the
  ceiling, and missing input.
- Analysis build: run against a small fixture CSV with known answers,
  including the minimum sample rule and IST bucketing across midnight UTC.
- Collector: run against recorded API responses for success, an HTTP error,
  a malformed body and an out-of-bounds duration; no live calls in tests.
- Dashboard: load each page against fixture JSON, including the stale and
  insufficient-data states.

## Risks and open items

1. **TomTom terms on storing and publishing data.** The plan commits raw
   travel times to a public repository. TomTom's terms must be read before
   the repository is made public. Fallback: keep raw data in a private
   repository and publish only the derived index values.
2. **Scheduled workflows are disabled after 60 days without repository
   activity.** It is not confirmed that bot commits to a non-default branch
   count as activity. Check after launch; if they do not, add a monthly
   keep-alive commit to `main`.
3. **Skipped scheduled runs.** If gaps exceed about 10% of expected runs in
   a week, trigger the same workflow from an external free scheduler through
   the GitHub API. Nothing else changes.
4. **Quota headroom.** 1,440 of 2,500 daily requests are planned. Retries
   and manual runs share the same allowance.
5. **Route drift.** Waypoints must be checked on a map for every route
   before collection starts, since a wrong path silently corrupts history.
