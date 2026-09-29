/** THIS FILE DOES: Spotlight-style search panel with fast AND-term matching, yellow <mark> highlights and grouped-by-category results, ROLE: UI, MAINTAINER NOTE: buildIndex/search/highlightRanges/buildHighlightFragment/groupResults are pure and imported directly by tests/search.test.mjs under plain Node -- keep DOM access inside createSearchPanel only. **/
import { CATEGORY_META } from './categories.js';

const SEARCH_CSS_HREF = 'src/ui/search.css';
const MAX_RESULTS = 50;
const PER_GROUP = 3;
const CATEGORY_ORDER = Object.keys(CATEGORY_META);

// Field importance weights added to a term's score when it hits that field; title is handled
// separately below (flat +10) because it's the one field always shown, so it should dominate.
const FIELD_WEIGHT = {
  summary: 4,
  pmid: 4,
  journal: 3,
  institution: 3,
  authors: 2,
  country: 2,
  category: 2,
  doi: 1,
  pmcid: 1,
};

// Fields checked for a result's snippet, in priority order (title is rendered separately, always).
const SNIPPET_PRIORITY = ['summary', 'institution', 'journal', 'authors', 'country', 'category', 'pmid', 'doi', 'pmcid'];

let regionNames;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { regionNames = null; }

// Diacritic fold: NFD decomposition turns one precomposed accented codepoint (e.g. the single
// codepoint "e" is preceded by a combining acute) into base+mark; stripping the combining marks
// removes exactly what decomposition added, so the folded string keeps the SAME length and index
// alignment as the original for ordinary Latin text. That's what lets highlightRanges compute match
// positions on the folded text and slice the un-folded display text at those same positions.
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function field(text) {
  const t = text == null ? '' : String(text);
  return { text: t, folded: fold(t) };
}

const TOKEN_SPLIT = /[^a-z0-9]+/;

// Builds a per-entity lowercase+folded field index PLUS a corpus-wide inverted index: token ->
// postings of [recordIndex, fieldName]. Search then never has to touch all N entities to answer a
// query -- it looks up the (few) matching tokens and walks only their postings. That's the difference
// between an O(entities) and an O(matches) query, which is what keeps 10k+ entities under the p95
// budget: a linear "check every entity's text" scan simply can't hit sub-5ms at that size in JS.
// Trade-off: a term only matches at a token boundary (whole word or word-prefix, e.g. "lena" finds
// "lenacapavir"), not in the middle of a word -- the same behavior Spotlight-style search-as-you-type
// tools use, and it's what every case in tests/search.test.mjs (whole words, diacritics, country
// names, exact PMIDs) actually needs.
export function buildIndex(entities) {
  const records = entities.map((entity) => {
    const inst = entity.institution || {};
    const countryCode = inst.country || '';
    let countryName = '';
    if (regionNames && countryCode) {
      try { countryName = regionNames.of(countryCode) || ''; } catch { countryName = ''; }
    }
    const cat = CATEGORY_META[entity.category];
    const ids = entity.ids || {};
    const fields = {
      title: field(entity.title),
      summary: field(entity.summary),
      authors: field((entity.authors || []).join(', ')),
      journal: field(entity.journal),
      institution: field(`${inst.name || ''} ${inst.city || ''}`.trim()),
      country: field(`${countryCode} ${countryName}`.trim()),
      category: field(`${entity.category || ''} ${cat ? cat.label : ''}`.trim()),
      pmid: field(ids.pmid),
      doi: field(ids.doi),
      pmcid: field(ids.pmcid),
    };
    return { entity, fields, time: Date.parse(entity.date) || 0 };
  });

  const tokenPostings = new Map(); // token -> [[recordIndex, fieldName], ...]
  records.forEach((rec, ri) => {
    for (const name in rec.fields) {
      const tokens = rec.fields[name].folded.split(TOKEN_SPLIT);
      let seen = null; // dedupe repeats of the same token within one field (e.g. author lists)
      for (const tok of tokens) {
        if (!tok) continue;
        if (seen == null) seen = new Set();
        else if (seen.has(tok)) continue;
        seen.add(tok);
        let postings = tokenPostings.get(tok);
        if (!postings) tokenPostings.set(tok, postings = []);
        postings.push([ri, name]);
      }
    }
  });
  const sortedTokens = Array.from(tokenPostings.keys()).sort();
  return { records, tokenPostings, sortedTokens };
}

