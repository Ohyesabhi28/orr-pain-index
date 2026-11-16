import test from "node:test";
import assert from "node:assert/strict";
import {
  noticeText, updatedText, routeHtml, listHtml, viewModel, escapeHtml,
  chipModel, arrange, directionsOf, cityStats, heroHtml,
} from "../live.js";

const ok = { route_id: "a", name: "ORR <East>", corridor: "ORR", direction: "eastbound",
  status: "ok", live_s: 1920, free_flow_s: 1200, distance_m: 9000, pain_index: 62, minutes_lost: 12 };
const missing = { route_id: "b", name: "Hosur Rd", corridor: "Hosur", direction: "northbound",
  status: "missing", live_s: null, free_flow_s: null, distance_m: null, pain_index: null, minutes_lost: null };

test("notices", () => {
  assert.equal(noticeText("fresh", "2026-11-16T03:07:00Z"), null);
  assert.equal(noticeText("stale", "2026-11-16T03:07:00Z"), "Data is stale. Last update 8:37 am.");
  assert.equal(noticeText("overnight", null), "Collection resumes at 5:30am.");
  assert.equal(noticeText("empty", null), "Still collecting. First data arrives soon.");
});
test("updated header", () => {
  assert.equal(updatedText("2026-11-16T03:07:00Z"), "Updated 8:37 am");
  assert.equal(updatedText(null), "");
});
test("ok route shows band word, number, minutes", () => {
  const html = routeHtml(ok);
  assert.match(html, /band-high/);
  assert.match(html, />62</);
  assert.match(html, />Heavy</);
  assert.match(html, /\+12 min/);
  assert.match(html, /32 \/ 20 min/);
  assert.match(html, /--pct:62/);
});
test("names are escaped", () => assert.match(routeHtml(ok), /ORR &lt;East&gt;/));
test("missing route shows no reading and no numbers", () => {
  const html = routeHtml(missing);
  assert.match(html, /no reading/);
  assert.doesNotMatch(html, /min lost|index-num/);
});
test("list keeps order", () => {
  const html = listHtml([ok, missing]);
  assert.ok(html.indexOf("ORR") < html.indexOf("Hosur"));
});
test("viewModel empty hides list and shows notice", () => {
  const vm = viewModel({ observed_at_utc: null, routes: [missing] }, Date.parse("2026-11-16T06:00:00Z"));
  assert.equal(vm.state, "empty");
  assert.equal(vm.listHtml, "");
  assert.match(vm.notice, /Still collecting/);
});
test("viewModel fresh has list and no notice", () => {
  const vm = viewModel({ observed_at_utc: "2026-11-16T04:00:00Z", routes: [ok] }, Date.parse("2026-11-16T04:10:00Z"));
  assert.equal(vm.state, "fresh");
  assert.equal(vm.notice, null);
  assert.match(vm.listHtml, /band-high/);
});
test("escapeHtml", () => assert.equal(escapeHtml(`<&"'>`), "&lt;&amp;&quot;&#39;&gt;"));

test("route links to its corridor page, id encoded", () => {
  assert.match(routeHtml({ ...ok, route_id: "a b&c" }), /href="corridor\.html\?route=a%20b%26c"/);
});
test("numeric fields are coerced: strings with markup never reach the HTML", () => {
  const html = routeHtml({ ...ok, pain_index: "62", minutes_lost: "<img src=x>", live_s: 1920, free_flow_s: 1200 });
  assert.match(html, /no reading/);
  assert.doesNotMatch(html, /<img/);
});
test("a non-finite or null field means no reading", () => {
  for (const f of ["pain_index", "minutes_lost", "live_s", "free_flow_s"]) {
    assert.match(routeHtml({ ...ok, [f]: null }), /no reading/, `${f} null`);
    assert.match(routeHtml({ ...ok, [f]: "abc" }), /no reading/, `${f} abc`);
    assert.match(routeHtml({ ...ok, [f]: Infinity }), /no reading/, `${f} Infinity`);
  }
});
test("minutes lost is shown as a whole number", () => {
  assert.match(routeHtml({ ...ok, minutes_lost: 12.3456 }), /\+12 min/);
  assert.match(routeHtml({ ...ok, minutes_lost: "30.0" }), /\+30 min/);
});
test("rank is shown with two digits and names read as arrows", () => {
  const html = routeHtml({ ...ok, name: "Silk Board to Marathahalli" }, 3);
  assert.match(html, />03<\/span>Silk Board → Marathahalli/);
});

