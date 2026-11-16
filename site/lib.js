// Pure helpers: no DOM, no fetch, so Node can import them for tests.

const IST_OFFSET_MIN = 330;
const STALE_AFTER_MS = 45 * 60 * 1000;
const DEAD_AFTER_MS = 8 * 60 * 60 * 1000; // normal overnight gap is ~6 h (23:22 to 05:37 IST)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const OPEN_MIN = 5 * 60 + 30; // 05:30 IST
const CLOSE_MIN = 23 * 60 + 30; // 23:30 IST
const WARMUP_END_MIN = 6 * 60 + 15; // 06:15 IST

function istMinutesOfDay(ms) {
  const shifted = new Date(ms + IST_OFFSET_MIN * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** "fresh" | "stale" | "overnight" | "empty" */
export function freshness(observedAtIso, nowMs) {
  if (observedAtIso == null) return "empty";
  const observedMs = Date.parse(observedAtIso);
  if (Number.isNaN(observedMs)) return "stale"; // unparseable: never claim "fresh"
  if (nowMs - observedMs > DEAD_AFTER_MS) return "stale"; // a dead collector is stale even overnight
  const minutes = istMinutesOfDay(nowMs);
  if (minutes < OPEN_MIN || minutes >= CLOSE_MIN) return "overnight";
  const old = nowMs - observedMs > STALE_AFTER_MS;
  if (old && minutes < WARMUP_END_MIN) return "overnight";
  return old ? "stale" : "fresh";
}

/** "low" | "moderate" | "high" | "severe" */
export function band(index) {
  if (index < 25) return "low";
  if (index < 50) return "moderate";
  if (index < 75) return "high";
  return "severe";
}

/** IST wall clock like "8:37 am". */
export function istClock(iso) {
  const minutes = istMinutesOfDay(Date.parse(iso));
  const h24 = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "am" : "pm"}`;
}

function istDayNumber(ms) {
  return Math.floor((ms + IST_OFFSET_MIN * 60 * 1000) / 86400000);
}

/** IST calendar date like "11 Nov". */
export function istDateLabel(iso) {
  const shifted = new Date(Date.parse(iso) + IST_OFFSET_MIN * 60 * 1000);
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}`;
}

/** True when the ISO instant falls on the same IST calendar day as `nowMs`. */
export function isIstToday(iso, nowMs) {
  return istDayNumber(Date.parse(iso)) === istDayNumber(nowMs);
}

/**
 * Arrange heatmap cells into 7 rows (Monday first) of cells in slot order.
 * `slots` is the sorted list of distinct slot labels found in the cells.
 */
export function heatmapGrid(cells) {
  const slots = [...new Set(cells.map((c) => c.slot))].sort();
  const rows = Array.from({ length: 7 }, () => []);
  for (const c of cells) {
    if (Number.isInteger(c.weekday) && c.weekday >= 0 && c.weekday < 7) rows[c.weekday].push(c);
  }
  for (const row of rows) row.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  return { slots, rows };
}

function clock12(totalMinutes) {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: `${h12}:${String(m % 60).padStart(2, "0")}`, mer: h24 < 12 ? "am" : "pm" };
}

/** A 30-minute slot start like "08:30" as "8:30–9:00 am" (meridiem shown on both ends when it changes). */
export function slotRange(slot) {
  const [h, m] = slot.split(":").map(Number);
  const start = clock12(h * 60 + m);
  const end = clock12(h * 60 + m + 30);
  return start.mer === end.mer
    ? `${start.text}–${end.text} ${end.mer}`
    : `${start.text} ${start.mer}–${end.text} ${end.mer}`;
}

/** A slot start like "08:30" as "8:30 am". */
export function slotLabel(slot) {
  const [h, m] = slot.split(":").map(Number);
  const c = clock12(h * 60 + m);
  return `${c.text} ${c.mer}`;
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const BAND_LABEL = { low: "Low", moderate: "Moderate", high: "High", severe: "Severe" };