// First index in a sorted array whose value is >= target (standard binary lower-bound).
function lowerBound(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// AND semantics: an entity matches only when every term matches some token (whole-word or
// word-prefix) in some field; fields can differ per term. For each term we walk just the sorted-token
// range that starts with it, summing -- per record -- the best score across whichever field/token hit,
// and count how many distinct terms reached that record so records short of `terms.length` (failed
// the AND) are dropped before sorting. Per-field highlight ranges are computed only for the final
// top `limit` records (after sorting), since running highlightRanges over every match -- which can be
// most of the corpus for a common word -- would erase the gain from the inverted index above.
export function search(index, query, { limit = MAX_RESULTS } = {}) {
  const { records, tokenPostings, sortedTokens } = index;
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const perRecord = new Map(); // recordIndex -> { termHits, score, fields: Set }
  for (const term of terms) {
    const start = lowerBound(sortedTokens, term);
    const bestForTerm = new Map(); // recordIndex -> best score this term achieved (any field/token)
    const fieldsForTerm = new Map(); // recordIndex -> Set(fieldName) this term hit
    for (let i = start; i < sortedTokens.length; i++) {
      const tok = sortedTokens[i];
      if (!tok.startsWith(term)) break; // sorted, so prefixes of `term` end here
      const wholeWord = tok.length === term.length;
      for (const [ri, name] of tokenPostings.get(tok)) {
        let score = name === 'title' ? 10 : (FIELD_WEIGHT[name] || 1);
        score += 3; // a token match is always a word start
        if (wholeWord) score += 5;
        if (!bestForTerm.has(ri) || score > bestForTerm.get(ri)) bestForTerm.set(ri, score);
        let fs = fieldsForTerm.get(ri);
        if (!fs) fieldsForTerm.set(ri, fs = new Set());
        fs.add(name);
      }
    }
    for (const [ri, best] of bestForTerm) {
      let pr = perRecord.get(ri);
      if (!pr) perRecord.set(ri, pr = { termHits: 0, score: 0, fields: new Set() });
      pr.termHits += 1;
      pr.score += best;
      for (const f of fieldsForTerm.get(ri)) pr.fields.add(f);
    }
  }

  const out = [];
  for (const [ri, pr] of perRecord) {
    if (pr.termHits !== terms.length) continue;
    const rec = records[ri];
    out.push({ _rec: rec, entity: rec.entity, score: pr.score, _hitFieldNames: pr.fields, _time: rec.time });
  }
  out.sort((a, b) => (b.score - a.score) || (b._time - a._time));
  const top = out.slice(0, limit);
  for (const r of top) {
    const fields = {};
    for (const name of r._hitFieldNames) {
      const ranges = highlightRanges(r._rec.fields[name].text, terms);
      if (ranges.length) fields[name] = ranges;
    }
    r.fields = fields;
    delete r._rec; delete r._hitFieldNames; delete r._time;
  }
  return top;
}

// Groups already-scored, already-sorted `results` (as returned by search()) by research category, so
// a flat 34-result list becomes a handful of labeled sections instead of one long scroll. Each group
// keeps its full `results` (score order preserved, since results was sorted before grouping) plus a
// `shown` slice capped at `perGroup` for the initial render; the caller decides when to reveal the
// rest ("Show all N"). Groups are ordered by their best (first, since already sorted) score, with
// CATEGORY_META's declared order as a stable tiebreaker for equal scores.
export function groupResults(results, { perGroup = PER_GROUP } = {}) {
  const byCategory = new Map(); // categoryId -> { id, label, color, results: [] }
  for (const r of results) {
    const catId = r.entity.category;
    let g = byCategory.get(catId);
    if (!g) {
      const meta = CATEGORY_META[catId];
      g = { id: catId || 'uncategorized', label: meta ? meta.label : (catId || 'Other'), color: meta ? meta.color : '#8E8E93', results: [] };
      byCategory.set(catId, g);
    }
    g.results.push(r);
  }
  const groups = Array.from(byCategory.values()).map((g) => ({
    ...g,
    count: g.results.length,
    bestScore: g.results[0]?.score ?? 0,
    shown: g.results.slice(0, perGroup),
  }));
  groups.sort((a, b) => (b.bestScore - a.bestScore) || (CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id)));
  return groups;
}

