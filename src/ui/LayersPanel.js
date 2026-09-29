/** THIS FILE DOES: Right glass sidebar listing every live-data layer (base/country as radio cards, others as switch rows) with inline filters, trust badges and live status, ROLE: UI, MAINTAINER NOTE: Rows are built once and only patched (textContent/aria-*) on manager 'change' events, never rebuilt wholesale, so a background poll tick never risks blowing the click handler time budget. **/
import { icon } from './icons.js';
import { attachSheetGesture } from './SheetGesture.js';
import { isSlowConnection } from './LayerManager.js';

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `~${n} B`;
  if (n < 1024 * 1024) return `~${Math.round(n / 1024)} KB`;
  return `~${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function relativeTime(ms) {
  if (typeof ms !== 'number') return '';
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} hr ago`;
  return `${Math.round(diff / 86400000)} d ago`;
}

// Plain-language nouns for status lines ("214 earthquakes" reads better than "214 results").
const NOUNS = { quakes: 'earthquakes', eonet: 'events', outbreaks: 'outbreaks', trials: 'trial sites', iss: 'station', aurora: 'forecast cells' };

function statusText(layer, st) {
  switch (st.status) {
    case 'loading': return 'Loading…';
    case 'ok': {
      if (!layer.approxBytes) return 'Built in · no download';
      const updated = `Updated ${relativeTime(st.fetchedAt)}`;
      if (layer.render === 'base') return updated;
      const noun = layer.render === 'country-fill' ? 'countries' : (NOUNS[layer.id] ?? 'items');
      return `${updated} · ${st.count} ${noun}`;
    }
    case 'error': return "Couldn't load · Retry";
    case 'paused-slow': return 'Paused on slow connection · Tap to load';
    default: return '';
  }
}

