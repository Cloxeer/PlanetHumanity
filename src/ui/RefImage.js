/** THIS FILE DOES: Lazy Wikipedia reference-photo frame for a paper's institution, ROLE: UI, MAINTAINER NOTE: Never throws and never console.error's - a failed lookup silently collapses the frame; nothing is persisted, only an in-memory Map cache for the session. **/

const CSS_HREF = 'src/ui/refimage.css';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const SLOW_TYPES = new Set(['slow-2g', '2g', '3g']);

// Session-only cache keyed by entity id: never written to storage, cleared on reload.
const cache = new Map();

let cssPromise;
function loadStylesheet() {
  return cssPromise ??= new Promise((resolve) => {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.append(link);
  });
}

function isSlowConnection() {
  const c = navigator.connection;
  if (!c) return false;
  return !!c.saveData || SLOW_TYPES.has(c.effectiveType);
}

async function queryWikipedia(term, signal) {
  const url = `${WIKI_API}?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=1&prop=pageimages|info&piprop=thumbnail&pithumbsize=480&inprop=url`;
  const res = await fetch(url, { signal, referrerPolicy: 'no-referrer' });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page?.thumbnail?.source) return null;
  return { title: page.title, thumb: page.thumbnail.source, pageUrl: page.fullurl };
}

// Wikipedia search happily returns a PERSON for "Desmond Tutu HIV Centre". Only accept pages whose
// title is itself an institution and shares a real word with the query; a city hit must be the city.
const INSTITUTION_WORD = /\b(universit\w*|institut\w*|hospital|cent(re|er)|college|school|clinic|foundation|laborator\w*|academy|medical|health|research|polyclinic|charité|karolinska)\b/i;
const STOP = new Set(['of', 'the', 'and', 'for', 'de', 'di', 'la', 'le', 'du', 'des', 'university', 'universidad', 'universidade', 'universite', 'institute', 'instituto', 'hospital', 'centre', 'center', 'medical', 'medicine', 'school', 'college', 'department', 'research', 'faculty', 'graduate', 'sciences', 'science', 'health', 'clinical', 'national', 'general', 'affiliated', 'first', 'foundation', 'unit', 'program', 'programme']);
const words = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

// A title is relevant when ≥60% of its distinctive words (minus the city, e.g. "London") appear in the query.
// Audited live: rejects "King's College London" for a UCL query and "University of Toronto…" for Osaka.
export function relevant(hit, term, isCity, city = '') {
  if (isCity) return words(hit.title)[0] === words(term)[0];
  if (!INSTITUTION_WORD.test(hit.title)) return false;
  const place = new Set(words(city));
  const q = new Set(words(term));
  const all = words(hit.title);
  const rest = all.filter((w) => !place.has(w));
  const t = rest.length ? rest : all; // "University of Oxford": the city IS the distinctive word

  return t.length > 0 && t.filter((w) => q.has(w)).length / t.length >= 0.6;
}

export async function resolveImage(institution, signal) { // exported for the live lookup audit
  if (!institution?.name) return null;
  // Full name first, then every comma segment that names an institution (skips "Department of…").
  const parts = institution.name.split(',').map((s) => s.trim()).filter((s) => INSTITUTION_WORD.test(s) && !/^(department|division|program|unit)\b/i.test(s));
  const segments = [
    { term: institution.name, caption: null },
    ...parts.map((term) => ({ term, caption: null })),
    { term: institution.city, caption: 'City photo', isCity: true },
  ];
  for (const seg of segments) {
    if (!seg.term) continue;
    // Fail-soft: one segment erroring (network, abort) tries the next; only an explicit abort stops the chain.
    try {
      const hit = await queryWikipedia(seg.term, signal);
      if (hit && relevant(hit, seg.term, seg.isCity, institution.city)) return { ...hit, caption: seg.caption };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // swallow and try the next fallback segment
    }
  }
  return null;
}

export function mountRefImage(container, entity) {
  loadStylesheet();

  const frame = document.createElement('div');
  frame.className = 'ph-refimage';

  const shimmer = document.createElement('div');
  shimmer.className = 'ph-refimage-shimmer';
  frame.append(shimmer);

  let img = null;
  let caption = null;
  let controller = null;
  let destroyed = false;

  function collapse() {
    frame.classList.add('ph-refimage-empty');
    frame.replaceChildren();
  }

  function showButton() {
    frame.classList.add('ph-refimage-gate');
    frame.replaceChildren();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ph-refimage-load';
    btn.textContent = 'Load reference photo';
    btn.addEventListener('click', () => {
      frame.classList.remove('ph-refimage-gate');
      frame.replaceChildren(shimmer);
      run();
    }, { once: true });
    frame.append(btn);
  }

  function render(hit) {
    if (destroyed) return;
    frame.replaceChildren();
    img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    const instLabel = entity.institution?.name ? `${entity.institution.name}, ${entity.institution.city ?? ''}`.trim() : 'the institution';
    img.alt = `Photo related to ${instLabel}`;
    img.addEventListener('error', collapse, { once: true });
    img.src = hit.thumb;
    frame.append(img);

    caption = document.createElement('p');
    caption.className = 'ph-refimage-caption';
    const link = document.createElement('a');
    link.href = hit.pageUrl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    link.textContent = `Photo: Wikipedia — ${hit.title}`;
    caption.append(link);

    if (entity.ids?.pmcid) {
      caption.append(document.createTextNode(' · '));
      const pmcLink = document.createElement('a');
      pmcLink.href = `https://pmc.ncbi.nlm.nih.gov/articles/${entity.ids.pmcid}/`;
      pmcLink.target = '_blank';
      pmcLink.rel = 'noopener noreferrer';
      pmcLink.textContent = "See the paper's figures (PMC)";
      caption.append(pmcLink);
    }
    frame.append(caption);
  }

  function renderPmcOnly() {
    if (destroyed) return;
    frame.replaceChildren();
    if (!entity.ids?.pmcid) { collapse(); return; }
    frame.classList.add('ph-refimage-fallback');
    const pmcLink = document.createElement('a');
    pmcLink.href = `https://pmc.ncbi.nlm.nih.gov/articles/${entity.ids.pmcid}/`;
    pmcLink.target = '_blank';
    pmcLink.rel = 'noopener noreferrer';
    pmcLink.textContent = "See the paper's figures (PMC)";
    frame.append(pmcLink);
  }

  async function run() {
    const key = entity.id;
    if (key && cache.has(key)) {
      const hit = cache.get(key);
      hit ? render(hit) : renderPmcOnly();
      return;
    }
    controller = new AbortController();
    try {
      const hit = await resolveImage(entity.institution, controller.signal);
      if (destroyed) return;
      if (key) cache.set(key, hit);
      hit ? render(hit) : renderPmcOnly();
    } catch (err) {
      if (err?.name === 'AbortError' || destroyed) return;
      // Never throw out of a lazy decorative module; warn at most.
      console.warn('[RefImage] lookup failed', err);
      renderPmcOnly();
    }
  }

  container.append(frame);

  if (isSlowConnection()) {
    showButton();
  } else {
    run();
  }

  function destroy() {
    destroyed = true;
    controller?.abort();
    frame.remove();
  }

  return { destroy };
}
