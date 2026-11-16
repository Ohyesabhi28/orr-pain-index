import { DATA_BASE } from "./config.js";

/** Fetch `<DATA_BASE><path>` as JSON. Rejects with an Error naming the file. */
export async function loadJson(path) {
  let res;
  try {
    res = await fetch(DATA_BASE + path, { cache: "no-cache" });
  } catch (err) {
    throw new Error(`Could not load ${path}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${path}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`Could not load ${path}: not valid JSON`);
  }
}

/** Render a visible error banner at the top of the page. */
export function showError(message) {
  let banner = document.getElementById("error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "error-banner";
    banner.className = "notice notice-error";
    banner.setAttribute("role", "alert");
    (document.querySelector("main") ?? document.body).prepend(banner);
  }
  banner.textContent = message;
}