export function createLayersPanel(root, { manager, layers, groups, button }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'filter-backdrop layers-backdrop';

  const panel = document.createElement('div');
  panel.className = 'filter-panel layers-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'layers-title');

  const header = document.createElement('div');
  header.className = 'filter-header';
  const title = document.createElement('h2');
  title.id = 'layers-title';
  title.textContent = 'Layers';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.setAttribute('aria-label', 'Close layers');
  closeBtn.appendChild(icon('close'));
  header.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'filter-body';

  // Bonus header card: "Earth right now - NASA EPIC", loaded once, only while the panel is open and
  // not on a slow connection. Not a layer: exempt from the "nothing fetched before switched on" rule.
  const epicCard = document.createElement('div');
  epicCard.className = 'layer-epic-card';
  const epicImg = document.createElement('img');
  epicImg.alt = 'Latest natural-color image of Earth from NASA EPIC';
  epicImg.loading = 'lazy';
  const epicLabel = document.createElement('div');
  epicLabel.className = 'layer-epic-label';
  epicLabel.textContent = 'Earth right now · NASA EPIC';
  epicCard.append(epicImg, epicLabel);
  epicCard.hidden = true;
  body.appendChild(epicCard);
  let epicLoaded = false;
  function loadEpic() {
    if (epicLoaded || isSlowConnection()) return;
    epicLoaded = true;
    fetch('https://epic.gsfc.nasa.gov/api/natural')
      .then((r) => r.json())
      .then((list) => {
        const latest = Array.isArray(list) ? list[list.length - 1] : null;
        if (!latest) return;
        const [y, m, d] = latest.date.split(' ')[0].split('-');
        epicImg.src = `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${latest.image}.jpg`;
        epicCard.hidden = false;
      })
      .catch(() => { /* decorative: a failed fetch just leaves the header without the thumbnail */ });
  }

  const rows = new Map(); // id -> { switchEl, filtersWrap, statusEl, sizeEl }
  const filterInputs = new Map(); // id -> { key -> input rebuild fn }

  function buildFilters(layer, wrap) {
    wrap.replaceChildren();
    for (const f of layer.filters ?? []) {
      const row = document.createElement('div');
      row.className = 'layer-filter-row';
      const label = document.createElement('label');
      label.className = 'layer-filter-label';
      label.textContent = f.label;
      const id = `layer-filter-${layer.id}-${f.key}`;
      label.htmlFor = id;
      row.appendChild(label);
      const current = manager.getFilterValues(layer.id)[f.key] ?? f.default;

      if (f.type === 'select') {
        const select = document.createElement('select');
        select.id = id;
        for (const opt of f.options ?? []) {
          const o = document.createElement('option');
          o.value = opt.value ?? opt;
          o.textContent = opt.label ?? opt;
          select.appendChild(o);
        }
        select.value = current;
        // select.value is always a string; hand the adapter the option's ORIGINAL value (e.g. the
        // number 7, not "7") - EONET's day window silently fell back to 30 days on strings.
        select.addEventListener('change', () => {
          const opt = (f.options ?? []).find((o) => String(o.value ?? o) === select.value);
          manager.setFilter(layer.id, f.key, opt ? (opt.value ?? opt) : select.value);
        });
        row.appendChild(select);
      } else if (f.type === 'range') {
        const range = document.createElement('input');
        range.type = 'range';
        range.id = id;
        range.min = f.min;
        range.max = f.max;
        range.step = f.step ?? 1;
        range.value = current;
        const valueLabel = document.createElement('span');
        valueLabel.className = 'layer-filter-value';
        valueLabel.textContent = String(current);
        range.addEventListener('input', () => { valueLabel.textContent = range.value; });
        range.addEventListener('change', () => manager.setFilter(layer.id, f.key, Number(range.value)));
        row.append(range, valueLabel);
      } else if (f.type === 'chips') {
        const chipsWrap = document.createElement('div');
        chipsWrap.className = 'layer-filter-chips';
        chipsWrap.setAttribute('role', 'group');
        chipsWrap.setAttribute('aria-label', f.label);
        const selected = new Set(Array.isArray(current) ? current : current ? [current] : []);
        for (const opt of f.options ?? []) {
          const val = opt.value ?? opt;
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'layer-chip';
          chip.textContent = opt.label ?? opt;
          chip.setAttribute('aria-pressed', String(selected.has(val)));
          chip.addEventListener('click', () => {
            if (selected.has(val)) selected.delete(val); else selected.add(val);
            chip.setAttribute('aria-pressed', String(selected.has(val)));
            manager.setFilter(layer.id, f.key, [...selected]);
          });
          chipsWrap.appendChild(chip);
        }
        row.appendChild(chipsWrap);
      } else if (f.type === 'text') {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = id;
        input.value = current ?? '';
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); manager.setFilter(layer.id, f.key, input.value); }
        });
        input.addEventListener('blur', () => manager.setFilter(layer.id, f.key, input.value));
        row.appendChild(input);
      }
      wrap.appendChild(row);
    }
  }

  function trustBadge(layer) {
    const a = document.createElement('a');
    a.className = 'layer-trust-badge';
    a.href = layer.source.homepage;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `Official · ${layer.source.domain}`;
    return a;
  }

  function buildRow(layer, { asRadio, groupName }) {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.dataset.layerId = layer.id;

    const head = document.createElement('div');
    head.className = 'layer-row-head';
    const labelWrap = document.createElement('div');
    labelWrap.className = 'layer-row-labels';
    const label = document.createElement('div');
    label.className = 'layer-row-title';
    label.textContent = layer.title;
    const desc = document.createElement('div');
    desc.className = 'layer-row-desc';
    desc.textContent = layer.description ?? '';
    labelWrap.append(label, desc, trustBadge(layer));

    let control;
    if (asRadio) {
      control = document.createElement('input');
      control.type = 'radio';
      control.name = `layer-group-${groupName}`;
      control.className = 'layer-radio';
      control.setAttribute('aria-label', `Select ${layer.title}`);
      control.addEventListener('change', () => { if (control.checked) manager.enable(layer.id); });
    } else {
      control = document.createElement('button');
      control.type = 'button';
      control.className = 'switch';
      control.setAttribute('role', 'switch');
      control.setAttribute('aria-label', `Toggle ${layer.title}`);
      control.setAttribute('aria-checked', 'false');
      control.addEventListener('click', () => {
        const st = manager.state[layer.id];
        if (st?.on) manager.disable(layer.id); else manager.enable(layer.id);
      });
    }
    head.append(labelWrap, control);
    row.appendChild(head);

    const statusEl = document.createElement('div');
    statusEl.className = 'layer-row-status';
    statusEl.addEventListener('click', () => {
      const st = manager.state[layer.id];
      if (st?.status === 'error' || st?.status === 'paused-slow') manager.enable(layer.id);
    });
    const sizeEl = document.createElement('div');
    sizeEl.className = 'layer-row-size';
    sizeEl.textContent = layer.approxBytes ? formatBytes(layer.approxBytes) : ''; // bundled layers cost nothing
    const metaRow = document.createElement('div');
    metaRow.className = 'layer-row-meta';
    metaRow.append(statusEl, sizeEl);
    row.appendChild(metaRow);

    const filtersWrap = document.createElement('div');
    filtersWrap.className = 'layer-row-filters';
    filtersWrap.hidden = true;
    row.appendChild(filtersWrap);

    rows.set(layer.id, { row, control, asRadio, statusEl, sizeEl, filtersWrap, built: false });
    return row;
  }

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'filter-section layer-group';
    const h3 = document.createElement('h3');
    h3.textContent = group.title;
    section.appendChild(h3);

    const groupLayers = layers.filter((l) => l.group === group.id);
    if (group.exclusive) {
      const radiogroup = document.createElement('div');
      radiogroup.setAttribute('role', 'radiogroup');
      radiogroup.setAttribute('aria-label', group.title);
      if (group.allowNone) {
        const noneRow = document.createElement('div');
        noneRow.className = 'layer-row layer-row-none';
        const noneLabel = document.createElement('label');
        noneLabel.className = 'layer-none-label';
        const noneRadio = document.createElement('input');
        noneRadio.type = 'radio';
        noneRadio.name = `layer-group-${group.id}`;
        noneRadio.className = 'layer-radio';
        noneRadio.checked = true;
        noneRadio.addEventListener('change', () => {
          if (!noneRadio.checked) return;
          const on = groupLayers.find((l) => manager.state[l.id]?.on);
          if (on) manager.disable(on.id);
        });
        noneLabel.append(noneRadio, document.createTextNode('None'));
        noneRow.appendChild(noneLabel);
        rows.set(`${group.id}::none`, { row: noneRow, control: noneRadio, isNone: true });
        radiogroup.appendChild(noneRow);
      }
      for (const layer of groupLayers) radiogroup.appendChild(buildRow(layer, { asRadio: true, groupName: group.id }));
      section.appendChild(radiogroup);
    } else {
      for (const layer of groupLayers) section.appendChild(buildRow(layer, { asRadio: false }));
    }
    body.appendChild(section);
  }

  const sourcesDetails = document.createElement('details');
  sourcesDetails.className = 'layer-sources';
  const sourcesSummary = document.createElement('summary');
  sourcesSummary.textContent = 'Sources & licenses';
  sourcesDetails.appendChild(sourcesSummary);
  const sourcesList = document.createElement('ul');
  for (const layer of layers) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = layer.source.homepage;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${layer.source.org} (${layer.source.domain})`;
    li.append(a, document.createTextNode(` — ${layer.source.license}`));
    sourcesList.appendChild(li);
  }
  sourcesDetails.appendChild(sourcesList);
  body.appendChild(sourcesDetails);

  const footer = document.createElement('div');
  footer.className = 'filter-footer';
  const offAllBtn = document.createElement('button');
  offAllBtn.type = 'button';
  offAllBtn.className = 'btn-secondary';
  offAllBtn.textContent = 'Turn all layers off';
  offAllBtn.addEventListener('click', () => manager.disableAll());
  footer.appendChild(offAllBtn);

  panel.append(header, body, footer);
  root.append(backdrop, panel);

  function syncRow(id) {
    const st = manager.state[id];
    const r = rows.get(id);
    if (!r || r.isNone || !st) return;
    const layer = layers.find((l) => l.id === id);
    if (r.asRadio) r.control.checked = !!st.on;
    else r.control.setAttribute('aria-checked', String(!!st.on));
    r.row.classList.toggle('layer-row-loading', st.status === 'loading');
    r.row.classList.toggle('layer-row-error', st.status === 'error');
    r.statusEl.textContent = statusText(layer, st);
    r.statusEl.classList.toggle('layer-row-status-actionable', st.status === 'error' || st.status === 'paused-slow');
    const shouldShowFilters = !!st.on && (layer.filters?.length ?? 0) > 0;
    r.filtersWrap.hidden = !shouldShowFilters;
    if (shouldShowFilters && !r.built) { buildFilters(layer, r.filtersWrap); r.built = true; }
  }

  function syncNoneRadios() {
    for (const group of groups) {
      if (!group.allowNone) continue;
      const r = rows.get(`${group.id}::none`);
      if (!r) continue;
      const groupLayers = layers.filter((l) => l.group === group.id);
      const anyOn = groupLayers.some((l) => manager.state[l.id]?.on);
      r.control.checked = !anyOn;
    }
  }

  function syncAll() {
    for (const layer of layers) syncRow(layer.id);
    syncNoneRadios();
  }

  const offChange = manager.on('change', ({ id } = {}) => { if (id) syncRow(id); else syncAll(); syncNoneRadios(); });
  syncAll();

  let isOpen = false;
  let opener = null;

  function focusables() {
    return Array.from(panel.querySelectorAll('button, input, select, a[href]')).filter((el) => !el.hidden && !el.disabled);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const els = focusables();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function open() {
    opener = button ?? document.activeElement;
    isOpen = true;
    backdrop.classList.add('open');
    panel.classList.add('open');
    button?.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    closeBtn.focus();
    loadEpic();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    backdrop.classList.remove('open');
    panel.classList.remove('open');
    button?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown, true);
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  function toggle() { isOpen ? close() : open(); }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  const sheetGesture = attachSheetGesture(panel, { handleEl: header, onClose: close, startDetent: 'half' }); // keep the planet visible while toggling

  function destroy() {
    offChange();
    sheetGesture.destroy();
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    panel.remove();
  }

  return { open, close, toggle, get isOpen() { return isOpen; }, destroy };
}
