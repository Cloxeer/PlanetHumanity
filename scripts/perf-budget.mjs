/** THIS FILE DOES: Computes gzip byte budgets and a Slow-3G waterfall estimate against tests/budgets.json, ROLE: Automation, MAINTAINER NOTE: Missing files are reported as FAIL, never thrown—lazy imports and concurrent builds may not have all files yet. globeLocalGzipMax covers the lazy globe files incl. countries-110m.geojson and Legend.js (a static import of GlobeControls.js, so it always ships with the globe download). CountryPanel/RefImage/refimage.css/SearchPanel/search.css reported as informational lazy set (separate user actions - a country click, an image load, a search open - unlock them, not the globe download). flags.js and SheetGesture.js are critical, NOT lazy: InspectorModal.js (critical) statically imports both, so a native-ESM browser fetches them as part of the critical graph whether or not the user ever opens a mobile sheet - verified against the actual import graph, not assumed. **/

import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const CRITICAL_FIXED = ['index.html', 'src/styles.css', 'src/main.js'];
const CRITICAL_CORE_GLOB_HINT = ['src/core/SpatialStore.js', 'src/core/ChronologyEngine.js'];
const CRITICAL_UI = [
  'src/ui/TimelineHUD.js', 'src/ui/InspectorModal.js', 'src/ui/PlainFeedFallback.js',
  'src/ui/categories.js', 'src/ui/icons.js', 'src/ui/prefs.js', 'src/ui/ThemeToggle.js', 'src/ui/FilterPanel.js',
  // Both are tiny, but they're critical on merit, not by choice: InspectorModal.js (above) statically
  // imports them, so the browser's module graph fetches them before the list is even interactive.
  'src/ui/flags.js', 'src/ui/SheetGesture.js',
];
const GLOBE_LOCAL_FILES = [
  'src/ui/GlobeStage.js', 'src/ui/GlobeControls.js', 'src/ui/PointCard.js', 'src/ui/globe.css', 'data/geo/countries-110m.geojson',
  'src/ui/Legend.js', // static import of GlobeControls.js -> always ships with the globe download
];
const GLOBE_TEXTURE_FILE = 'data/geo/earth-day.jpg';
// Lazy but NOT part of globeLocalGzipMax: unlocked by a country click / an inspector or card open /
// a search open / a layer item card open, not by the globe download itself. Reported for visibility
// only; missing files are skipped, not failed.
const LAZY_EXTRA_FILES = [
  'src/ui/SettingsPopover.js', // imported on the first gear tap (globe controls or phone nav)
  'src/ui/CountryPanel.js', 'src/ui/RefImage.js', 'src/ui/refimage.css', 'src/ui/SearchPanel.js', 'src/ui/search.css',
  'src/ui/eventIcons.js', 'src/ui/layerdetail.css',
];
// Layers: lazy-loaded on the first Layers click (or right after the globe if the user left layers
// on), never critical. src/layers/*.js is discovered dynamically since DATA adds one module per
// layer plus registry.js; the 4 fixed UI files are this shell's own.
const LAYERS_UI_FILES = ['src/ui/LayerManager.js', 'src/ui/LayersPanel.js', 'src/ui/LayerItemCard.js', 'src/ui/layers.css'];

const rows = [];
let anyFail = false;
const failRow = (name, msg) => { rows.push({ name, goal: '-', measured: 'MISSING/ERROR', pass: false, note: msg }); anyFail = true; };

async function readFileSafe(p) {
  try { return await readFile(p); } catch (e) { return { __error: e.message }; }
}

