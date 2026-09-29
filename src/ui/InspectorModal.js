/** THIS FILE DOES: Right-side/bottom-sheet frosted drawer showing full entity detail, ROLE: UI, MAINTAINER NOTE: All entity fields render via textContent; focus is trapped while open and returned to the opener on close. **/
import { CATEGORY_META } from './categories.js';
import { flagImg } from './flags.js';
import { attachSheetGesture } from './SheetGesture.js';

export function createInspector(root) {
  const backdrop = document.createElement('div');
  backdrop.className = 'inspector-backdrop';

  const panel = document.createElement('div');
  panel.className = 'inspector';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'inspector-title');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'inspector-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';

  const title = document.createElement('h2');
  title.id = 'inspector-title';
  const imageSlot = document.createElement('div');
  imageSlot.className = 'inspector-image';
  const meta = document.createElement('p');
  meta.className = 'meta';
  const summary = document.createElement('p');
  summary.className = 'summary';
  const fields = document.createElement('div');
  const links = document.createElement('div');
  links.className = 'links';

  panel.append(closeBtn, title, imageSlot, meta, summary, fields, links);
  root.append(backdrop, panel);

  let open_ = false;
  let opener = null;
  let refImage = null;

  function field(label, value) {
    if (!value) return;
    const p = document.createElement('p');
    p.className = 'field';
    const b = document.createElement('b');
    b.textContent = label + ': ';
    p.appendChild(b);
    p.appendChild(document.createTextNode(value));
    fields.appendChild(p);
  }

  // A dedicated location line (flag + city, country) rather than folding it into
  // the Institution field, so the flag has a fixed, predictable spot to attach to.
  function fieldLocation(inst) {
    if (!inst) return;
    const p = document.createElement('p');
    p.className = 'field field-location';
    const b = document.createElement('b');
    b.textContent = 'Location: ';
    p.appendChild(b);
    const img = flagImg(inst.country, { w: 16, h: 12 });
    if (img) p.appendChild(img);
    p.appendChild(document.createTextNode([inst.city, inst.country].filter(Boolean).join(', ')));
    fields.appendChild(p);
  }

  function link(text, href) {
    const a = document.createElement('a');
    a.textContent = text;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    links.appendChild(a);
  }

  function open(entity) {
    opener = document.activeElement;
    title.textContent = entity.title;
    refImage?.destroy();
    imageSlot.replaceChildren();
    import('./RefImage.js')
      .then((mod) => { if (open_ !== false && title.textContent === entity.title) refImage = mod.mountRefImage(imageSlot, entity); })
      .catch(() => {}); // decorative: a failed dynamic import just leaves the frame empty
    meta.textContent = `${entity.date} · ${entity.journal}`;
    summary.textContent = entity.summary;
    fields.replaceChildren();
    links.replaceChildren();
    const authorsText = entity.authors.join(', ') + (entity.authorsTruncated ? ', et al.' : '');
    field('Authors', authorsText);
    const inst = entity.institution;
    field('Institution', inst?.name ?? '');
    fieldLocation(inst);
    field('Category', CATEGORY_META[entity.category]?.label ?? entity.category);
    field('PMID', entity.ids?.pmid);
    if (entity.ids?.pmcid) field('PMCID', entity.ids.pmcid);
    if (entity.ids?.doi) field('DOI', entity.ids.doi);
    if (entity.ids?.doi) link('DOI link', 'https://doi.org/' + entity.ids.doi);
    if (entity.ids?.pmcid) link('PMC full text', `https://pmc.ncbi.nlm.nih.gov/articles/${entity.ids.pmcid}/`);
    if (entity.sources?.pubmed) link('Open on PubMed', entity.sources.pubmed);
    if (entity.sources?.archive) link('Internet Archive copy', entity.sources.archive);

    backdrop.classList.add('open');
    panel.classList.add('open');
    open_ = true;
    document.addEventListener('keydown', onKeydown, true);
    closeBtn.focus();
  }

  function close() {
    if (!open_) return;
    backdrop.classList.remove('open');
    panel.classList.remove('open');
    open_ = false;
    refImage?.destroy();
    refImage = null;
    imageSlot.replaceChildren();
    document.removeEventListener('keydown', onKeydown, true);
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  function focusables() {
    return Array.from(panel.querySelectorAll('button, a[href]')).filter(el => !el.hidden);
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

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  // Mobile-only: lets the sheet be dragged between half/full detents or down to dismiss.
  // Header (title) is the extra drag zone alongside the gesture's own grabber bar.
  const sheetGesture = attachSheetGesture(panel, { handleEl: title, onClose: close });

  function destroy() {
    document.removeEventListener('keydown', onKeydown, true);
    refImage?.destroy();
    sheetGesture.destroy();
    backdrop.remove();
    panel.remove();
  }

  return { open, close, get isOpen() { return open_; }, destroy };
}
