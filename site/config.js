// Remote data base: the `data` branch of this repository.
const REMOTE_BASE = "https://raw.githubusercontent.com/Ohyesabhi28/orr-pain-index/data/public/";

const params = new URLSearchParams(globalThis.location?.search ?? "");

export const DATA_BASE = params.get("data") === "fixtures" ? "./fixtures/" : REMOTE_BASE;