async function main() {
  let budgets;
  try {
    budgets = JSON.parse(await readFile(path.join(ROOT, 'tests', 'budgets.json'), 'utf8'));
  } catch (e) {
    console.error(`FATAL: cannot read tests/budgets.json: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  // discover src/core/*.js dynamically so new core modules are budgeted automatically
  let coreFiles = [];
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(path.join(ROOT, 'src', 'core'));
    coreFiles = entries.filter((f) => f.endsWith('.js')).map((f) => `src/core/${f}`).sort();
  } catch { coreFiles = CRITICAL_CORE_GLOB_HINT; }
  if (coreFiles.length === 0) coreFiles = CRITICAL_CORE_GLOB_HINT;

  const criticalPaths = [...CRITICAL_FIXED, ...coreFiles, ...CRITICAL_UI];

  // load manifest + shards for data set
  let manifest = null;
  let manifestRaw = null;
  const manifestPath = path.join(ROOT, 'data', 'shards', 'manifest.json');
  const manifestBuf = await readFileSafe(manifestPath);
  let dataPaths = ['data/shards/manifest.json'];
  if (manifestBuf.__error) {
    failRow('data/shards/manifest.json', manifestBuf.__error);
  } else {
    manifestRaw = manifestBuf;
    try {
      manifest = JSON.parse(manifestBuf.toString('utf8'));
      const shardNames = Array.isArray(manifest.shards) ? manifest.shards : [];
      for (const s of shardNames) dataPaths.push(`data/shards/${s}`);
    } catch (e) {
      failRow('data/shards/manifest.json', `invalid JSON: ${e.message}`);
    }
  }

  // gzip each critical file, tracking per-file max + total
  let criticalGzipTotal = 0;
  let htmlGzip = 0, cssGzip = 0;
  const fileTable = [];
  for (const p of criticalPaths) {
    const full = path.join(ROOT, p);
    const buf = await readFileSafe(full);
    if (buf.__error) { failRow(p, buf.__error); continue; }
    const gz = gzipSync(buf, { level: 9 }).length;
    criticalGzipTotal += gz;
    if (p === 'index.html') htmlGzip = gz;
    if (p === 'src/styles.css') cssGzip = gz;
    fileTable.push({ p, gz });
  }

  let dataGzipTotal = 0;
  for (const p of dataPaths) {
    const full = path.join(ROOT, p);
    const buf = await readFileSafe(full);
    if (buf.__error) { failRow(p, buf.__error); continue; }
    const gz = gzipSync(buf, { level: 9 }).length;
    dataGzipTotal += gz;
    fileTable.push({ p, gz });
  }

  // per-file max
  for (const { p, gz } of fileTable) {
    const pass = gz <= budgets.bytes.singleFileGzipMax;
    rows.push({ name: `singleFileGzipMax: ${p}`, goal: budgets.bytes.singleFileGzipMax, measured: gz, pass });
    if (!pass) anyFail = true;
  }

  rows.push({ name: 'criticalGzipMax (total)', goal: budgets.bytes.criticalGzipMax, measured: criticalGzipTotal, pass: criticalGzipTotal <= budgets.bytes.criticalGzipMax });
  rows.push({ name: 'dataGzipMax (total)', goal: budgets.bytes.dataGzipMax, measured: dataGzipTotal, pass: dataGzipTotal <= budgets.bytes.dataGzipMax });

  // globe path: lazy-loaded, never critical, but still budgeted so it can't balloon unnoticed.
  // Missing files must FAIL with a clear message, not crash this script.
  let globeLocalTotal = 0;
  let globeLocalOk = true;
  for (const p of GLOBE_LOCAL_FILES) {
    const full = path.join(ROOT, p);
    const buf = await readFileSafe(full);
    if (buf.__error) { globeLocalOk = false; rows.push({ name: `globeLocal file: ${p}`, goal: 'present', measured: 'MISSING', pass: false, note: buf.__error }); continue; }
    const gz = gzipSync(buf, { level: 9 }).length;
    globeLocalTotal += gz;
  }
  rows.push({ name: 'globeLocalGzipMax (total)', goal: budgets.bytes.globeLocalGzipMax, measured: globeLocalOk ? globeLocalTotal : 'MISSING/ERROR', pass: globeLocalOk && globeLocalTotal <= budgets.bytes.globeLocalGzipMax });
  if (!globeLocalOk || globeLocalTotal > budgets.bytes.globeLocalGzipMax) anyFail = true;

  // earth-day.jpg: raw byte budget (it's served as-is, not gzipped - JPEGs don't compress further).
  const textureBuf = await readFileSafe(path.join(ROOT, GLOBE_TEXTURE_FILE));
  if (textureBuf.__error) {
    rows.push({ name: `globeTextureMaxBytes: ${GLOBE_TEXTURE_FILE}`, goal: budgets.bytes.globeTextureMaxBytes, measured: 'MISSING', pass: false, note: textureBuf.__error });
    anyFail = true;
  } else {
    const textureBytes = textureBuf.length;
    const pass = textureBytes <= budgets.bytes.globeTextureMaxBytes;
    rows.push({ name: `globeTextureMaxBytes: ${GLOBE_TEXTURE_FILE}`, goal: budgets.bytes.globeTextureMaxBytes, measured: textureBytes, pass });
    if (!pass) anyFail = true;
  }

  // Lazy extra set (CountryPanel/RefImage/refimage.css): informational only, never fails the build.
  let lazyExtraTotal = 0;
  const lazyExtraPresent = [];
  for (const p of LAZY_EXTRA_FILES) {
    const buf = await readFileSafe(path.join(ROOT, p));
    if (buf.__error) continue; // built separately by other tasks; absence is expected during incremental builds
    const gz = gzipSync(buf, { level: 9 }).length;
    lazyExtraTotal += gz;
    lazyExtraPresent.push(p);
  }
  rows.push({ name: 'lazy set (informational): CountryPanel/RefImage/refimage.css/SearchPanel/search.css', goal: '-', measured: `${lazyExtraTotal}B gzip (${lazyExtraPresent.length}/${LAZY_EXTRA_FILES.length} present)`, pass: true });

  // Layers lazy bundle: registry.js + one module per layer (src/layers/*.js, DATA's own files) plus
  // this shell's LayerManager/LayersPanel/LayerItemCard/layers.css. Missing files FAIL with a clear
  // message rather than throwing, same convention as globeLocalGzipMax above (concurrent builds may
  // not have every file yet).
  let layersDataFiles = [];
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(path.join(ROOT, 'src', 'layers'));
    layersDataFiles = entries.filter((f) => f.endsWith('.js')).map((f) => `src/layers/${f}`).sort();
  } catch { layersDataFiles = []; }
  let layersLazyTotal = 0;
  let layersLazyOk = layersDataFiles.length > 0;
  if (!layersLazyOk) rows.push({ name: 'layersLazy: src/layers/*.js', goal: 'present', measured: 'MISSING', pass: false, note: 'src/layers/ directory not found or empty' });
  for (const p of [...layersDataFiles, ...LAYERS_UI_FILES]) {
    const full = path.join(ROOT, p);
    const buf = await readFileSafe(full);
    if (buf.__error) { layersLazyOk = false; rows.push({ name: `layersLazy file: ${p}`, goal: 'present', measured: 'MISSING', pass: false, note: buf.__error }); continue; }
    const gz = gzipSync(buf, { level: 9 }).length;
    layersLazyTotal += gz;
  }
  rows.push({ name: 'layersLazyGzipMax (total)', goal: budgets.layers.layersLazyGzipMax, measured: layersLazyOk ? layersLazyTotal : 'MISSING/ERROR', pass: layersLazyOk && layersLazyTotal <= budgets.layers.layersLazyGzipMax });
  if (!layersLazyOk || layersLazyTotal > budgets.layers.layersLazyGzipMax) anyFail = true;

  // modulepreload check in index.html
  const indexBuf = await readFileSafe(path.join(ROOT, 'index.html'));
  if (indexBuf.__error) {
    failRow('index.html modulepreload check', indexBuf.__error);
  } else {
    const html = indexBuf.toString('utf8');
    const preloaded = [...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/g)].map((m) => m[1].replace(/^\.?\//, ''));
    const requiredModules = ['src/main.js', ...coreFiles, ...CRITICAL_UI];
    const missing = requiredModules.filter((m) => !preloaded.some((p) => p.endsWith(m) || p === m));
    const pass = missing.length === 0;
    rows.push({ name: 'modulepreload coverage', goal: 'all critical modules', measured: pass ? 'all present' : `missing: ${missing.join(', ')}`, pass });
    if (!pass) anyFail = true;

    // external fetch/import scan: only GlobeStage.js may load the pinned CDN before list visible.
    // Outbound <a href> links (PubMed/DOI/archive/PMC) are user navigation, not startup fetches, so they are excluded.
    const scanFiles = [...criticalPaths, 'index.html'];
    for (const p of scanFiles) {
      if (p.endsWith('GlobeStage.js')) continue;
      const full = path.join(ROOT, p);
      const buf = await readFileSafe(full);
      if (buf.__error) continue;
      const text = buf.toString('utf8');
      const fetchOrImportCalls = text.match(/(?:fetch|import)\s*\(\s*[`'"]https?:\/\/[^`'")]+/g) || [];
      const bad = fetchOrImportCalls.filter((u) => !u.includes('web.archive.org') && !u.includes('pubmed.ncbi.nlm.nih.gov'));
      if (bad.length) { rows.push({ name: `no external fetch before list visible: ${p}`, goal: 0, measured: bad.join(', '), pass: false }); anyFail = true; }
    }
  }

  // waterfall estimate
  const net = budgets.network;
  const transferMs = (bytes) => (bytes * 8) / net.downKbps;
  const firstPaintMs = (net.connectionSetupRtts + 1) * net.rttMs + transferMs(htmlGzip + cssGzip);
  const ROUNDS = 3; // round1 html, round2 css+modulepreloads+manifest, round3 shards (manifest dependency)
  const listVisibleMs = net.connectionSetupRtts * net.rttMs + ROUNDS * net.rttMs + transferMs(criticalGzipTotal + dataGzipTotal);

  rows.push({ name: 'estimatedFirstPaintMsMax', goal: net.estimatedFirstPaintMsMax, measured: Math.round(firstPaintMs), pass: firstPaintMs <= net.estimatedFirstPaintMsMax });
  rows.push({ name: 'estimatedListVisibleMsMax', goal: net.estimatedListVisibleMsMax, measured: Math.round(listVisibleMs), pass: listVisibleMs <= net.estimatedListVisibleMsMax });
  if (firstPaintMs > net.estimatedFirstPaintMsMax || listVisibleMs > net.estimatedListVisibleMsMax) anyFail = true;

  // print table
  const header = ['name', 'goal', 'measured', 'result'];
  console.log(header.join(' | '));
  for (const r of rows) {
    console.log(`${r.name} | ${r.goal} | ${r.measured} | ${r.pass ? 'PASS' : 'FAIL'}${r.note ? ` (${r.note})` : ''}`);
  }

  process.exitCode = anyFail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
