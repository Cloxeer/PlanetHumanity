/** THIS FILE DOES: Renders the accessible plain-text table feed (first-paint primary view), ROLE: UI, MAINTAINER NOTE: Row nodes are keyed by entity id and reused across updates to avoid full table rebuilds during scrub. **/
import { CATEGORY_META } from './categories.js';
import { flagImg } from './flags.js';

const CAP = 200;

export function createPlainFeed(container, { onSelect }) {
  const table = document.createElement('table');
  table.className = 'feed';
  table.innerHTML = `<caption>Peer-reviewed breakthroughs, newest first</caption>
    <thead><tr>
      <th scope="col">Date</th><th scope="col">Title</th><th scope="col">Category</th>
      <th scope="col">Institution</th><th scope="col">Country</th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  const more = document.createElement('div');
  more.className = 'feed-more';
  more.hidden = true;

  container.replaceChildren(table, more);

  const rows = new Map(); // id -> <tr>
  let highlightIds = null; // Set of matching ids from search, or null = no active search

  function makeRow(entity) {
    const tr = document.createElement('tr');
    tr.className = 'row';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    const tds = [document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td'), document.createElement('td')];
    tds.forEach(td => tr.appendChild(td));
    fillRow(tr, entity);
    const activate = () => onSelect(entity);
    tr.addEventListener('click', activate);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    return tr;
  }

  function fillRow(tr, entity) {
    tr._entity = entity;
    const [d, t, c, i, cc] = tr.children;
    d.textContent = entity.date;
    t.textContent = entity.title;
    c.textContent = CATEGORY_META[entity.category]?.label ?? entity.category;
    c.style.color = CATEGORY_META[entity.category]?.color ?? '';
    i.textContent = entity.institution?.name ?? '';
    cc.replaceChildren();
    const country = entity.institution?.country ?? '';
    const img = flagImg(country, { w: 16, h: 12 });
    if (img) cc.appendChild(img);
    cc.appendChild(document.createTextNode(country));
  }

  function update(entities) {
    // engine.visible() is date-asc; this view is newest-first.
    const slice = entities.slice(-CAP).reverse();
    const wantIds = new Set(slice.map(e => e.id));
    for (const [id, tr] of rows) {
      if (!wantIds.has(id)) { tr.remove(); rows.delete(id); }
    }
    let prev = null;
    for (const entity of slice) {
      let tr = rows.get(entity.id);
      if (!tr) {
        tr = makeRow(entity);
        rows.set(entity.id, tr);
      } else if (tr._entity !== entity) {
        fillRow(tr, entity);
      }
      tr.classList.toggle('dim', highlightIds !== null && !highlightIds.has(entity.id));
      const after = prev ? prev.nextSibling : tbody.firstChild;
      if (after !== tr) tbody.insertBefore(tr, after);
      prev = tr;
    }
    const extra = entities.length - slice.length;
    if (extra > 0) {
      more.hidden = false;
      more.textContent = `+${extra} more (refine filters or scrub the timeline)`;
    } else {
      more.hidden = true;
    }
  }

  // Called by SearchPanel with the matching id set (or null to clear); non-matches dim rather
  // than hide, so the row count/order stays stable while a search is open.
  function setHighlight(idSet) {
    highlightIds = idSet ?? null;
    for (const [id, tr] of rows) tr.classList.toggle('dim', highlightIds !== null && !highlightIds.has(id));
  }

  function destroy() {
    container.replaceChildren();
    rows.clear();
  }

  return { update, setHighlight, destroy };
}