// Finds every term occurrence in `text` (folded+diacritic-insensitive) and merges overlapping or
// touching ranges, so e.g. searching "sao paulo" over "São Paulo" yields one merged highlight rather
// than two mangled ones. Returns [[start,end], ...] sorted ascending, indices into the ORIGINAL text.
export function highlightRanges(text, terms) {
  const folded = fold(text);
  const raw = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(term, from);
      if (idx === -1) break;
      raw.push([idx, idx + term.length]);
      from = idx + term.length;
    }
  }
  if (!raw.length) return [];
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [raw[0].slice()];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    const [s, e] = raw[i];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

// Builds text nodes + <mark class="ph-hl"> elements from ranges -- never innerHTML, so titles/
// summaries containing "<" or "&" can never be mis-parsed as markup. `doc` defaults to the global
// `document` but tests pass a tiny fake one so this runs under plain Node.
export function buildHighlightFragment(text, ranges, doc = document) {
  const frag = doc.createDocumentFragment();
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, start)));
    const mark = doc.createElement('mark');
    mark.className = 'ph-hl';
    mark.appendChild(doc.createTextNode(text.slice(start, end)));
    frag.appendChild(mark);
    pos = end;
  }
  if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
  return frag;
}

export function highlight(text, terms, doc = document) {
  return buildHighlightFragment(text, highlightRanges(text, terms), doc);
}

let cssPromise;
function loadStylesheet() {
  return cssPromise ??= new Promise((resolve) => {
    if (document.querySelector(`link[href="${SEARCH_CSS_HREF}"]`)) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = SEARCH_CSS_HREF;
    // Fail-open: an unstyled panel is still usable, so a 404 on the stylesheet must not block search.
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.append(link);
  });
}

function pickSnippetField(fields) {
  for (const name of SNIPPET_PRIORITY) if (fields[name]) return name;
  return null;
}

function metaRow(entity) {
  const meta = document.createElement('div');
  meta.className = 'search-result-meta';
  const date = document.createElement('span');
  date.textContent = entity.date;
  const catMeta = CATEGORY_META[entity.category];
  const dotSep1 = document.createElement('span');
  dotSep1.className = 'search-sep';
  dotSep1.textContent = '·';
  const swatch = document.createElement('span');
  swatch.className = 'search-swatch';
  swatch.style.background = catMeta ? catMeta.color : '#8E8E93';
  const catLabel = document.createElement('span');
  catLabel.textContent = catMeta ? catMeta.label : (entity.category || '');
  const dotSep2 = document.createElement('span');
  dotSep2.className = 'search-sep';
  dotSep2.textContent = '·';
  const country = document.createElement('span');
  country.textContent = entity.institution?.country || '';
  meta.append(date, dotSep1, swatch, catLabel, dotSep2, country);
  return meta;
}

/**
 * createSearchPanel(root, { store, onSelect, onResults }) -> { open, close, toggle, isOpen, destroy }
 * A Spotlight-style glass overlay: type to filter every entity field with AND-term matching, arrow
 * keys move the selection, Enter opens the highlighted result, Esc closes and returns focus.
 */
