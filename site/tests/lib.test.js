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
