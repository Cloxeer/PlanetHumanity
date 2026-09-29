/** THIS FILE DOES: Map settings/zoom/reset/legend/compass overlay for the globe plus keyboard rotation on its container, ROLE: UI, MAINTAINER NOTE: root is the same element passed to createGlobeStage as its container; controls are absolutely positioned inside it. **/
import { icon } from './icons.js';
import { createLegend } from './Legend.js';

// icons.js is owned by SHELL, not GLOBE, so the gear glyph is built locally here.
function gearIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const svg = el('svg', { viewBox: '0 0 20 20', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  svg.append(
    el('circle', { cx: '10', cy: '10', r: '2.8' }),
    el('path', { d: 'M10 2.2v2.4M10 15.4v2.4M2.2 10h2.4M15.4 10h2.4M4.6 4.6l1.7 1.7M13.7 13.7l1.7 1.7M4.6 15.4l1.7-1.7M13.7 6.3l1.7-1.7' }),
  );
  return svg;
}

const ROTATE_STEP_DEG = 10;
const MAX_LAT = 85; // stay short of the poles where lng becomes degenerate
const NORTH_DEG_EPSILON = 0.1; // skip the DOM write below this angle delta: the needle updates every view tick

// Classic two-tone needle: red tip points to geographic north, "N" rides with it.
function compassNeedle() {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const svg = el('svg', { viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true' });
  svg.append(
    el('path', { d: 'M12 4 L15 12 L9 12 Z', fill: '#FF3B30' }),
    el('path', { d: 'M12 20 L9 12 L15 12 Z', fill: 'currentColor', opacity: '0.45' }),
    el('circle', { cx: '12', cy: '12', r: '1.4', fill: 'currentColor' }),
  );
  return svg;
}

export function createGlobeControls(root, stage, { theme } = {}) {
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  root.setAttribute('tabindex', '0');
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'Interactive globe. Arrow keys rotate, plus and minus zoom, 0 resets.');

  const stack = document.createElement('div');
  stack.className = 'ph-globe-controls';

  function iconButton(name, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ph-control-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.appendChild(icon(name));
    btn.addEventListener('click', onClick);
    return btn;
  }

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'ph-control-btn';
  settingsBtn.title = 'Map settings';
  settingsBtn.setAttribute('aria-label', 'Map settings');
  settingsBtn.appendChild(gearIcon());
  settingsBtn.addEventListener('click', () => settings.toggle());
  // SettingsPopover is imported on first use (the gear), keeping it off the globe's initial download.
  let popover = null;
  let popoverPromise = null;
  function withPopover(fn) {
    popoverPromise ??= import('./SettingsPopover.js').then(({ createSettingsPopover }) => { popover = createSettingsPopover(settingsBtn, { theme, placement: 'left' }); return popover; });
    return popoverPromise.then(fn);
  }
  const settings = {
    open: () => withPopover((p) => p.open()),
    close: () => popover?.close(),
    toggle: () => withPopover((p) => p.toggle()),
    sync: () => popover?.sync(),
    destroy: () => popover?.destroy(),
  };

  const legendBtn = iconButton('legend', 'Legend', () => legend.toggle());
  const zoomInBtn = iconButton('plus', 'Zoom in', () => stage.zoomIn());
  const zoomOutBtn = iconButton('minus', 'Zoom out', () => stage.zoomOut());
  const resetBtn = iconButton('reset', 'Reset view', () => stage.resetView());

  const compass = document.createElement('button');
  compass.type = 'button';
  compass.className = 'ph-compass';
  compass.title = 'Compass: click to face north and reset';
  compass.setAttribute('aria-label', 'Compass. Reset view to north');
  const needle = document.createElement('span');
  needle.className = 'ph-compass-needle';
  needle.appendChild(compassNeedle());
  const caption = document.createElement('span');
  caption.className = 'ph-compass-caption';
  compass.append(needle, caption);
  compass.addEventListener('click', () => stage.resetView());

  stack.append(settingsBtn, legendBtn, zoomInBtn, zoomOutBtn, resetBtn, compass);
  root.appendChild(stack);

  // stage.categoryCounts is a small internal-only helper (same file owner wires the legend end to
  // end); re-read live each time the popover opens so counts never go stale.
  const legend = createLegend(legendBtn, { counts: () => stage.categoryCounts?.() ?? new Map() });

  function formatCaption(view) {
    const ns = view.lat >= 0 ? 'N' : 'S';
    const ew = view.lng >= 0 ? 'E' : 'W';
    return `${Math.abs(view.lat).toFixed(1)}°${ns} ${Math.abs(view.lng).toFixed(1)}°${ew}`;
  }

  // No CSS transition drives the needle: it is written every view-change tick so it tracks the
  // globe with zero lag (a transition was the old spazzing bug's other half - it fought the
  // continuous updates and animated the "wrong way" across the 359deg -> 0deg wrap).
  let lastNorth = null;
  let lastCaption = null;
  function render(view) {
    const captionText = formatCaption(view);
    if (lastNorth !== null && Math.abs(view.northDeg - lastNorth) < NORTH_DEG_EPSILON && captionText === lastCaption) return;
    lastNorth = view.northDeg;
    lastCaption = captionText;
    needle.style.transform = `rotate(${view.northDeg}deg)`;
    caption.textContent = captionText;
  }

  render(stage.getView());
  const offView = stage.onViewChange(render);

  function clampLat(lat) {
    return Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
  }

  function onKeydown(e) {
    const view = stage.getView();
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        stage.setView?.({ lat: view.lat, lng: view.lng - ROTATE_STEP_DEG });
        break;
      case 'ArrowRight':
        e.preventDefault();
        stage.setView?.({ lat: view.lat, lng: view.lng + ROTATE_STEP_DEG });
        break;
      case 'ArrowUp':
        e.preventDefault();
        stage.setView?.({ lat: clampLat(view.lat + ROTATE_STEP_DEG), lng: view.lng });
        break;
      case 'ArrowDown':
        e.preventDefault();
        stage.setView?.({ lat: clampLat(view.lat - ROTATE_STEP_DEG), lng: view.lng });
        break;
      case '+':
      case '=':
        e.preventDefault();
        stage.zoomIn();
        break;
      case '-':
        e.preventDefault();
        stage.zoomOut();
        break;
      case '0':
      case 'Home':
        e.preventDefault();
        stage.resetView();
        break;
      default:
        break;
    }
  }
  root.addEventListener('keydown', onKeydown);

  function destroy() {
    legend.destroy();
    settings.destroy();
    offView();
    root.removeEventListener('keydown', onKeydown);
    root.removeAttribute('tabindex');
    root.removeAttribute('role');
    root.removeAttribute('aria-label');
    stack.remove();
  }

  return { destroy, legend, settings };
}
