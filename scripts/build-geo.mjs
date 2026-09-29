/** THIS FILE DOES: Fetches world-atlas countries-110m TopoJSON + i18n-iso-countries codes and writes a small committed country GeoJSON (with iso2/label/area metadata) for GlobeStage, ROLE: Data, MAINTAINER NOTE: Hand-rolled TopoJSON decoder (no npm dep, mirrors the retired build-land.mjs); re-run after bumping the pinned world-atlas/i18n-iso-countries versions. **/
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'geo', 'countries-110m.geojson');
const TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const CODES_URL = 'https://cdn.jsdelivr.net/npm/i18n-iso-countries@7/codes.json';
const ROUND = 2; // output coordinate decimal places; keeps the file small
const AREA_ROUND = 5;
const D2R = Math.PI / 180;

function round(n, places = ROUND) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// ---------- TopoJSON decode (same scheme as the retired build-land.mjs) ----------
function decodeArc(arc, transform) {
  let x = 0;
  let y = 0;
  const [sx, sy] = transform.scale;
  const [tx, ty] = transform.translate;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty]; // full precision here; rounded only at output time
  });
}

function ringFromArcIndices(indices, decodedArcs) {
  const ring = [];
  for (const i of indices) {
    const idx = i < 0 ? ~i : i;
    let pts = decodedArcs[idx];
    if (i < 0) pts = pts.slice().reverse();
    ring.push(...(ring.length ? pts.slice(1) : pts));
  }
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

function topoPolygonToCoords(polygonArcs, decodedArcs) {
  return polygonArcs.map((ringIndices) => ringFromArcIndices(ringIndices, decodedArcs));
}

function decodeGeometry(geom, decodedArcs) {
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: topoPolygonToCoords(geom.arcs, decodedArcs) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.arcs.map((poly) => topoPolygonToCoords(poly, decodedArcs)) };
  throw new Error(`unsupported geometry type: ${geom.type}`);
}

// ---------- geometry math ----------
// Unwrap a ring's longitudes around its own first vertex so antimeridian-crossing
// rings (Russia, Fiji) don't self-intersect under a naive planar shoelace formula.
function unwrapRing(ring) {
  const out = [ring[0].slice()];
  let prevLon = ring[0][0];
  for (let i = 1; i < ring.length; i++) {
    let [lon, lat] = ring[i];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    out.push([lon, lat]);
    prevLon = lon;
  }
  return out;
}

// Chamberlain-Duquette-style spherical excess area (steradians, unit sphere), a
// deterministic approximation good enough to rank/report country size; exact
// geodesic area is not required here (see MAINTAINER NOTE).
function sphericalArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    sum += (lon2 - lon1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R));
  }
  return Math.abs(sum) / 2;
}

// Planar area-weighted centroid (shoelace) on the unwrapped ring, treating lon/lat
// as a flat x/y plane (area-weighted centroid; good enough to place a label).
function planarCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    // degenerate (near-zero-area) ring: fall back to a plain vertex average
    let sx = 0, sy = 0;
    for (let i = 0; i < ring.length - 1; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    const n = ring.length - 1;
    return [sx / n, sy / n];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

// Douglas-Peucker simplification on a closed ring (planar, lon/lat degrees). The
// 110m source already targets low resolution, but even so a 2-decimal (~1.1km)
// round leaves thousands of near-collinear points; a small tolerance trims those
// without visibly changing coastlines at globe scale, keeping the file under budget.
function perpDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / len2;
  const px = x1 + t * dx, py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points.slice();
  let maxDist = -1, idx = -1;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, idx + 1), epsilon);
    const right = douglasPeucker(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function simplifyRing(ring, epsilon) {
  if (ring.length <= 5) return ring;
  // Split the closed ring at its farthest-pair-ish start; simpler: simplify the
  // open path from vertex 0 back to vertex 0 by treating it as two halves so the
  // anchor point (index 0) is never dropped, preserving closure.
  const mid = Math.floor(ring.length / 2);
  const first = douglasPeucker(ring.slice(0, mid + 1), epsilon);
  const second = douglasPeucker(ring.slice(mid), epsilon);
  const simplified = first.slice(0, -1).concat(second);
  if (simplified.length < 4) return ring; // degenerate: keep original
  return simplified;
}

function allRings(geometry) {
  return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
}

function normalizeLng(lng) {
  let l = lng;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}

// ---------- validation ----------
function validateRing(ring, ctx) {
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) throw new Error(`${ctx}: ring not closed`);
  for (const [lon, lat] of ring) {
    if (lon < -180 || lon > 180) throw new Error(`${ctx}: lon out of range: ${lon}`);
    if (lat < -90 || lat > 90) throw new Error(`${ctx}: lat out of range: ${lat}`);
  }
}

