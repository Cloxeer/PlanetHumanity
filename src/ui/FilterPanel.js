/** THIS FILE DOES: Right-side filter sidebar (sources/categories, live count) driving engine.setCategories, ROLE: UI, MAINTAINER NOTE: Filters is data-only -- Dark mode/Larger text/Reduce motion moved to the Map settings popover (SettingsPopover.js, owned by GLOBE). Every toggle handler is wrapped in performance.mark/measure('ph:filter') and only touches engine + a few DOM writes to stay under filterToggleMsMax. **/
import { icon } from './icons.js';
import { CATEGORY_META, SOURCES } from './categories.js';

const ALL_CATEGORIES = SOURCES.flatMap((s) => s.categories);

export function createFilterPanel(root, { engine, store, button, badge }) {
  const active = new Set(ALL_CATEGORIES); // all on by default; mirrors engine's null filter

  const backdrop = document.createElement('div');
  backdrop.className = 'filter-backdrop';

  const panel = document.createElement('div');
  panel.className = 'filter-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'filter-title');

  const header = document.createElement('div');
  header.className = 'filter-header';
  const title = document.createElement('h2');
  title.id = 'filter-title';
  title.textContent = 'Filters';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn';
  closeBtn.setAttribute('aria-label', 'Close filters');
  closeBtn.appendChild(icon('close'));
  header.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'filter-body';

  const counts = new Map(store.categoryCounts().map((c) => [c.id, c.count]));
  const checkboxes = new Map(); // categoryId -> input
  const switches = new Map(); // sourceId -> switch button

  const sourcesSection = document.createElement('section');
  sourcesSection.className = 'filter-section';
  const sourcesTitle = document.createElement('h3');
  sourcesTitle.textContent = 'Sources';
  sourcesSection.appendChild(sourcesTitle);

  for (const source of SOURCES) {
    const card = document.createElement('div');
    card.className = 'source-card';

    const cardHead = document.createElement('div');
    cardHead.className = 'source-head';
    const labelWrap = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'source-label';
    label.textContent = source.label;
    const sub = document.createElement('div');
    sub.className = 'source-sublabel';
    sub.textContent = source.sublabel;
    const total = source.categories.reduce((s, c) => s + (counts.get(c) ?? 0), 0);
    const countEl = document.createElement('div');
    countEl.className = 'source-count';
    countEl.textContent = `${total} papers`;
    labelWrap.append(label, sub, countEl);

    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', `Toggle ${source.label}`);
    sw.addEventListener('click', () => timed(() => {
      const allOn = source.categories.every((c) => active.has(c));
      for (const c of source.categories) setCategory(c, !allOn, { skipCommit: true });
      commit();
    }));
    switches.set(source.id, sw);
    cardHead.append(labelWrap, sw);
    card.appendChild(cardHead);

    const rowLinks = document.createElement('div');
    rowLinks.className = 'row-links';
    const selectAll = document.createElement('button');
    selectAll.type = 'button';
    selectAll.className = 'link-btn';
    selectAll.textContent = 'Select all';
    selectAll.addEventListener('click', () => timed(() => {
      for (const c of source.categories) setCategory(c, true, { skipCommit: true });
      commit();
    }));
    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'link-btn';
    clearAll.textContent = 'Clear';
    clearAll.addEventListener('click', () => timed(() => {
      for (const c of source.categories) setCategory(c, false, { skipCommit: true });
      commit();
    }));
    rowLinks.append(selectAll, clearAll);
    card.appendChild(rowLinks);

    const list = document.createElement('ul');
    list.className = 'category-list';
    for (const catId of source.categories) {
      const meta = CATEGORY_META[catId];
      const li = document.createElement('li');
      const rowLabel = document.createElement('label');
      rowLabel.className = 'category-row';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = meta.color;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      const id = `filter-cat-${catId}`;
      input.id = id;
      rowLabel.htmlFor = id;
      const text = document.createElement('span');
      text.className = 'category-label';
      text.textContent = meta.label;
      const cnt = document.createElement('span');
      cnt.className = 'category-count';
      cnt.textContent = String(counts.get(catId) ?? 0);
      input.addEventListener('change', () => timed(() => { setCategory(catId, input.checked, { skipCommit: true }); commit(); }));
      rowLabel.append(swatch, input, text, cnt);
      li.appendChild(rowLabel);
      list.appendChild(li);
      checkboxes.set(catId, input);
    }
    card.appendChild(list);
    sourcesSection.appendChild(card);
  }
  body.appendChild(sourcesSection);

  const footer = document.createElement('div');
  footer.className = 'filter-footer';
  const showing = document.createElement('div');
  showing.className = 'filter-showing';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn-secondary';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => timed(() => {
    for (const c of ALL_CATEGORIES) setCategory(c, true, { skipCommit: true });
    commit();
  }));
  footer.append(showing, resetBtn);

  panel.append(header, body, footer);
  root.append(backdrop, panel);

  function setCategory(catId, on, { skipCommit = false } = {}) {
    if (on) active.add(catId); else active.delete(catId);
    const cb = checkboxes.get(catId);
    if (cb) cb.checked = on;
    if (!skipCommit) commit();
  }

  function syncSwitches() {
    for (const source of SOURCES) {
      const allOn = source.categories.every((c) => active.has(c));
      const noneOn = source.categories.every((c) => !active.has(c));
      const sw = switches.get(source.id);
      sw.setAttribute('aria-checked', allOn ? 'true' : noneOn ? 'false' : 'mixed');
      sw.classList.toggle('indeterminate', !allOn && !noneOn);
    }
  }

  function commit() {
    syncSwitches();
    engine.setCategories(active.size === ALL_CATEGORIES.length ? null : new Set(active));
    updateBadge();
  }

  function timed(fn) {
    performance.mark('ph:filter-start');
    fn();
    performance.mark('ph:filter-end');
    performance.measure('ph:filter', 'ph:filter-start', 'ph:filter-end');
  }

  function updateBadge() {
    if (badge) badge.hidden = active.size === ALL_CATEGORIES.length;
  }

  function updateShowing(count) {
    showing.textContent = `Showing ${count} of ${store.size} papers`;
  }

  const offChange = engine.on('change', ({ count }) => updateShowing(count));
  updateShowing(engine.visible().length);
  syncSwitches(); // first render: switches must reflect the initial all-on state
  updateBadge();

  let isOpen = false;
  let opener = null;

  function focusables() {
    return Array.from(panel.querySelectorAll('button, input, a[href]')).filter((el) => !el.hidden && !el.disabled);
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
    // Prefer the Filters button: Safari doesn't focus buttons on click, so activeElement is often <body>.
    opener = button ?? document.activeElement;
    isOpen = true;
    backdrop.classList.add('open');
    panel.classList.add('open');
    button?.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    closeBtn.focus();
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

  function destroy() {
    offChange();
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    panel.remove();
  }

  return { open, close, toggle, get isOpen() { return isOpen; }, destroy };
}
