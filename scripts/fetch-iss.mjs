/** THIS FILE DOES: fetches NASA's public ISS OEM ephemeris and writes a trimmed same-origin snapshot, ROLE: Automation, MAINTAINER NOTE: run by .github/workflows/live-data.yml every 12h; window must outlast the cron period with margin so the site never runs out of track before the next commit. **/

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OEM_URL = 'https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt';
const WINDOW_BEFORE_MS = 2 * 60 * 60 * 1000; // small back-margin for clock skew
const WINDOW_AFTER_MS = 16 * 60 * 60 * 1000; // > 12h cron period, so a missed run still has data

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'data', 'live', 'iss-oem.json');

function parseOem(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*$/);
    if (!m) continue;
    const [, epoch, x, y, z, vx, vy, vz] = m;
    records.push({ epoch: `${epoch}Z`, r: [Number(x), Number(y), Number(z)], v: [Number(vx), Number(vy), Number(vz)] });
  }
  return records;
}

async function main() {
  const res = await fetch(OEM_URL);
  if (!res.ok) throw new Error(`OEM fetch failed: HTTP ${res.status}`);
  const oemText = await res.text();
  const all = parseOem(oemText);
  if (!all.length) throw new Error('OEM parse produced 0 records');

  const now = Date.now();
  const lo = now - WINDOW_BEFORE_MS;
  const hi = now + WINDOW_AFTER_MS;
  const records = all.filter((r) => {
    const t = Date.parse(r.epoch);
    return t >= lo && t <= hi;
  });
  if (!records.length) throw new Error('no OEM records fall inside the fetch window; NASA ephemeris may be stale');

  const comment = '/** THIS FILE DOES: trimmed ISS OEM ephemeris snapshot committed by live-data.yml, ROLE: Data, MAINTAINER NOTE: regenerated every 12h by scripts/fetch-iss.mjs; do not hand-edit. **/';
  const rest = {
    schemaVersion: 1,
    source: 'https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt',
    refFrame: 'EME2000',
    fetchedAt: new Date(now).toISOString(),
    records,
  };
  // First line must be exactly `{ "$comment": "...",` per repo header rule, so the header
  // is spliced onto the first line by hand rather than via a single JSON.stringify(out).
  const prettyRest = JSON.stringify(rest, null, 2).replace(/^\{\n/, '');
  const text = `{ "$comment": "${comment.replace(/"/g, '\\"')}",\n${prettyRest}`;
  JSON.parse(text); // fail loudly here, not silently on disk, if the splice ever breaks
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, text);
  console.log(`wrote ${records.length} records to ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