function validateFeatureCollection(fc) {
  if (fc.features.length < 170) throw new Error(`expected >= 170 features, got ${fc.features.length}`);
  const withIso2 = fc.features.filter((f) => f.properties.iso2).length;
  if (withIso2 < 165) throw new Error(`expected iso2 set for >= 165 features, got ${withIso2}`);
  for (const [fi, feature] of fc.features.entries()) {
    const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    polys.forEach((poly, pi) => poly.forEach((ring, ri) => validateRing(ring, `feature[${fi}].polygon[${pi}].ring[${ri}]`)));
  }
  return withIso2;
}

async function main() {
  const [topoRes, codesRes] = await Promise.all([fetch(TOPO_URL), fetch(CODES_URL)]);
  if (!topoRes.ok) throw new Error(`countries topojson fetch failed: ${topoRes.status} ${topoRes.statusText}`);
  if (!codesRes.ok) throw new Error(`iso codes fetch failed: ${codesRes.status} ${codesRes.statusText}`);
  const topo = await topoRes.json();
  const codes = await codesRes.json(); // rows [alpha2, alpha3, numeric]

  const numericToAlpha2 = new Map();
  for (const row of codes) {
    const [alpha2, , numeric] = row;
    if (alpha2 && numeric !== undefined && numeric !== null) numericToAlpha2.set(Number(numeric), alpha2);
  }

  const decodedArcs = topo.arcs.map((arc) => decodeArc(arc, topo.transform));
  const countries = topo.objects.countries;

  const features = countries.geometries.map((geom) => {
    const geometry = decodeGeometry(geom, decodedArcs);
    const rings = allRings(geometry).map(unwrapRing);
    let best = null;
    let bestArea = -1;
    for (const ring of rings) {
      const area = sphericalArea(ring);
      if (area > bestArea) { bestArea = area; best = ring; }
    }
    const [cLon, cLat] = planarCentroid(best);
    const numericId = Number(geom.id);
    const iso2 = numericToAlpha2.get(numericId) ?? null;

    // Round output coordinates last, after all area/centroid math ran at full precision.
    // Collapse consecutive points that round to the same [lon,lat]: at 110m source
    // resolution + 2-decimal rounding (~1.1km) many arc points coincide, and the
    // duplicates cost gzip bytes without changing the polygon shape.
    const SIMPLIFY_EPSILON_DEG = 0.05; // 0.035 -> 0.05: ~2 KB smaller, still sub-pixel at globe zoom (110m source)
    const roundRing = (ring) => {
      const out = [];
      for (const [lon, lat] of simplifyRing(ring, SIMPLIFY_EPSILON_DEG)) {
        const p = [round(normalizeLng(lon)), round(lat)];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
      if (out.length < 4) return ring.map(([lon, lat]) => [round(normalizeLng(lon)), round(lat)]); // degenerate: keep original density
      const [fx, fy] = out[0];
      const last = out[out.length - 1];
      if (last[0] !== fx || last[1] !== fy) out.push([fx, fy]); // re-close: dedupe may have dropped the closing vertex
      return out;
    };
    const roundedGeometry = geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: geometry.coordinates.map(roundRing) }
      : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(roundRing)) };

    return {
      type: 'Feature',
      properties: {
        name: geom.properties?.name ?? null,
        iso2,
        labelLat: round(cLat),
        labelLng: round(normalizeLng(cLon)),
        area: round(bestArea, AREA_ROUND),
      },
      geometry: roundedGeometry,
    };
  });

  const fc = { type: 'FeatureCollection', features };
  const withIso2 = validateFeatureCollection(fc);

  const header = '{ "$comment": "/** THIS FILE DOES: Country polygons + label centroids for the globe view, decoded from world-atlas countries-110m TopoJSON and joined to iso2 via i18n-iso-countries codes, ROLE: Data, MAINTAINER NOTE: Generated by scripts/build-geo.mjs - do not hand-edit; re-run the script to regenerate. **/",\n';
  const out = header + `  "type": "FeatureCollection",\n  "features": ${JSON.stringify(fc.features)}\n}\n`;

  await writeFile(OUT_PATH, out, 'utf8');

  const gz = gzipSync(Buffer.from(out, 'utf8'), { level: 9 }).length;
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}: ${out.length} bytes raw, ${gz} bytes gzip, ${fc.features.length} features, iso2 on ${withIso2}`);
  if (gz > 55_000) {
    console.error(`FAIL: gzip size ${gz} exceeds 55 KB budget`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
