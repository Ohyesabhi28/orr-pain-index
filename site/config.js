// TODO: replace <owner>/<repo> with the real GitHub repository once it exists.
// This is the only place the placeholder lives.
const REMOTE_BASE = "https://raw.githubusercontent.com/<owner>/<repo>/data/public/";

const params = new URLSearchParams(globalThis.location?.search ?? "");

export const DATA_BASE = params.get("data") === "fixtures" ? "./fixtures/" : REMOTE_BASE;
