import { band, escapeHtml, BAND_LABEL } from "./lib.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const POINT_STYLES = ["circle", "rect", "triangle", "rectRot", "cross", "star"];

const num = (v) => (v == null || (typeof v === "string" && v.trim() === "") ? NaN : Number(v));

function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

/** "2026-10-19" -> "19 Oct"; anything unparseable is returned as-is. */
export function shortDate(iso) {
  const d = parseDate(iso);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : String(iso);
}

/** "2026-11-05" -> "Thu 5 Nov". */
export function dayDate(iso) {
  const d = parseDate(iso);
  return d ? `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : String(iso);
}

/**
 * Plain-data chart description: one series per route that has any weekly value.
 * `partial[i]` is true when week i is incomplete (the segment ending there is drawn dashed).
 * `names` maps route id to display name; ids are the fallback.
 */
export function chartModel(trends, names = {}) {
  const weeks = trends.weeks ?? [];
  const ids = [];
  for (const w of weeks) for (const id of Object.keys(w.routes ?? {})) if (!ids.includes(id)) ids.push(id);
  return {
    labels: weeks.map((w) => shortDate(w.week_start)),
    partial: weeks.map((w) => Boolean(w.partial)),
    series: ids.map((id, i) => ({
      id,
      label: names[id] ?? id,
      data: weeks.map((w) => {
        const v = num(w.routes?.[id]);
        return Number.isFinite(v) ? v : null;
      }),
      pointStyle: POINT_STYLES[i % POINT_STYLES.length],
    })),
  };
}

/** Chart.js config. `colors` is a list of CSS colours; `theme` has text and grid colours. */
export function chartConfig(model, colors, theme = {}) {
  return {
    type: "line",
    data: {
      labels: model.labels,
      datasets: model.series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length],
        pointStyle: s.pointStyle,
        pointRadius: 4,
        tension: 0.2,
        spanGaps: true,
        segment: { borderDash: (ctx) => (model.partial[ctx.p1DataIndex] ? [6, 4] : undefined) },
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: "Average Pain Index", color: theme.text },
          ticks: { color: theme.text }, grid: { color: theme.grid } },
        x: { title: { display: true, text: "Week starting (Monday)", color: theme.text },
          ticks: { color: theme.text }, grid: { color: theme.grid } },
      },
      plugins: { legend: { position: "bottom", labels: { color: theme.text, usePointStyle: true } } },
    },
  };
}

function indexCell(entry) {
  const v = entry ? num(entry.avg_index) : NaN;
  if (!Number.isFinite(v)) return `<td class="num">&mdash;</td>`;
  const b = band(v);
  return `<td class="num band-text-${b}">${Math.round(v * 10) / 10} <span class="rk-band">${BAND_LABEL[b]}</span></td>`;
}

/** 7-day vs 28-day ranking table, worst 7-day route first. */
export function rankingsHtml(rankings) {
  const w7 = rankings.windows?.["7d"] ?? [];
  const w28 = rankings.windows?.["28d"] ?? [];
  const byId = (list) => new Map(list.map((r) => [r.route_id, r]));
  const m7 = byId(w7), m28 = byId(w28);
  const ids = [...new Set([...w7, ...w28].map((r) => r.route_id))];
  const score = (id) => num(m7.get(id)?.avg_index ?? m28.get(id)?.avg_index) || 0;
  ids.sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  if (!ids.length) return "";
  const rows = ids.map((id) => {
    const name = (m7.get(id) ?? m28.get(id)).name ?? id;
    return `<tr><th scope="row">${escapeHtml(name)}</th>${indexCell(m7.get(id))}${indexCell(m28.get(id))}</tr>`;
  });
  return `<table class="rank-table"><thead><tr><th scope="col">Route</th><th scope="col">Last 7 days</th>`
    + `<th scope="col">Last 28 days</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/** Worst days list, or "" when there are none. */
export function worstDaysHtml(trends) {
  const days = trends.worst_days ?? [];
  return days.map((d) => {
    const idx = num(d.avg_index), lost = num(d.avg_minutes_lost);
    const parts = [Number.isFinite(idx) ? `index ${Math.round(idx * 10) / 10}` : null,
      Number.isFinite(lost) ? `${Math.round(lost * 10) / 10} min lost on average` : null].filter(Boolean);
    return `<li><span class="wd-date">${escapeHtml(dayDate(d.date))}</span> ${escapeHtml(parts.join(", "))}</li>`;
  }).join("");
}

/** Everything the page shows apart from the chart, as plain data. */
export function viewModel(trends, rankings) {
  const hasWeeks = (trends.weeks ?? []).length > 0;
  return {
    hasWeeks,
    chartNotice: hasWeeks ? null : "Still collecting. Weekly trends appear after the first full week of data.",
    rankingsHtml: rankingsHtml(rankings) || `<p class="muted">Still collecting. Rankings appear once routes have readings.</p>`,
    worstDaysHtml: worstDaysHtml(trends),
    worstDaysNotice: (trends.worst_days ?? []).length ? null : "Still collecting. A day needs at least 40 readings to count.",
  };
}

function seriesColors() {
  const css = getComputedStyle(document.documentElement);
  return [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--series-${i}`).trim() || "#888");
}

function drawChart(model) {
  const canvas = document.getElementById("trend-chart");
  const notice = document.getElementById("chart-notice");
  if (typeof Chart === "undefined") {
    notice.textContent = "The chart could not be loaded. The tables below still show the numbers.";
    notice.hidden = false;
    return;
  }
  canvas.parentElement.hidden = false; // show first so Chart.js can measure it
  const css = getComputedStyle(document.documentElement);
  new Chart(canvas, chartConfig(model, seriesColors(),
    { text: css.getPropertyValue("--muted").trim(), grid: css.getPropertyValue("--border").trim() }));
}

async function main() {
  try {
    const { loadJson, showError } = await import("./data.js").catch((err) => {
      throw new Error(`Could not start the page: ${err.message}`);
    });
    try {
      const file = new URLSearchParams(location.search).get("trends") || "trends.json"; // ?trends=trends-empty.json for fixture checks
      const [trends, rankings] = await Promise.all([loadJson(file), loadJson("rankings.json")]);
      const vm = viewModel(trends, rankings);
      const names = {};
      for (const list of Object.values(rankings.windows ?? {})) for (const r of list) names[r.route_id] = r.name;
      const chartNotice = document.getElementById("chart-notice");
      if (vm.hasWeeks) drawChart(chartModel(trends, names));
      else { chartNotice.textContent = vm.chartNotice; chartNotice.hidden = false; }
      document.getElementById("rankings").innerHTML = vm.rankingsHtml;
      document.getElementById("worst-days").innerHTML = vm.worstDaysHtml;
      const wn = document.getElementById("worst-notice");
      wn.textContent = vm.worstDaysNotice ?? "";
      wn.hidden = vm.worstDaysNotice === null;
    } catch (err) {
      showError(err.message);
    }
  } catch (err) {
    const notice = document.getElementById("chart-notice");
    if (notice) {
      notice.textContent = err.message;
      notice.hidden = false;
    }
  }
}

if (typeof document !== "undefined") main();
