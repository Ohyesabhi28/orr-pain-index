// Theme toggle. The saved choice is applied by a tiny inline script in each page head
// (so there is no flash); this module only wires the button.
const KEY = "orr-theme";

function current() {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const button = document.getElementById("theme");
if (button) {
  button.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice just will not persist */ }
  });
}
