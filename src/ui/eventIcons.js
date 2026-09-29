/** THIS FILE DOES: Builds small inline SVG glyphs for natural-event layer markers (wildfire, storm, quake, ...), ROLE: UI, MAINTAINER NOTE: 24-viewBox, currentColor stroke/fill so the chip's text color drives it; add a new case here (plus the EONET category map in src/layers/eonet.js) when a new event category shows up. **/
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function base(children) {
  const svg = el('svg', {
    viewBox: '0 0 24 24', width: '22', height: '22',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  for (const c of children) svg.appendChild(c);
  return svg;
}

const BUILDERS = {
  wildfire: () => base([
    el('path', { d: 'M12 2.5c1 3-2.5 4-2.5 7a2.5 2.5 0 0 0 5 0c0-1-1-1.5-1-2.5 1.5 1 2.5 3 2.5 5a4.5 4.5 0 0 1-9 0c0-4.5 3.5-5.5 5-9.5Z', fill: 'currentColor', stroke: 'none' }),
  ]),
  storm: () => base([
    el('circle', { cx: '12', cy: '12', r: '1.8', fill: 'currentColor', stroke: 'none' }),
    el('path', { d: 'M12 12C8.5 10.5 7 7 8.5 4' }),
    el('path', { d: 'M12 12c3.5 1.5 5 5 3.5 8' }),
  ]),
  volcano: () => base([
    el('path', { d: 'M4 19h16L15 7l-2 3-2-5-3 6-2 8Z', fill: 'currentColor', stroke: 'none' }),
    el('path', { d: 'M13 5c.8-1 .8-2 0-3M16 6c1-.8 1.3-1.8 1-3' }),
  ]),
  flood: () => base([
    el('path', { d: 'M2 9.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0' }),
    el('path', { d: 'M2 15c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0' }),
    el('path', { d: 'M2 20h20' }),
  ]),
  ice: () => base([
    el('path', { d: 'M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11' }),
  ]),
  drought: () => base([
    el('circle', { cx: '12', cy: '12', r: '4.2' }),
    el('path', { d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' }),
  ]),
  dust: () => base([
    el('path', { d: 'M3 7h13a2.3 2.3 0 1 0-2.1-3.4' }),
    el('path', { d: 'M3 12h16a2.3 2.3 0 1 1-2.1 3.4' }),
    el('path', { d: 'M3 17h10' }),
  ]),
  landslide: () => base([
    el('path', { d: 'M2 18 9 6l4 6 2-3 7 9Z', fill: 'currentColor', stroke: 'none' }),
    el('path', { d: 'M2 18h20' }),
  ]),
  snow: () => base([
    el('path', { d: 'M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11' }),
    el('path', { d: 'M12 6 9.6 4M12 6l2.4-2M12 18l-2.4 2M12 18l2.4 2' }),
  ]),
  heat: () => base([
    el('rect', { x: '10', y: '3', width: '4', height: '12', rx: '2' }),
    el('circle', { cx: '12', cy: '18', r: '3', fill: 'currentColor' }),
  ]),
  quake: () => base([
    el('circle', { cx: '12', cy: '12', r: '2', fill: 'currentColor', stroke: 'none' }),
    el('circle', { cx: '12', cy: '12', r: '5.2' }),
    el('circle', { cx: '12', cy: '12', r: '8.6' }),
  ]),
  outbreak: () => base([
    el('circle', { cx: '12', cy: '12', r: '4' }),
    el('circle', { cx: '12', cy: '12', r: '1.4', fill: 'currentColor', stroke: 'none' }),
    el('path', { d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' }),
  ]),
  trial: () => base([
    el('path', { d: 'M9 2.5h6M10 2.5v6L5 19a1.5 1.5 0 0 0 1.4 2h11.2a1.5 1.5 0 0 0 1.4-2L14 8.5v-6' }),
    el('path', { d: 'M7.5 14.5h9' }),
  ]),
  default: () => base([
    el('circle', { cx: '12', cy: '12', r: '4', fill: 'currentColor', stroke: 'none' }),
  ]),
};

export function eventIcon(name) {
  const build = BUILDERS[name] ?? BUILDERS.default;
  return build();
}
