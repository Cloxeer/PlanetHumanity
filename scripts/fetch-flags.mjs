/** THIS FILE DOES: Vendors official country flag SVGs (flag-icons@7.5.0, 4x3) into the repo, ROLE: Data, MAINTAINER NOTE: Never depend on a live flag CDN at request time - re-run this after bumping the pinned flag-icons version; a 404 for a given alpha-2 is skipped (not every ISO code has an SVG in the package), not fatal. **/
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FLAGS_ROOT = path.join(ROOT, 'assets', 'flags');
const OUT_DIR = path.join(FLAGS_ROOT, '4x3');
const CODES_URL = 'https://cdn.jsdelivr.net/npm/i18n-iso-countries@7/codes.json';
const FLAG_BASE = 'https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3/';
const CONCURRENCY = 8; // throttle: be polite to the CDN, not a real rate limiter

const LICENSE = `MIT License

Copyright (c) 2016-present Panayiotis Lipiridis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---
Vendored from flag-icons@7.5.0 (https://github.com/lipis/flag-icons) by
scripts/fetch-flags.mjs. Only the 4x3 SVG flags are copied into this repo;
the rest of the package (CSS, other aspect ratios) is not used or committed.
`;

async function fetchOne(alpha2) {
  const lower = alpha2.toLowerCase();
  const res = await fetch(FLAG_BASE + lower + '.svg');
  if (res.status === 404) return null; // not every ISO code has a flag-icons SVG (e.g. some historical/reserved codes)
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(OUT_DIR, lower + '.svg'), buf);
  return { alpha2: lower, bytes: buf.length };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const codesRes = await fetch(CODES_URL);
  if (!codesRes.ok) throw new Error(`iso codes fetch failed: ${codesRes.status} ${codesRes.statusText}`);
  const codes = await codesRes.json(); // rows [alpha2, alpha3, numeric]
  const alpha2s = [...new Set(codes.map((row) => row[0]).filter(Boolean))];

  const results = [];
  let next = 0;
  async function worker() {
    while (next < alpha2s.length) {
      const code = alpha2s[next++];
      try {
        const r = await fetchOne(code);
        if (r) results.push(r);
      } catch (e) {
        console.error(`skip ${code}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await writeFile(path.join(FLAGS_ROOT, 'LICENSE.txt'), LICENSE, 'utf8');

  const total = results.reduce((sum, r) => sum + r.bytes, 0);
  const largest = results.reduce((a, b) => (b.bytes > (a?.bytes ?? -1) ? b : a), null);
  console.log(`fetched ${results.length} flags, ${total} bytes total`);
  if (largest) console.log(`largest: ${largest.alpha2}.svg (${largest.bytes} bytes)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
