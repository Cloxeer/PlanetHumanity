/** THIS FILE DOES: Validates data shards against entity.v1.schema.json and repo-wide file headers with zero deps, ROLE: Automation, MAINTAINER NOTE: Schema is the source of truth - this validator reads it at runtime instead of hardcoding rules. **/

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SHARDS_DIR = path.join(ROOT, 'data', 'shards');
const SCHEMA_PATH = path.join(ROOT, 'data', 'schema', 'entity.v1.schema.json');
const BUDGETS_PATH = path.join(ROOT, 'tests', 'budgets.json');

const args = new Set(process.argv.slice(2));
const headersOnly = args.has('--headers-only');
const dataOnly = args.has('--data-only');

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------- generic JSON-Schema-subset validator ----------
function resolveRef(ref, root) {
  // Only supports '#/$defs/name'
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref: ${ref}`);
  const def = root.$defs?.[m[1]];
  if (!def) throw new Error(`$ref not found: ${ref}`);
  return def;
}

function validateAgainst(schema, value, root, pathStr, errors) {
  if (schema.$ref) {
    validateAgainst(resolveRef(schema.$ref, root), value, root, pathStr, errors);
    return;
  }
  if ('const' in schema) {
    if (value !== schema.const) errors.push(`${pathStr}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return;
  }
  if (schema.enum) {
    if (!schema.enum.includes(value)) errors.push(`${pathStr}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    return;
  }
  if (schema.type) {
    const t = schema.type;
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const okType = t === 'integer' ? (Number.isInteger(value)) : t === actual || (t === 'number' && actual === 'number');
    if (!okType) { errors.push(`${pathStr}: expected type ${t}, got ${actual}`); return; }
  }
  if (typeof value === 'string') {
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${pathStr}: does not match pattern ${schema.pattern}: "${value}"`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${pathStr}: length ${value.length} < minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${pathStr}: length ${value.length} > maxLength ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${pathStr}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${pathStr}: ${value} > maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pathStr}: length ${value.length} < minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${pathStr}: length ${value.length} > maxItems ${schema.maxItems}`);
    if (schema.items) value.forEach((v, i) => validateAgainst(schema.items, v, root, `${pathStr}[${i}]`, errors));
  }
  if (schema.type === 'object' || (value && typeof value === 'object' && !Array.isArray(value) && schema.properties)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return; // type mismatch already reported
    const props = schema.properties || {};
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${pathStr}: missing required property "${req}"`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${pathStr}: additional property "${key}" not allowed`);
      }
    }
    for (const [key, subschema] of Object.entries(props)) {
      if (key in value) validateAgainst(subschema, value[key], root, `${pathStr}.${key}`, errors);
    }
  }
}

function validateEntity(entity, root, idxPath) {
  const errors = [];
  validateAgainst(root.$defs.entity, entity, root, idxPath, errors);
  return errors;
}

// ---------- header check ----------
// Same header core for every file type; only the comment wrapper differs.
const CORE = String.raw`\/\*\* THIS FILE DOES: .+, ROLE: (UI|Engine|Data|Automation), MAINTAINER NOTE: .+ \*\*\/`;
const HEADER_RULES = [
  { ext: ['.js', '.mjs', '.css'], re: new RegExp(`^${CORE}$`) },
  { ext: ['.html'], re: new RegExp(`^<!doctype html><!-- ${CORE} -->`, 'i') },
  { ext: ['.yml', '.yaml'], re: new RegExp(`^# ${CORE}$`) },
  { ext: ['.md'], re: new RegExp(`^<!-- ${CORE} -->$`) },
  { ext: ['.json', '.geojson'], re: new RegExp(`^\\{ "\\$comment": "${CORE}",$`) },
];

const HEADER_CHECK_ROOTS = ['.github', 'docs', 'data', 'src', 'scripts', 'tests'];
const HEADER_CHECK_FILES = ['index.html', 'README.md'];
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.pdf', '.zip']);

async function walk(dir, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    // Vendored third-party files (assets/flags/*) keep their pristine upstream bytes and are
    // never expected to carry the repo's file-header comment. tests/fixtures/* are recorded
    // real API responses (some JSON-array-rooted, e.g. World Bank) kept byte-faithful to the
    // live schema so layers.test.mjs exercises normalize() against the real shape, not a
    // modified one with a header key spliced in.
    if (e.name === '.git' || e.name === 'assets' || e.name === 'fixtures') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
}

async function checkHeaders() {
  const files = [];
  for (const root of HEADER_CHECK_ROOTS) await walk(path.join(ROOT, root), files);
  for (const f of HEADER_CHECK_FILES) {
    const full = path.join(ROOT, f);
    try { await stat(full); files.push(full); } catch { /* not present yet */ }
  }
  for (const full of files) {
    const ext = path.extname(full).toLowerCase();
    if (BINARY_EXT.has(ext)) continue;
    const rule = HEADER_RULES.find((r) => r.ext.includes(ext));
    if (!rule) continue; // unlisted extension: no header rule applies
    let content;
    try { content = await readFile(full, 'utf8'); } catch (e) { fail(`${rel(full)}: unreadable: ${e.message}`); continue; }
    const firstLine = content.split(/\r?\n/, 1)[0];
    if (!rule.re.test(firstLine)) fail(`${rel(full)}: missing/invalid header on first line`);
  }
}

