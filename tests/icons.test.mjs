/** THIS FILE DOES: guards the favicon set (ICO sizes, every <link rel=icon> target exists), ROLE: Automation, MAINTAINER NOTE: regenerate icons with `python scripts/build-icons.py`; paths must stay relative because Pages serves from /PlanetHumanity/. **/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);

test('favicon.ico holds 16, 32 and 48 px images', () => {
  const buf = readFileSync(new URL('favicon.ico', root));
  assert.equal(buf.readUInt16LE(2), 1, 'ICO type');
  const count = buf.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32, 48]);
});

test('every icon/manifest link in index.html is relative and exists', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 4);
  for (const h of hrefs) {
    assert.ok(!h.startsWith('/'), `${h} must be relative`);
    assert.ok(existsSync(new URL(h, root)), `${h} missing`);
  }
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  for (const i of manifest.icons) assert.ok(existsSync(new URL(i.src, root)), `${i.src} missing`);
});
