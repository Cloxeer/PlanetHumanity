/** THIS FILE DOES: resolves a free-text country name to its geojson label point, ROLE: Data, MAINTAINER NOTE: normalize() takes the lookup as a parameter (built from countries-110m.geojson) so tests stay pure; load() alone touches the network. **/

// WHO/news prose uses formal or colloquial names that don't match the geojson's
// short display names or Intl.DisplayNames' English region names. Small, hand-picked.
const ALIASES = {
  'democratic republic of the congo': 'CD', 'dr congo': 'CD', 'drc': 'CD',
  'republic of the congo': 'CG', 'congo': 'CG', 'congo-brazzaville': 'CG',
  'united states of america': 'US', 'united states': 'US', 'usa': 'US', 'u.s.': 'US',
  'türkiye': 'TR', 'turkiye': 'TR', 'turkey': 'TR',
  'russian federation': 'RU', 'russia': 'RU',
  "côte d'ivoire": 'CI', 'ivory coast': 'CI',
  'republic of korea': 'KR', 'south korea': 'KR', 'korea, republic of': 'KR',
  "democratic people's republic of korea": 'KP', 'north korea': 'KP',
  "lao people's democratic republic": 'LA', 'laos': 'LA',
  'viet nam': 'VN', 'vietnam': 'VN',
  'czech republic': 'CZ', 'czechia': 'CZ',
  'the gambia': 'GM', 'gambia': 'GM',
  'eswatini': 'SZ', 'swaziland': 'SZ',
  'cabo verde': 'CV', 'cape verde': 'CV',
  'myanmar': 'MM', 'burma': 'MM',
  'bolivia (plurinational state of)': 'BO', 'bolivia': 'BO',
  'venezuela (bolivarian republic of)': 'VE', 'venezuela': 'VE',
  'iran (islamic republic of)': 'IR', 'iran': 'IR',
  'united republic of tanzania': 'TZ', 'tanzania': 'TZ',
  'republic of moldova': 'MD', 'moldova': 'MD',
  'brunei darussalam': 'BN', 'brunei': 'BN',
  'north macedonia': 'MK', 'macedonia': 'MK',
  'syrian arab republic': 'SY', 'syria': 'SY',
  'united kingdom of great britain and northern ireland': 'GB', 'united kingdom': 'GB', 'uk': 'GB',
};

const SKIP_RE = /\b(global|multi-?countr(y|ies)|multi-?locations?|worldwide)\b/i;

export function buildCountryIndex(geojson) {
  const byIso2 = new Map();
  for (const f of geojson.features || []) {
    const p = f.properties || {};
    if (p.iso2 && Number.isFinite(p.labelLat) && Number.isFinite(p.labelLng)) {
      byIso2.set(p.iso2, { lat: p.labelLat, lng: p.labelLng, name: p.name });
    }
  }
  return byIso2;
}

let dnCache = null;
function displayNameOf(iso2) {
  if (typeof Intl === 'undefined' || !Intl.DisplayNames) return null;
  dnCache ??= new Intl.DisplayNames(['en'], { type: 'region' });
  try { return dnCache.of(iso2); } catch { return null; }
}

// index: Map<iso2, {lat,lng,name}> from buildCountryIndex(). Pure.
export function resolveCountry(nameRaw, index) {
  if (!nameRaw || !index) return null;
  const key = nameRaw.trim().toLowerCase();
  if (!key) return null;
  if (ALIASES[key]) {
    const hit = index.get(ALIASES[key]);
    return hit ? { iso2: ALIASES[key], ...hit } : null;
  }
  for (const [iso2, v] of index) {
    if (v.name && v.name.toLowerCase() === key) return { iso2, ...v };
    const dn = displayNameOf(iso2);
    if (dn && dn.toLowerCase() === key) return { iso2, ...v };
  }
  return null;
}

// Extracts the trailing "- Country" (or en/em-dash) segment of a WHO DON title.
// Returns null for multi-country/global/unparseable titles (caller counts these as skipped).
export function extractOutbreakLocation(title) {
  if (typeof title !== 'string') return null;
  const m = title.match(/[-–—]\s*([^-–—]+)$/);
  if (!m) return null;
  let loc = m[1].trim().replace(/\s*(situation|update)$/i, '').trim();
  if (!loc || SKIP_RE.test(loc) || /[,&]|\band\b/i.test(loc)) return null;
  return loc;
}
