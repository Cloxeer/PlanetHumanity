/** THIS FILE DOES: iso2->flag SVG url/img, ROLE: UI, MAINTAINER NOTE: assets/flags/4x3 vendored (fetch-flags.mjs); tiny, critical path. **/
const RE = /^[a-z]{2}$/i;

export function flagUrl(c) {
  return typeof c === 'string' && RE.test(c) ? `assets/flags/4x3/${c.toLowerCase()}.svg` : null;
}

export function flagImg(c, { w = 16, h = 12, alt = '' } = {}) {
  const n = navigator.connection;
  if (n && (n.saveData || n.effectiveType === 'slow-2g' || n.effectiveType === '2g')) return null;
  const u = flagUrl(c);
  if (!u) return null;
  const img = document.createElement('img');
  Object.assign(img, { src: u, width: w, height: h, alt, loading: 'lazy', decoding: 'async', fetchPriority: 'low', className: 'ph-flag' });
  img.style.cssText = 'border-radius:2px;border:.5px solid var(--hairline)';
  return img;
}
