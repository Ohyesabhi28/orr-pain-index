import {
  freshness, band, istClock, istDateLabel, isIstToday, istDateLong, ageLabel, routeLabel,
  escapeHtml, finiteOrNaN, readingOf, BANDS, BAND_LABEL, BAND_RANGE,
} from "./lib.js";

export { escapeHtml };

/** Notice text for a freshness state, or null when there is nothing to say. */
export function noticeText(state, observedAtIso, nowMs) {
  if (state === "stale") {
    const date = nowMs != null && !isIstToday(observedAtIso, nowMs) ? `, ${istDateLabel(observedAtIso)}` : "";
    return `Data is stale. Last update ${istClock(observedAtIso)}${date}.`;
  }
  if (state === "overnight") return "Collection resumes at 5:30am.";
  if (state === "empty") return "Still collecting. First data arrives soon.";
  return null;
}

/** Header line, or "" when there is no observation. */
export function updatedText(observedAtIso) {
  return observedAtIso ? `Updated ${istClock(observedAtIso)}` : "";
}

/** The freshness chip: how old the data is, in words. */
export function chipModel(state, observedAtIso, nowMs) {
  if (state === "fresh") return { tone: "fresh", text: `Updated ${ageLabel(observedAtIso, nowMs)}` };
  if (state === "stale") return { tone: "stale", text: `Stale, last updated ${ageLabel(observedAtIso, nowMs) || "a while ago"}` };
  if (state === "overnight") return { tone: "idle", text: "Overnight · back at 5:30 am" };
  return { tone: "idle", text: "Waiting for first data" };
}

export { finiteOrNaN, readingOf };

const mins = (seconds) => Math.round(seconds / 60);
const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** One route as an HTML string. Band is shown as a word as well as a colour. */
export function routeHtml(route, rank) {
  const name = escapeHtml(routeLabel(route.name));
  const href = escapeHtml(`corridor.html?route=${encodeURIComponent(route.route_id ?? "")}`);
  const place = escapeHtml(route.direction ?? "");
  const lead = rank != null ? `<span class="route-rank">${String(rank).padStart(2, "0")}</span>` : "";
  const id = `<div class="route-id"><a class="route-name" href="${href}">${lead}${name}</a>`
    + (place ? `<span class="route-dir">${place}</span>` : "") + `</div>`;
  const r = readingOf(route);
  if (!r) {
    return `<li class="route route-missing">${id}<span class="route-bar" aria-hidden="true"></span>`
      + `<span class="route-nodata">no reading</span></li>`;
  }
  const b = band(r.pain);
  return `<li class="route band-${b}">${id}`
    + `<span class="route-bar" style="--pct:${clampPct(r.pain)}" aria-hidden="true"></span>`
    + `<span class="route-index"><span class="index-num">${Math.round(r.pain)}</span> · <span class="index-band">${BAND_LABEL[b]}</span></span>`
    + `<span class="route-lost">+${Math.round(r.lost)} min<span class="m-only"> lost</span></span>`
    + `<span class="route-times">${mins(r.live)} / ${mins(r.free)} min</span>`
    + `</li>`;
}

export function listHtml(routes) {
  return routes.map((route, i) => routeHtml(route, i + 1)).join("");
}

export const SORTS = { pain: "Pain", lost: "Minutes lost", name: "Route name" };

/** Sort and filter routes. Routes without a reading always go last. */
export function arrange(routes, { sort = "pain", direction = "all" } = {}) {
  const list = direction === "all" ? [...routes] : routes.filter((r) => r.direction === direction);
  const key = (r) => {
    const reading = readingOf(r);
    if (!reading) return null;
    return sort === "lost" ? reading.lost : reading.pain;
  };
  const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""));
  return list.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null || kb === null) return ka === kb ? byName(a, b) : ka === null ? 1 : -1;
    if (sort === "name") return byName(a, b);
    return kb - ka || byName(a, b);
  });
}

/** Distinct directions in the data, sorted. */
export function directionsOf(routes) {
  return [...new Set(routes.map((r) => r.direction).filter(Boolean))].sort();
}

/** City-wide numbers, or null when no route has a reading. */
export function cityStats(routes) {
  const rows = routes.map((r) => readingOf(r)).filter(Boolean);
  if (!rows.length) return null;
  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const index = Math.round(mean("pain"));
  return {
    index,
    band: band(index),
    lost: Math.round(mean("lost")),
    routes: routes.length,
    corridors: new Set(routes.map((r) => r.corridor).filter(Boolean)).size,
    gridlocked: rows.filter((r) => band(r.pain) === "severe").length,
  };
}

const HERO_COPY = {
  low: ["Bengaluru is cruising.", "Roads are open. Enjoy it while it lasts."],
  moderate: ["Bengaluru is slowing down.", "A few corridors are filling up. Build in some buffer."],
  high: ["Bengaluru is feeling it.", "The ring road has other plans. Leave a little room."],
  severe: ["Bengaluru is at a standstill.", "If you can wait it out, do. If not, leave well ahead."],
};

