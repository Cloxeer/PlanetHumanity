/** THIS FILE DOES: Fetches NCBI esummary+efetch for given PMIDs and prints draft catalog entity JSON, ROLE: Automation, MAINTAINER NOTE: Output is a DRAFT - category, summary, institution.country/lat/lng are TODO stubs; hand-fill them, then run validate-shards.mjs before committing. **/

const MIN_GAP_MS = 350; // <=3 req/s to NCBI E-utilities
const NON_PRIMARY_TYPES = new Set([
  'Review', 'Erratum', 'Published Erratum', 'Comment', 'Retracted Publication',
  'Retraction of Publication', 'Editorial', 'Historical Article', 'Letter', 'News'
]);

let lastCall = 0;
async function throttledFetch(url, attempt = 0) {
  const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  let res, text;
  try {
    res = await fetch(url);
    text = await res.text();
  } catch (e) {
    throw new Error(`network failure fetching ${url}: ${e.message}`);
  }
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return throttledFetch(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 300)}`);
  return text;
}

async function esummary(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmid}`;
  const json = JSON.parse(await throttledFetch(url));
  if (!json.result || !json.result.uids || !json.result.uids.includes(String(pmid))) {
    throw new Error(`unknown PMID ${pmid} (no esummary result)`);
  }
  return json.result[pmid];
}

async function efetchXml(pmid) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${pmid}`;
  return throttledFetch(url);
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parsePublicationTypes(xml) {
  return (xml.match(/<PublicationType[^>]*>(.*?)<\/PublicationType>/g) || [])
    .map((s) => decodeEntities((s.match(/>(.*?)</) || [])[1] || ''));
}

// crude: returns [{ lastName, initials, affiliation }] for AuthorList of the first PubmedArticle
function parseAuthors(xml) {
  const authors = [];
  const authorBlocks = xml.match(/<Author[^>]*>[\s\S]*?<\/Author>/g) || [];
  for (const block of authorBlocks) {
    const lastName = (block.match(/<LastName>(.*?)<\/LastName>/) || [])[1] || '';
    const initials = (block.match(/<Initials>(.*?)<\/Initials>/) || [])[1] || '';
    const affMatch = block.match(/<Affiliation>(.*?)<\/Affiliation>/s);
    const affiliation = affMatch ? decodeEntities(affMatch[1]) : '';
    authors.push({ lastName, initials, affiliation });
  }
  return authors;
}

// best-effort: guess a city from a free-text affiliation string
function guessCity(affiliation) {
  if (!affiliation) return 'TODO';
  const parts = affiliation.split(',').map((s) => s.trim()).filter(Boolean);
  const filtered = parts.filter((p) => !/@/.test(p) && !/^\d+$/.test(p));
  const clean = (s) => s.replace(/\.+$/, '').trim();
  if (filtered.length < 2) return 'TODO'; // no comma to split institution from city; verify by hand
  if (filtered.length === 2) return clean(filtered[1]); // "Institution, City."
  return clean(filtered[filtered.length - 2]); // "Institution, ..., City, Country." heuristic
}

// NCBI date strings look like "2025 May 15", "2025 May", or "2025"
function toIsoDate(pubdateStr) {
  if (!pubdateStr) return null;
  const m = /^(\d{4})(?:\s+(\w+))?(?:\s+(\d{1,2}))?/.exec(pubdateStr.trim());
  if (!m) return null;
  const [, year, monStr, dayStr] = m;
  const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const month = monStr ? (MONTHS[monStr.slice(0, 3)] || '01') : '01';
  const day = dayStr ? dayStr.padStart(2, '0') : '01';
  return `${year}-${month}-${day}`;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function buildEntity(pmid) {
  const summary = await esummary(pmid);
  const xml = await efetchXml(pmid);

  const pubTypes = parsePublicationTypes(xml);
  const nonPrimary = pubTypes.filter((t) => NON_PRIMARY_TYPES.has(t));
  if (nonPrimary.length) {
    console.error(`WARNING: PMID ${pmid} has non-primary publication type(s) [${nonPrimary.join(', ')}] - skipping. Verify manually if this is wrong.`);
    return null;
  }

  const title = (summary.title || '').replace(/\.+\s*$/, '');
  const date = toIsoDate(summary.epubdate) || toIsoDate(summary.pubdate);
  if (!date) throw new Error(`PMID ${pmid}: could not derive a date from epubdate/pubdate`);

  const allAuthors = Array.isArray(summary.authors) ? summary.authors.map((a) => a.name).filter(Boolean) : [];
  const authors = allAuthors.slice(0, 6);
  const authorsTruncated = allAuthors.length > 6;

  const articleIds = Array.isArray(summary.articleids) ? summary.articleids : [];
  const doi = (articleIds.find((a) => a.idtype === 'doi') || {}).value;
  const pmcidRaw = (articleIds.find((a) => a.idtype === 'pmc') || {}).value;
  const pmcid = pmcidRaw ? (pmcidRaw.startsWith('PMC') ? pmcidRaw : `PMC${pmcidRaw}`) : undefined;

  const xmlAuthors = parseAuthors(xml);
  const firstAff = (xmlAuthors.find((a) => a.affiliation) || {}).affiliation || '';

  const ids = { pmid: String(pmid) };
  if (doi) ids.doi = doi;
  if (pmcid) ids.pmcid = pmcid;

  const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

  return {
    id: `pmid-${pmid}`,
    title,
    date,
    category: 'TODO',
    summary: 'TODO: original 1-2 sentence plain-language summary (never paste the abstract)',
    authors,
    authorsTruncated,
    journal: summary.fulljournalname || summary.source || 'TODO',
    ids,
    institution: {
      name: firstAff.split(',')[0].trim() || 'TODO',
      city: guessCity(firstAff),
      country: 'TODO',
      lat: null,
      lng: null
    },
    sources: {
      pubmed: pubmedUrl,
      archive: `https://web.archive.org/web/2/${pubmedUrl}`
    },
    verified: { method: 'ncbi-esummary', date: todayUtc() }
  };
}

async function main() {
  const pmids = process.argv.slice(2);
  if (!pmids.length) {
    console.error('usage: node scripts/fetch-pubmed.mjs <PMID> [<PMID>...]');
    process.exitCode = 1;
    return;
  }

  let ok = 0;
  for (const pmid of pmids) {
    if (!/^[1-9][0-9]{0,8}$/.test(pmid)) {
      console.error(`ERROR: "${pmid}" is not a valid PMID - skipping.`);
      continue;
    }
    try {
      const entity = await buildEntity(pmid);
      if (entity) {
        console.log(JSON.stringify(entity, null, 2));
        console.error(`PMID ${pmid}: TODO fields to fill by hand - category, summary, institution.city (verify guess), institution.country, institution.lat, institution.lng.`);
        ok++;
      }
    } catch (e) {
      console.error(`ERROR: PMID ${pmid}: ${e.message}`);
    }
  }
  console.error(`\n${ok}/${pmids.length} entities drafted. Paste into the shard for the entity's date year (keep entities sorted by date), then run: node scripts/validate-shards.mjs`);
}

main();
