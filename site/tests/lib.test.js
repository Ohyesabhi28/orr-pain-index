import test from "node:test";
import assert from "node:assert/strict";
import { freshness, band, istClock } from "../lib.js";

test("fresh within 45 minutes", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:44:00Z")), "fresh"));
test("exactly 45 minutes is still fresh", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:45:00Z")), "fresh"));
test("stale after 45 minutes in collection hours", () =>
  assert.equal(freshness("2026-11-16T04:00:00Z", Date.parse("2026-11-16T04:46:00Z")), "stale"));
test("overnight at 1am IST", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-15T19:30:00Z")), "overnight"));
test("last night's data at 5:40am IST is not stale", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-16T00:10:00Z")), "overnight"));
test("last night's data at 6:20am IST is stale", () =>
  assert.equal(freshness("2026-11-15T17:52:00Z", Date.parse("2026-11-16T00:50:00Z")), "stale"));
test("fresh data at 5:40am IST is fresh", () =>
  assert.equal(freshness("2026-11-16T00:05:00Z", Date.parse("2026-11-16T00:10:00Z")), "fresh"));
test("after 23:30 IST is overnight even with recent data", () =>
  assert.equal(freshness("2026-11-16T17:55:00Z", Date.parse("2026-11-16T18:05:00Z")), "overnight"));
test("no observation yet", () => assert.equal(freshness(null, Date.now()), "empty"));
test("bands", () => assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 100].map(band),
  ["low", "low", "moderate", "moderate", "high", "high", "severe", "severe"]));
test("istClock formats morning, afternoon, midnight and noon", () => {
  assert.equal(istClock("2026-11-16T03:07:00Z"), "8:37 am");
  assert.equal(istClock("2026-11-16T09:30:00Z"), "3:00 pm");
  assert.equal(istClock("2026-11-15T18:30:00Z"), "12:00 am");
  assert.equal(istClock("2026-11-16T06:35:00Z"), "12:05 pm");
});

import { heatmapGrid, slotRange, slotLabel } from "../lib.js";

function allCells() {
  const cells = [];
  for (let wd = 0; wd < 7; wd++) {
    for (let i = 0; i < 36; i++) {
      const m = 330 + i * 30;
      const slot = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      cells.push({ weekday: wd, slot, median_index: i, status: "ok" });
    }
  }
  return cells;
}
test("unparseable timestamp is stale, not fresh", () =>
  assert.equal(freshness("not-a-date", Date.parse("2026-11-16T04:00:00Z")), "stale"));
test("heatmapGrid orders 252 shuffled cells into 7 rows of 36", () => {
  const cells = allCells();
  let seed = 7;
  cells.sort(() => ((seed = (seed * 16807) % 2147483647) % 3) - 1);
  const { slots, rows } = heatmapGrid(cells);
  assert.equal(slots.length, 36);
  assert.equal(slots[0], "05:30");
  assert.equal(slots[35], "23:00");
  assert.equal(rows.length, 7);
  rows.forEach((row, wd) => {
    assert.equal(row.length, 36);
    row.forEach((c, i) => {
      assert.equal(c.weekday, wd);
      assert.equal(c.slot, slots[i]);
    });
  });
});
test("heatmapGrid of no cells is empty rows", () => {
  const { slots, rows } = heatmapGrid([]);
  assert.deepEqual(slots, []);
  assert.equal(rows.length, 7);
});
test("slotRange", () => {
  assert.equal(slotRange("08:30"), "8:30–9:00 am");
  assert.equal(slotRange("11:30"), "11:30 am–12:00 pm");
  assert.equal(slotRange("12:00"), "12:00–12:30 pm");
  assert.equal(slotRange("16:30"), "4:30–5:00 pm");
  assert.equal(slotRange("23:00"), "11:00–11:30 pm");
  assert.equal(slotRange("23:30"), "11:30 pm–12:00 am");
});
test("slotLabel", () => {
  assert.equal(slotLabel("08:30"), "8:30 am");
  assert.equal(slotLabel("12:00"), "12:00 pm");
  assert.equal(slotLabel("23:00"), "11:00 pm");
});

import { istDateLabel, isIstToday } from "../lib.js";

test("dead collector: 7h59m overnight is still overnight, 8h01m is stale", () => {
  const obs = "2026-11-15T15:55:00Z"; // 21:25 IST
  assert.equal(freshness(obs, Date.parse(obs) + (7 * 60 + 59) * 60000), "overnight"); // 05:24 IST
  assert.equal(freshness(obs, Date.parse(obs) + (8 * 60 + 1) * 60000), "stale"); // 05:26 IST
});
test("week-old observation at 2am IST is stale", () =>
  assert.equal(freshness("2026-11-09T17:52:00Z", Date.parse("2026-11-15T20:30:00Z")), "stale"));
test("istDateLabel is the IST calendar date", () => {
  assert.equal(istDateLabel("2026-11-11T17:52:00Z"), "11 Nov"); // 23:22 IST
  assert.equal(istDateLabel("2026-11-11T18:40:00Z"), "12 Nov"); // 00:10 IST next day
});
test("isIstToday compares IST days", () => {
  assert.equal(isIstToday("2026-11-11T17:52:00Z", Date.parse("2026-11-11T18:40:00Z")), false); // 12 Nov 00:10 IST
  assert.equal(isIstToday("2026-11-11T03:00:00Z", Date.parse("2026-11-11T10:00:00Z")), true);
});

import { ageLabel, istDateLong, istWeekday, routeLabel, slotRange24, tripMinutes, BAND_LABEL, BAND_RANGE, readingOf } from "../lib.js";

test("band words follow the design", () => {
  assert.deepEqual(Object.values(BAND_LABEL), ["Smooth", "Slow", "Heavy", "Gridlock"]);
  assert.deepEqual(Object.values(BAND_RANGE), ["0–24", "25–49", "50–74", "75–100"]);
});
test("ageLabel", () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  assert.equal(ageLabel("2026-11-16T10:00:00Z", now), "just now");
  assert.equal(ageLabel("2026-11-16T09:54:00Z", now), "6 min ago");
  assert.equal(ageLabel("2026-11-16T01:00:00Z", now), "9 h ago");
  assert.equal(ageLabel("2026-11-13T10:00:00Z", now), "3 d ago");
  assert.equal(ageLabel("2026-11-16T10:05:00Z", now), "just now", "a clock skewed into the future is not negative");
  assert.equal(ageLabel("nope", now), "");
});
test("istDateLong uses the IST calendar date", () => {
  assert.equal(istDateLong("2026-11-16T10:28:27Z"), "MON, 16 NOV 2026");
  assert.equal(istDateLong("2026-11-16T20:00:00Z"), "TUE, 17 NOV 2026", "01:30 IST is already tomorrow");
  assert.equal(istDateLong("nope"), "");
});
test("istWeekday is Monday = 0 in IST", () => {
  assert.equal(istWeekday(Date.parse("2026-11-16T10:00:00Z")), 0);
  assert.equal(istWeekday(Date.parse("2026-11-16T20:00:00Z")), 1);
  assert.equal(istWeekday(Date.parse("2026-11-22T10:00:00Z")), 6);
});
test("routeLabel turns the first ' to ' into an arrow", () => {
  assert.equal(routeLabel("Silk Board to Marathahalli"), "Silk Board → Marathahalli");
  assert.equal(routeLabel("Whitefield (ITPL) to Marathahalli"), "Whitefield (ITPL) → Marathahalli");
  assert.equal(routeLabel("Hosur Road"), "Hosur Road");
  assert.equal(routeLabel(null), "");
});
test("slotRange24", () => {
  assert.equal(slotRange24("18:00"), "18:00–18:30");
  assert.equal(slotRange24("20:30"), "20:30–21:00");
  assert.equal(slotRange24("23:30"), "23:30–00:00");
});
test("tripMinutes inverts the index formula", () => {
  assert.equal(tripMinutes(0, 1200), 20);
  assert.equal(tripMinutes(88, 1200), 55);
  assert.equal(tripMinutes(100, 1200), 60, "the ceiling is 3x free flow");
  assert.equal(tripMinutes(null, 1200), null);
  assert.equal(tripMinutes(50, null), null);
  assert.equal(tripMinutes(50, 0), null);
});
test("readingOf needs status ok and four finite numbers", () => {
  const r = { status: "ok", pain_index: 50, minutes_lost: 5, live_s: 600, free_flow_s: 300 };
  assert.deepEqual(readingOf(r), { pain: 50, lost: 5, live: 600, free: 300 });
  assert.equal(readingOf({ ...r, status: "missing" }), null);
  assert.equal(readingOf({ ...r, live_s: null }), null);
});