export function legendHtml() {
  return BANDS.map((b) => `<li class="tone-${b}">${BAND_RANGE[b]} ${BAND_LABEL[b]}</li>`).join("");
}

/** The city-wide card. */
export function heroHtml(stats) {
  if (!stats) return "";
  const [headline, sub] = HERO_COPY[stats.band];
  const label = BAND_LABEL[stats.band];
  const pad = (n) => String(n).padStart(2, "0");
  return `<div class="hero-main band-${stats.band}">`
    + `<p class="eyebrow">Your commute, quantified.</p>`
    + `<h1 id="hero-title">${headline}</h1>`
    + `<div class="hero-metric"><span class="hero-num">${stats.index}</span>`
    + `<div class="hero-side-stack"><span class="hero-of">/ 100</span><span class="hero-band">${label}</span></div></div>`
    + `<p class="hero-line">${label}: ${stats.lost} min lost on the average route</p>`
    + `<p class="hero-sub">${sub}</p></div>`
    + `<div class="hero-side"><p class="eyebrow muted">The network at a glance</p>`
    + `<dl class="net-metrics">`
    + `<div><dt>routes</dt><dd>${stats.routes}</dd></div>`
    + `<div><dt>corridors</dt><dd>${stats.corridors}</dd></div>`
    + `<div><dt>gridlocked</dt><dd>${pad(stats.gridlocked)}</dd></div></dl>`
    + `<ul class="legend" aria-label="Pain bands">${legendHtml()}</ul></div>`;
}

/** Everything the page shows, as plain data. */
export function viewModel(latest, nowMs, options = {}) {
  const observed = latest.observed_at_utc ?? null;
  const state = freshness(observed, nowMs);
  const routes = latest.routes ?? [];
  const arranged = arrange(routes, options);
  return {
    state,
    updated: updatedText(observed),
    chip: chipModel(state, observed, nowMs),
    today: observed ? `Bengaluru / ${istDateLong(observed)}` : "Bengaluru",
    notice: noticeText(state, observed, nowMs),
    heroHtml: state === "empty" ? "" : heroHtml(cityStats(routes)),
    boardSub: `${arranged.length === routes.length ? "All " : `${arranged.length} of `}${routes.length} routes · ${options.sort === "lost" ? "most minutes lost" : options.sort === "name" ? "A to Z" : "worst"} first · live time / free-flow`,
    listHtml: state === "empty" ? "" : listHtml(arranged),
    directions: directionsOf(routes),
  };
}

function controlHtml(id, label, options, selected) {
  const opts = options.map(([value, text]) =>
    `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(text)}</option>`).join("");
  return `<label class="select-wrap"><span class="sr-only">${escapeHtml(label)}</span><select id="${id}">${opts}</select></label>`;
}

async function main() {
  const $ = (id) => document.getElementById(id);
  try {
    const { loadJson, showError } = await import("./data.js").catch((err) => {
      throw new Error(`Could not start the page: ${err.message}`);
    });
    try {
      const file = new URLSearchParams(location.search).get("latest") || "latest.json"; // ?latest=latest-empty.json for fixture checks
      const latest = await loadJson(file);
      const options = { sort: "pain", direction: "all" };

      const render = () => {
        const vm = viewModel(latest, Date.now(), options);
        $("today").textContent = vm.today;
        const chip = $("chip");
        chip.textContent = vm.chip.text;
        chip.className = `chip chip-${vm.chip.tone}`;
        const notice = $("notice");
        notice.textContent = vm.notice ?? "";
        notice.hidden = vm.notice === null;
        const empty = vm.state === "empty";
        $("hero").innerHTML = vm.heroHtml;
        $("hero").hidden = vm.heroHtml === "";
        $("board").hidden = empty;
        $("empty").hidden = !empty;
        $("board-sub").textContent = vm.boardSub;
        $("routes").innerHTML = vm.listHtml;
        return vm;
      };

      const vm = render();
      if (vm.state !== "empty") {
        $("controls").innerHTML =
          controlHtml("sort", "Sort routes by", Object.entries(SORTS).map(([k, v]) => [k, `Sort: ${v}`]), options.sort)
          + controlHtml("direction", "Filter by direction",
            [["all", "Direction: All"], ...vm.directions.map((d) => [d, `Direction: ${d[0].toUpperCase()}${d.slice(1)}`])], options.direction);
        $("sort").addEventListener("change", (e) => { options.sort = e.target.value; render(); });
        $("direction").addEventListener("change", (e) => { options.direction = e.target.value; render(); });
      }
    } catch (err) {
      showError(err.message);
    }
  } catch (err) {
    // data.js itself failed to load, so showError is unavailable: plain text fallback.
    const notice = document.getElementById("notice");
    if (notice) {
      notice.textContent = err.message;
      notice.hidden = false;
    }
  }
}

if (typeof document !== "undefined") main();
