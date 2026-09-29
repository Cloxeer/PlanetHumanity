/** THIS FILE DOES: shared fetch/format helpers for layer adapters, ROLE: Data, MAINTAINER NOTE: pure except fetchJson; keep adapters' normalize() calling only pure helpers from here. **/

export async function fetchJson(url, { signal, headers } = {}) {
  const res = await fetch(url, { signal, headers });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function fetchText(url, { signal, headers } = {}) {
  const res = await fetch(url, { signal, headers });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// latest fully-elapsed UTC day, as YYYY-MM-DD, for GIBS TIME params.
export function latestCompleteUtcDay(now = Date.now()) {
  return new Date(now - 86400000).toISOString().slice(0, 10);
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