function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }

// ---------- https-only string scan ----------
function collectStrings(value, out) {
  if (typeof value === 'string') { out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out); return; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) collectStrings(v, out); }
}

function checkHttpsOnly(obj, label) {
  const strs = [];
  collectStrings(obj, strs);
  for (const s of strs) {
    if (/^http:\/\//i.test(s)) fail(`${label}: insecure http:// URL found: ${s}`);
  }
}

// ---------- data checks ----------
async function checkData() {
  let schema;
  try {
    schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
  } catch (e) {
    fail(`cannot read/parse schema at ${rel(SCHEMA_PATH)}: ${e.message}`);
    return;
  }
  let budgets;
  try { budgets = JSON.parse(await readFile(BUDGETS_PATH, 'utf8')); } catch (e) {
    fail(`cannot read/parse budgets at ${rel(BUDGETS_PATH)}: ${e.message}`);
    budgets = { data: { minEntitiesPerShard: 1 } };
  }
  const minEntities = budgets.data?.minEntitiesPerShard ?? 1;

  let manifest;
  const manifestPath = path.join(SHARDS_DIR, 'manifest.json');
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (e) {
    fail(`manifest missing/unreadable at ${rel(manifestPath)}: ${e.message}`);
    return;
  }
  const listedShards = Array.isArray(manifest.shards) ? manifest.shards : [];
  if (!Array.isArray(manifest.shards)) fail('manifest.json: "shards" must be an array');

  let diskFiles = [];
  try {
    const entries = [];
    await walk(SHARDS_DIR, entries);
    diskFiles = entries.filter((f) => f.endsWith('.json') && path.basename(f) !== 'manifest.json').map((f) => path.relative(SHARDS_DIR, f).split(path.sep).join('/'));
  } catch { /* dir absent */ }

  for (const shardName of listedShards) {
    if (!diskFiles.includes(shardName)) fail(`manifest lists shard not found on disk: ${shardName}`);
  }
  for (const diskName of diskFiles) {
    if (!listedShards.includes(diskName)) fail(`shard on disk not listed in manifest: ${diskName}`);
  }

  checkHttpsOnly(manifest, 'manifest.json');

  const allPmids = new Map(); // pmid -> shard
  for (const shardName of listedShards) {
    const shardPath = path.join(SHARDS_DIR, shardName);
    let shard;
    try {
      shard = JSON.parse(await readFile(shardPath, 'utf8'));
    } catch (e) {
      fail(`shard ${shardName}: missing/unreadable/invalid JSON: ${e.message}`);
      continue;
    }
    const shardErrors = [];
    validateAgainst({ type: 'object', additionalProperties: false, required: ['$comment', 'schemaVersion', 'year', 'entities'], properties: { $comment: schema.properties.$comment, schemaVersion: schema.properties.schemaVersion, year: schema.properties.year, entities: schema.properties.entities } }, shard, schema, shardName, shardErrors);
    shardErrors.forEach(fail);

    checkHttpsOnly(shard, shardName);

    const entities = Array.isArray(shard.entities) ? shard.entities : [];
    if (entities.length < minEntities) fail(`shard ${shardName}: has ${entities.length} entities, minimum is ${minEntities}`);

    let prevDate = null;
    entities.forEach((e, i) => {
      const entPath = `${shardName}.entities[${i}]`;
      validateEntity(e, schema, entPath).forEach(fail);
      if (!e || typeof e !== 'object') return;

      // derived-field rules
      if (e.ids?.pmid && e.id !== `pmid-${e.ids.pmid}`) fail(`${entPath}: id "${e.id}" must equal "pmid-${e.ids.pmid}"`);
      if (typeof e.date === 'string') {
        const y = Number(e.date.slice(0, 4));
        if (shard.year !== undefined && y !== shard.year) fail(`${entPath}: date year ${y} !== shard year ${shard.year}`);
        if (prevDate !== null && e.date < prevDate) fail(`${entPath}: entities not sorted by date ascending within shard`);
        prevDate = e.date;
      }
      if (e.ids?.pmid) {
        const expectedPubmed = `https://pubmed.ncbi.nlm.nih.gov/${e.ids.pmid}/`;
        if (e.sources?.pubmed !== expectedPubmed) fail(`${entPath}: sources.pubmed must equal ${expectedPubmed}`);
        const expectedArchive = `https://web.archive.org/web/2/${expectedPubmed}`;
        if (e.sources?.archive !== expectedArchive) fail(`${entPath}: sources.archive must equal ${expectedArchive}`);
        if (allPmids.has(e.ids.pmid)) fail(`${entPath}: duplicate PMID ${e.ids.pmid} (also in ${allPmids.get(e.ids.pmid)})`);
        else allPmids.set(e.ids.pmid, shardName);
      }
    });
  }
}

async function main() {
  if (!dataOnly) await checkHeaders();
  if (!headersOnly) await checkData();

  if (failures.length) {
    console.error(`FAIL: ${failures.length} issue(s)\n`);
    for (const f of failures) console.error(` - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('OK: validate-shards passed');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