const bad = (id, pain, lost, direction = "eastbound", corridor = "C") => ({ ...ok, route_id: id, name: id, corridor, direction, pain_index: pain, minutes_lost: lost });

test("freshness chip says how old the data is", () => {
  const now = Date.parse("2026-11-16T04:06:00Z");
  assert.deepEqual(chipModel("fresh", "2026-11-16T04:00:00Z", now), { tone: "fresh", text: "Updated 6 min ago" });
  assert.deepEqual(chipModel("stale", "2026-11-15T19:00:00Z", now), { tone: "stale", text: "Stale, last updated 9 h ago" });
  assert.equal(chipModel("overnight", null, now).tone, "idle");
  assert.equal(chipModel("empty", null, now).text, "Waiting for first data");
});
test("arrange sorts worst first, puts missing last, and filters by direction", () => {
  const routes = [bad("a", 10, 30), bad("b", 80, 5, "westbound"), { ...ok, route_id: "m", name: "m", status: "missing", pain_index: null }, bad("c", 50, 20)];
  assert.deepEqual(arrange(routes).map((r) => r.route_id), ["b", "c", "a", "m"]);
  assert.deepEqual(arrange(routes, { sort: "lost" }).map((r) => r.route_id), ["a", "c", "b", "m"]);
  assert.deepEqual(arrange(routes, { sort: "name" }).map((r) => r.route_id), ["a", "b", "c", "m"]);
  assert.deepEqual(arrange(routes, { direction: "westbound" }).map((r) => r.route_id), ["b"]);
  assert.equal(routes[0].route_id, "a", "input is not mutated");
});
test("directionsOf lists each direction once", () => {
  assert.deepEqual(directionsOf([bad("a", 1, 1), bad("b", 1, 1, "westbound"), bad("c", 1, 1)]), ["eastbound", "westbound"]);
});
test("cityStats averages routes with readings and counts gridlocked ones", () => {
  const stats = cityStats([bad("a", 90, 30, "eastbound", "X"), bad("b", 30, 10, "westbound", "X"), bad("c", 60, 20, "eastbound", "Y"),
    { ...ok, route_id: "m", status: "missing", pain_index: null, corridor: "Z" }]);
  assert.deepEqual(stats, { index: 60, band: "high", lost: 20, routes: 4, corridors: 3, gridlocked: 1 });
  assert.equal(cityStats([{ ...ok, status: "missing", pain_index: null }]), null);
});
test("hero card reads the band back in words", () => {
  const html = heroHtml({ index: 56, band: "high", lost: 17, routes: 20, corridors: 10, gridlocked: 4 });
  assert.match(html, /Bengaluru is feeling it\./);
  assert.match(html, /Heavy: 17 min lost on the average route/);
  assert.match(html, /<dd>04<\/dd>/);
  assert.match(html, /75–100 Gridlock/);
  assert.equal(heroHtml(null), "");
});
test("viewModel sorts and describes the list", () => {
  const vm = viewModel({ observed_at_utc: "2026-11-16T04:00:00Z", routes: [bad("a", 10, 1), bad("b", 90, 1)] },
    Date.parse("2026-11-16T04:10:00Z"), { sort: "pain", direction: "all" });
  assert.ok(vm.listHtml.indexOf(">b<") < vm.listHtml.indexOf(">a<"));
  assert.match(vm.boardSub, /All 2 routes · worst first/);
  assert.equal(vm.today, "Bengaluru / MON, 16 NOV 2026");
});

test("stale notice adds the IST date when the observation is not from today", () => {
  const now = Date.parse("2026-11-16T04:00:00Z");
  assert.equal(noticeText("stale", "2026-11-11T17:52:00Z", now), "Data is stale. Last update 11:22 pm, 11 Nov.");
  assert.equal(noticeText("stale", "2026-11-16T03:07:00Z", now), "Data is stale. Last update 8:37 am.");
});
