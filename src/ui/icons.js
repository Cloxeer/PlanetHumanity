/** THIS FILE DOES: Builds small inline SVG icons via the DOM API (no innerHTML), ROLE: UI, MAINTAINER NOTE: 20x20 viewBox, currentColor stroke; keep path data terse to stay under the per-file byte budget. **/
const NS = 'http://www.w3.org/2000/svg';

function svg(children) {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', '0 0 20 20');
  root.setAttribute('width', '20');
  root.setAttribute('height', '20');
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', 'currentColor');
  root.setAttribute('stroke-width', '1.6');
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  root.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of children) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    root.appendChild(el);
  }
  return root;
}

const BUILDERS = {
  globe: () => svg([
    ['circle', { cx: 10, cy: 10, r: 7.5 }],
    ['path', { d: 'M2.5 10h15M10 2.5v15' }],
    ['path', { d: 'M4.2 5.5c1.6 1 4 1.6 5.8 1.6s4.2-.6 5.8-1.6M4.2 14.5c1.6-1 4-1.6 5.8-1.6s4.2.6 5.8 1.6' }],
  ]),
  list: () => svg([
    ['path', { d: 'M7 5h9M7 10h9M7 15h9' }],
    ['path', { d: 'M4 5h.01M4 10h.01M4 15h.01' }],
  ]),
  filter: () => svg([
    ['path', { d: 'M3 5h14M6 10h8M8.5 15h3' }],
  ]),
  sun: () => svg([
    ['circle', { cx: 10, cy: 10, r: 3.6 }],
    ['path', { d: 'M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4' }],
  ]),
  moon: () => svg([
    ['path', { d: 'M16.5 12.3A6.8 6.8 0 1 1 7.7 3.5a5.6 5.6 0 0 0 8.8 8.8Z' }],
  ]),
  plus: () => svg([['path', { d: 'M10 4v12M4 10h12' }]]),
  minus: () => svg([['path', { d: 'M4 10h12' }]]),
  reset: () => svg([
    ['path', { d: 'M15.5 10a5.5 5.5 0 1 1-1.9-4.1' }],
    ['path', { d: 'M15.5 3.5v3.4h-3.4' }],
  ]),
  compass: () => svg([
    ['circle', { cx: 10, cy: 10, r: 7.5 }],
    ['path', { d: 'M12.8 7.2 11 11 7.2 12.8 9 9Z' }],
  ]),
  close: () => svg([['path', { d: 'M5 5l10 10M15 5 5 15' }]]),
  zoom: () => svg([
    ['circle', { cx: 8.5, cy: 8.5, r: 5.5 }],
    ['path', { d: 'M8.5 6v5M6 8.5h5M13 13l4 4' }],
  ]),
  external: () => svg([
    ['path', { d: 'M8 5H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3' }],
    ['path', { d: 'M11 3h6v6M17 3l-8 8' }],
  ]),
  check: () => svg([['path', { d: 'M4 10.5 8 14.5 16 5.5' }]]),
  legend: () => svg([
    ['circle', { cx: 5, cy: 6, r: 1.3, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 5, cy: 10, r: 1.3, fill: 'currentColor', stroke: 'none' }],
    ['circle', { cx: 5, cy: 14, r: 1.3, fill: 'currentColor', stroke: 'none' }],
    ['path', { d: 'M9 6h7M9 10h7M9 14h7' }],
  ]),
};

export function icon(name) {
  const build = BUILDERS[name];
  if (!build) throw new Error(`unknown icon: ${name}`);
  return build();
}
