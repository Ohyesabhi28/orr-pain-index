import { freshness, band, istClock, istDateLabel, isIstToday, escapeHtml, BAND_LABEL } from "./lib.js";

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

/** Number(...) with null/blank/non-numeric treated as NaN (Number(null) would be 0). */
export function finiteOrNaN(v) {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  return Number(v);
}

const mins = (seconds) => Math.round(seconds / 60);
const oneDecimal = (n) => String(Math.round(n * 10) / 10);

/** One route as an HTML string. Band is shown as a word as well as a colour. */
export function routeHtml(route) {
  const name = escapeHtml(route.name);
  const where = escapeHtml([route.corridor, route.direction].filter(Boolean).join(" · "));
  const href = escapeHtml(`corridor.html?route=${encodeURIComponent(route.route_id ?? "")}`);
  const head = `<div class="route-name"><a href="${href}">${name}</a></div><div class="route-dir">${where}</div>`;
  const pain = finiteOrNaN(route.pain_index);
  const lost = finiteOrNaN(route.minutes_lost);
  const live = finiteOrNaN(route.live_s);
  const free = finiteOrNaN(route.free_flow_s);
  if (route.status !== "ok" || ![pain, lost, live, free].every(Number.isFinite)) {
    return `<li class="route route-missing">${head}<div class="route-nodata">no reading</div></li>`;
  }
  const b = band(pain);
  return `<li class="route band-${b}">${head}`
    + `<div class="route-index"><span class="index-num">${Math.round(pain)}</span>`
    + `<span class="index-band">${BAND_LABEL[b]}</span></div>`
    + `<div class="route-lost">${oneDecimal(lost)} min lost</div>`
    + `<div class="route-times">${mins(live)} min now vs ${mins(free)} min free-flow</div>`
    + `</li>`;
}

export function listHtml(routes) {
  return routes.map(routeHtml).join("");
}

/** Everything the page shows, as plain data. */
export function viewModel(latest, nowMs) {
  const observed = latest.observed_at_utc ?? null;
  const state = freshness(observed, nowMs);
  return {
    state,
    updated: updatedText(observed),
    notice: noticeText(state, observed, nowMs),
    listHtml: state === "empty" ? "" : listHtml(latest.routes ?? []),
  };
}

async function main() {
  try {
    const { loadJson, showError } = await import("./data.js").catch((err) => {
      throw new Error(`Could not start the page: ${err.message}`);
    });
    try {
      const file = new URLSearchParams(location.search).get("latest") || "latest.json"; // ?latest=latest-empty.json for fixture checks
      const latest = await loadJson(file);
      const vm = viewModel(latest, Date.now());
      document.getElementById("updated").textContent = vm.updated;
      const notice = document.getElementById("notice");
      notice.textContent = vm.notice ?? "";
      notice.hidden = vm.notice === null;
      document.getElementById("routes").innerHTML = vm.listHtml;
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
