import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shortDate, dayDate, chartModel, chartConfig, rankingsHtml, worstDaysHtml, viewModel } from "../trends.js";

const fx = (p) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8"));
const trends = fx("trends.json");
const rankings = fx("rankings.json");

test("date formatting", () => {
  assert.equal(shortDate("2026-10-19"), "19 Oct");
  assert.equal(dayDate("2026-11-05"), "Thu 5 Nov");
  assert.equal(shortDate("garbage"), "garbage");
});
test("chartModel: one series per route, nulls for missing weeks, partial flags", () => {
  const m = chartModel(trends, { "orr-silk-board-hebbal": "Silk Board to Hebbal" });
  assert.equal(m.labels.length, 5);
  assert.deepEqual(m.partial, [false, false, false, false, true]);
  assert.equal(m.series.length, 4);
  assert.equal(m.series[0].label, "Silk Board to Hebbal");
  const hosur = m.series.find((s) => s.id === "hosur-silk-board-electronic-city");
  assert.equal(hosur.data[0], null);
  assert.equal(hosur.label, hosur.id); // falls back to id
  assert.equal(new Set(m.series.map((s) => s.pointStyle)).size, 4); // not colour alone
});
test("chartConfig draws only the partial week dashed", () => {
  const cfg = chartConfig(chartModel(trends), ["#111", "#222"], { text: "#333", grid: "#444" });
  const seg = cfg.data.datasets[0].segment.borderDash;
  assert.equal(seg({ p1DataIndex: 3 }), undefined);
  assert.deepEqual(seg({ p1DataIndex: 4 }), [6, 4]);
  assert.equal(cfg.data.datasets[2].borderColor, "#111"); // colours wrap
});
test("empty trends: no weeks, notices, no series", () => {
  const empty = fx("trends-empty.json");
  assert.equal(chartModel(empty).series.length, 0);
  const vm = viewModel(empty, { windows: { "7d": [], "28d": [] } });
  assert.equal(vm.hasWeeks, false);
  assert.match(vm.chartNotice, /Still collecting/);
  assert.match(vm.worstDaysNotice, /Still collecting/);
  assert.match(vm.rankingsHtml, /Still collecting/);
  assert.equal(vm.worstDaysHtml, "");
});
test("viewModel with data has no notices", () => {
  const vm = viewModel(trends, rankings);
  assert.equal(vm.hasWeeks, true);
  assert.equal(vm.chartNotice, null);
  assert.equal(vm.worstDaysNotice, null);
});
test("rankings table: worst 7-day first, band words, dash for missing window", () => {
  const html = rankingsHtml(rankings);
  assert.ok(html.indexOf("Silk Board to Hebbal") < html.indexOf("Old Airport Road"));
  assert.match(html, /60\.3 <span class="rk-band">Gridlock|60\.3 <span class="rk-band">Heavy/);
  const partial = rankingsHtml({ windows: { "7d": [{ route_id: "a", name: "A <x>", avg_index: 10 }], "28d": [] } });
  assert.match(partial, /A &lt;x&gt;/);
  assert.match(partial, /&mdash;/);
});
test("worst days list", () => {
  const html = worstDaysHtml(trends);
  assert.equal(html.match(/<li>/g).length, 4);
  assert.match(html, /Thu 5 Nov<\/span> index 71.4, 19.8 min lost on average/);
});
test("bad numbers in trends do not reach the HTML", () => {
  const html = worstDaysHtml({ worst_days: [{ date: "<i>", avg_index: "<img>", avg_minutes_lost: null }] });
  assert.doesNotMatch(html, /<i>|<img>/);
});

test("20 series get 20 distinct (colour, point style) pairs", () => {
  const routes = {};
  for (let i = 0; i < 20; i++) routes[`r${i}`] = 10 + i;
  const model = chartModel({ weeks: [{ week_start: "2026-11-02", partial: false, routes }] });
  const colors = ["#1", "#2", "#3", "#4", "#5", "#6"];
  const cfg = chartConfig(model, colors);
  const pairs = new Set(cfg.data.datasets.map((d) => `${d.borderColor}|${d.pointStyle}`));
  assert.equal(cfg.data.datasets.length, 20);
  assert.equal(pairs.size, 20);
});
test("worst-days notice states the real threshold", () =>
  assert.match(viewModel(fx("trends-empty.json"), { windows: {} }).worstDaysNotice, /1,000 readings/));
