/** THIS FILE DOES: Glass popover explaining the globe's colors and symbols (category swatches + counts, ring/line meanings), ROLE: UI, MAINTAINER NOTE: Anchored to the LEFT of the controls stack via CSS; counts are re-read from the stage every time it opens so they stay live without a subscription. **/
import { CATEGORY_META } from './categories.js';

const NOTES = [
  'Pulsing ring: published within 30 days of the timeline date',
  'Yellow ring: matches your search',
  'Highlighted country: selected',
  'N / S dots: poles',
  'Dashed yellow line: equator',
];

export function createLegend(anchorBtn, { counts } = {}) {
  const pop = document.createElement('div');
  pop.className = 'ph-legend';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Globe legend');
  pop.tabIndex = -1;
  pop.hidden = true;

  let extraSections = []; // [{ title, items: [{ label, color?, shape:'dot'|'ring'|'swatch'|'gradient', stops? }] }]

  function readCounts() {
    const c = typeof counts === 'function' ? counts() : counts;
    if (c instanceof Map) return c;
    return new Map(Object.entries(c ?? {}));
  }

  function renderLegendItem(item) {
    const li = document.createElement('li');
    if (item.shape === 'gradient') {
      const bar = document.createElement('span');
      bar.className = 'ph-legend-gradient';
      const colors = (item.stops ?? []).map((s) => s.color).filter(Boolean);
      bar.style.background = colors.length ? `linear-gradient(to right, ${colors.join(',')})` : '';
      li.appendChild(bar);
      const labels = document.createElement('span');
      labels.className = 'ph-legend-gradient-labels';
      for (const s of item.stops ?? []) {
        const span = document.createElement('span');
        span.textContent = s.label ?? '';
        labels.appendChild(span);
      }
      li.appendChild(labels);
    } else {
      const swatch = document.createElement('span');
      swatch.className = `ph-legend-dot ph-legend-shape-${item.shape ?? 'dot'}`;
      if (item.color) {
        if (item.shape === 'ring') swatch.style.borderColor = item.color;
        else swatch.style.background = item.color;
      }
      li.appendChild(swatch);
    }
    const label = document.createElement('span');
    label.className = 'ph-legend-label';
    label.textContent = item.label ?? '';
    li.appendChild(label);
    return li;
  }

  function renderExtraSections() {
    for (const section of extraSections) {
      const hr = document.createElement('hr');
      hr.className = 'ph-legend-divider';
      pop.appendChild(hr);
      if (section.title) {
        const h = document.createElement('div');
        h.className = 'ph-legend-section-title';
        h.textContent = section.title;
        pop.appendChild(h);
      }
      const list = document.createElement('ul');
      list.className = 'ph-legend-categories';
      for (const item of section.items ?? []) list.appendChild(renderLegendItem(item));
      pop.appendChild(list);
    }
  }

  function render() {
    pop.replaceChildren();
    const liveCounts = readCounts();

    const list = document.createElement('ul');
    list.className = 'ph-legend-categories';
    for (const [id, meta] of Object.entries(CATEGORY_META)) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'ph-legend-dot';
      dot.style.background = meta.color;
      const label = document.createElement('span');
      label.className = 'ph-legend-label';
      label.textContent = meta.label;
      const count = document.createElement('span');
      count.className = 'ph-legend-count';
      count.textContent = String(liveCounts.get(id) ?? 0);
      li.append(dot, label, count);
      list.appendChild(li);
    }
    pop.appendChild(list);

    const hr = document.createElement('hr');
    hr.className = 'ph-legend-divider';
    pop.appendChild(hr);

    const notes = document.createElement('ul');
    notes.className = 'ph-legend-notes';
    for (const text of NOTES) {
      const li = document.createElement('li');
      li.textContent = text;
      notes.appendChild(li);
    }
    pop.appendChild(notes);

    renderExtraSections();
  }

  function setExtraSections(sections) {
    extraSections = Array.isArray(sections) ? sections : [];
    if (isOpen) render();
  }

  // Lives beside the button inside the controls stack; globe.css positions it absolutely to the
  // stack's left so it never depends on the stack's own size.
  anchorBtn.insertAdjacentElement('afterend', pop);

  let isOpen = false;

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  function onPointerDown(e) {
    if (pop.contains(e.target) || anchorBtn.contains(e.target)) return;
    close();
  }

  function open() {
    render();
    isOpen = true;
    pop.hidden = false;
    anchorBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    pop.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    pop.hidden = true;
    anchorBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    anchorBtn.focus();
  }

  function toggle() { isOpen ? close() : open(); }

  function destroy() {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    pop.remove();
  }

  anchorBtn.setAttribute('aria-expanded', 'false');
  anchorBtn.setAttribute('aria-haspopup', 'dialog');

  return { open, close, toggle, get isOpen() { return isOpen; }, destroy, setExtraSections };
}