export function createSearchPanel(root, { store, onSelect, onResults } = {}) {
  loadStylesheet();

  let index = null; // built lazily on first open so the panel costs nothing before it's used
  let indexById = null;
  let currentResults = []; // full flat result set from search(), for the top counter and onResults
  let currentGroups = []; // currentResults grouped by category (groupResults())
  let expandedGroups = new Set(); // group ids whose "Show all" has been pressed for this query
  let visibleResults = []; // flat list of results actually rendered (respecting per-group truncation); selectedIndex indexes into this
  let selectedIndex = -1;
  let currentTerms = [];
  let rafId = null;
  let isOpen = false;
  let opener = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'search-backdrop';

  const panel = document.createElement('div');
  panel.className = 'search-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Search');

  const inputRow = document.createElement('div');
  inputRow.className = 'search-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search-input';
  input.placeholder = 'Search titles, summaries, authors, places…';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'search-listbox');
  inputRow.appendChild(input);

  const count = document.createElement('div');
  count.className = 'search-count';
  count.setAttribute('aria-live', 'polite');

  // A div, not a <ul>: groups nest a header + a "Show all" button between options, which role="group"
  // (the ARIA-sanctioned way to section a listbox's options) accepts but native <ul>/<li> semantics don't.
  const list = document.createElement('div');
  list.className = 'search-results';
  list.id = 'search-listbox';
  list.setAttribute('role', 'listbox');

  const empty = document.createElement('div');
  empty.className = 'search-empty';
  empty.hidden = true;

  panel.append(inputRow, count, list, empty);
  root.append(backdrop, panel);

  function ensureIndex() {
    if (index) return;
    const entities = store?.all ? store.all() : [];
    index = buildIndex(entities);
    // buildIndex returns { records, tokenPostings, sortedTokens }; records hold the id on .entity
    indexById = new Map(index.records.map((r) => [r.entity.id, r]));
  }

  function fieldText(entityId, name) {
    return indexById.get(entityId)?.fields?.[name]?.text ?? '';
  }

  function renderEmpty(query) {
    list.replaceChildren();
    empty.hidden = false;
    empty.replaceChildren();
    const line = document.createElement('div');
    line.className = 'search-empty-title';
    line.textContent = `No results for “${query}”`;
    const tip = document.createElement('div');
    tip.className = 'search-empty-tip';
    tip.textContent = 'Try fewer words, a country name, or a PMID/DOI.';
    empty.append(line, tip);
  }

  function buildResultEl(r, i) {
    const el = document.createElement('div');
    el.className = 'search-result';
    el.id = `search-opt-${i}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(i === selectedIndex));
    if (i === selectedIndex) el.classList.add('active');

    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.appendChild(highlight(r.entity.title, currentTerms));
    el.appendChild(title);
    el.appendChild(metaRow(r.entity));

    // Title-only hit: still show the summary as context so every result explains itself.
    const snippetField = pickSnippetField(r.fields) ?? 'summary';
    if (snippetField) {
      const snippet = document.createElement('div');
      snippet.className = 'search-result-snippet';
      snippet.appendChild(highlight(fieldText(r.entity.id, snippetField), currentTerms));
      el.appendChild(snippet);
    }

    el.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
    el.addEventListener('click', () => choose(i));
    return el;
  }

  // Renders currentGroups as labeled sections (color swatch + label + count), up to `perGroup`
  // results per group plus a "Show all N" button for any group with more. selectedIndex/visibleResults
  // are recomputed here so keyboard nav and click-to-choose always agree with what's on screen.
  function render() {
    empty.hidden = true;
    list.replaceChildren();
    visibleResults = [];
    for (const g of currentGroups) {
      const expanded = expandedGroups.has(g.id);
      const shown = expanded ? g.results : g.shown;

      const groupEl = document.createElement('div');
      groupEl.className = 'search-group';
      groupEl.setAttribute('role', 'group');
      groupEl.setAttribute('aria-label', `${g.label} (${g.count})`);

      const header = document.createElement('div');
      header.className = 'search-group-header';
      const swatch = document.createElement('span');
      swatch.className = 'search-group-swatch';
      swatch.style.background = g.color;
      const label = document.createElement('span');
      label.className = 'search-group-label';
      label.textContent = g.label;
      const countEl = document.createElement('span');
      countEl.className = 'search-group-count';
      countEl.textContent = String(g.count);
      header.append(swatch, label, countEl);
      groupEl.appendChild(header);

      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'search-group-items';
      for (const r of shown) {
        const i = visibleResults.length;
        visibleResults.push(r);
        itemsWrap.appendChild(buildResultEl(r, i));
      }
      groupEl.appendChild(itemsWrap);

      if (!expanded && g.count > g.shown.length) {
        const showAllBtn = document.createElement('button');
        showAllBtn.type = 'button';
        showAllBtn.className = 'search-show-all';
        showAllBtn.textContent = `Show all ${g.count}`;
        showAllBtn.addEventListener('click', () => { expandedGroups.add(g.id); render(); });
        groupEl.appendChild(showAllBtn);
      }

      list.appendChild(groupEl);
    }
    input.setAttribute('aria-expanded', String(visibleResults.length > 0));
    input.setAttribute('aria-activedescendant', selectedIndex >= 0 ? `search-opt-${selectedIndex}` : '');
  }

  function runSearch() {
    const query = input.value.trim();
    currentTerms = fold(query).split(/\s+/).filter(Boolean);
    if (!currentTerms.length) {
      currentResults = [];
      currentGroups = [];
      visibleResults = [];
      selectedIndex = -1;
      list.replaceChildren();
      empty.hidden = true;
      count.textContent = '';
      onResults?.(null);
      return;
    }
    ensureIndex();
    currentResults = search(index, query, { limit: MAX_RESULTS });
    expandedGroups = new Set(); // fresh query: collapse every group back to its top items
    currentGroups = groupResults(currentResults, { perGroup: PER_GROUP });
    selectedIndex = currentResults.length ? 0 : -1;
    if (!currentResults.length) {
      renderEmpty(query);
      count.textContent = '0 results';
    } else {
      render();
      const groupWord = currentGroups.length === 1 ? 'group' : 'groups';
      count.textContent = `${currentResults.length} result${currentResults.length === 1 ? '' : 's'} in ${currentGroups.length} ${groupWord}`;
    }
    onResults?.(currentResults.length ? new Set(currentResults.map((r) => r.entity.id)) : null);
  }

  function scheduleSearch() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { rafId = null; runSearch(); });
  }

  function choose(i) {
    const r = visibleResults[i];
    if (!r) return;
    onSelect?.(r.entity);
    close();
  }

  // Moves across visible results only -- group headers and the "Show all" button are skipped, since
  // they're reached by Tab instead (see onKeydown's focus trap below).
  function moveSelection(delta) {
    if (!visibleResults.length) return;
    selectedIndex = (selectedIndex + delta + visibleResults.length) % visibleResults.length;
    render();
    list.querySelector('.search-result.active')?.scrollIntoView({ block: 'nearest' });
  }

  function focusables() {
    return Array.from(panel.querySelectorAll('input, button')).filter((el) => !el.hidden && !el.disabled);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); choose(selectedIndex); return; }
    if (e.key === 'Tab') {
      // Standard focus trap (input + any "Show all" buttons currently on screen), not a hard return
      // to the input: a "Show all" button needs to be Tab-reachable to expand its group.
      const els = focusables();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function onBackdropDown(e) { if (e.target === backdrop) close(); }

  input.addEventListener('input', scheduleSearch);
  input.addEventListener('keydown', onKeydown);
  backdrop.addEventListener('mousedown', onBackdropDown);

  function open() {
    if (isOpen) return;
    opener = document.activeElement;
    isOpen = true;
    ensureIndex();
    backdrop.classList.add('open');
    panel.classList.add('open');
    input.value = '';
    currentResults = [];
    currentGroups = [];
    expandedGroups = new Set();
    visibleResults = [];
    currentTerms = [];
    selectedIndex = -1;
    list.replaceChildren();
    empty.hidden = true;
    count.textContent = '';
    document.addEventListener('keydown', onKeydown, true);
    input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    backdrop.classList.remove('open');
    panel.classList.remove('open');
    document.removeEventListener('keydown', onKeydown, true);
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    onResults?.(null);
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  function toggle() { isOpen ? close() : open(); }

  function destroy() {
    close();
    input.removeEventListener('input', scheduleSearch);
    input.removeEventListener('keydown', onKeydown);
    backdrop.removeEventListener('mousedown', onBackdropDown);
    backdrop.remove();
    panel.remove();
    document.querySelector(`link[href="${SEARCH_CSS_HREF}"]`)?.remove();
    cssPromise = undefined;
  }

  return { open, close, toggle, get isOpen() { return isOpen; }, destroy };
}
