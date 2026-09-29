/** THIS FILE DOES: Owns every live-data layer's on/off state, fetch/poll lifecycle, filters and persistence, and pushes normalized results onto the globe stage, ROLE: UI, MAINTAINER NOTE: Every stage/legend call is optional-chained (stage?.setX?.()) so the manager runs even if GlobeStage/Legend land late or a method is still missing; never assume the stage API is complete. **/

const STORAGE_KEY = 'ph:layers';

// Sequential, colour-blind-safe 7-stop ramp sampled from Viridis (dark purple -> teal -> yellow).
// Chosen because it reads correctly under deuteranopia/protanopia/tritanopia simulation and has a
// monotonic perceived-lightness gradient, so "darker/lighter" always means "lower/higher value"
// even for a viewer who can't use hue. Values are plain sRGB hex; the globe's bake pipeline (not
// this module) applies the ~55% overlay alpha when painting them onto the sphere.
export const COUNTRY_PALETTE = ['#440154', '#46327e', '#365c8d', '#1fa187', '#4ac16d', '#a0da39', '#fde725'];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function paletteColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const n = COUNTRY_PALETTE.length - 1;
  const pos = clamped * n;
  const i0 = Math.floor(pos);
  const i1 = Math.min(i0 + 1, n);
  const frac = pos - i0;
  const a = hexToRgb(COUNTRY_PALETTE[i0]);
  const b = hexToRgb(COUNTRY_PALETTE[i1]);
  const r = Math.round(a.r + (b.r - a.r) * frac);
  const g = Math.round(a.g + (b.g - a.g) * frac);
  const bl = Math.round(a.b + (b.b - a.b) * frac);
  return `rgb(${r},${g},${bl})`;
}

export function isSlowConnection() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g';
  } catch {
    return false;
  }
}

function readPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writePersisted(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode, quota, disabled): persistence just won't survive reload
  }
}

function defaultFilterValues(layer) {
  const out = {};
  for (const f of layer.filters ?? []) out[f.key] = f.default;
  return out;
}

function countOf(layer, data) {
  switch (layer.render) {
    case 'points': return data.items?.length ?? 0;
    case 'texture': return data.cells?.length ?? 0;
    case 'objects': return data.objects?.length ?? 0;
    case 'icons': return data.items?.length ?? 0;
    case 'country-fill': return data.values?.size ?? 0;
    case 'base': return 1;
    default: return 0;
  }
}

export function createLayerManager({ layers, groups, stage, legend }) {
  const layersArr = layers ?? [];
  const groupsArr = groups ?? [];
  const layersById = new Map(layersArr.map((l) => [l.id, l]));
  const groupsById = new Map(groupsArr.map((g) => [g.id, g]));

  const state = new Map(); // id -> { on, status, count, fetchedAt, error, extra }
  const filterValues = new Map(); // id -> { key: value }
  const lastData = new Map(); // id -> most recent normalized LayerData, for legend re-render
  const controllers = new Map(); // id -> AbortController
  const pollTimers = new Map(); // id -> timeout handle
  const debounceTimers = new Map(); // id -> timeout handle
  const pendingResume = new Set(); // ids whose poll fired while the tab was hidden

  for (const layer of layersArr) {
    state.set(layer.id, { on: false, status: 'idle', count: 0, fetchedAt: null, error: null, extra: null });
    filterValues.set(layer.id, defaultFilterValues(layer));
  }

  const listeners = new Set();
  function emitChange(id) {
    for (const fn of listeners) {
      try { fn({ id }); } catch { /* a subscriber's own bug must not break the manager */ }
    }
  }

  function stateFor(id) {
    return state.get(id);
  }

  function persist() {
    const on = layersArr.filter((l) => state.get(l.id)?.on).map((l) => l.id);
    const filters = {};
    for (const [id, values] of filterValues) if (Object.keys(values).length) filters[id] = values;
    writePersisted({ on, filters });
  }

  function abort(id) {
    controllers.get(id)?.abort();
    controllers.delete(id);
  }

  function clearPoll(id) {
    clearTimeout(pollTimers.get(id));
    pollTimers.delete(id);
    pendingResume.delete(id);
  }

  function schedulePoll(id) {
    const layer = layersById.get(id);
    if (!layer?.refreshMs) return;
    clearPoll(id);
    pollTimers.set(id, setTimeout(() => {
      if (!stateFor(id)?.on) return;
      if (document.hidden) { pendingResume.add(id); return; }
      loadLayer(id, { isPoll: true });
    }, layer.refreshMs));
  }

  function baseImageFromData(id, data) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (stateFor(id)?.on) stage?.setBaseImage?.(img); };
    img.src = data.imageUrl;
  }

  function applyCountryFill(id, data) {
    lastData.set(id, data);
    const span = (data.max - data.min) || 1;
    const colors = new Map();
    for (const [iso2, v] of data.values) {
      let t = (v - data.min) / span;
      if (data.higherIsBetter === false) t = 1 - t;
      colors.set(iso2, paletteColor(t));
    }
    stage?.setCountryFill?.(colors);
    updateLegendSections();
  }

  function applyData(id, layer, data) {
    switch (layer.render) {
      case 'base':
        baseImageFromData(id, data);
        break;
      case 'points':
        lastData.set(id, data);
        stage?.setLayerPoints?.(id, data.items ?? []);
        break;
      case 'texture':
        lastData.set(id, data);
        stage?.setTextureOverlay?.(id, { cells: data.cells ?? [], color: data.color });
        updateLegendSections();
        break;
      case 'objects':
        lastData.set(id, data);
        stage?.setObjects?.(id, { objects: data.objects ?? [], positionAt: data.positionAt, track: data.track });
        break;
      case 'icons':
        lastData.set(id, data);
        stage?.setLayerIcons?.(id, data.items ?? []);
        break;
      case 'country-fill':
        applyCountryFill(id, data);
        break;
      default:
        break;
    }
  }

  function teardownStageData(id, layer) {
    switch (layer.render) {
      case 'points': stage?.setLayerPoints?.(id, null); break;
      case 'texture': stage?.setTextureOverlay?.(id, null); updateLegendSections(); break;
      case 'objects': stage?.setObjects?.(id, null); break;
      case 'icons': stage?.setLayerIcons?.(id, null); break;
      case 'country-fill': stage?.setCountryFill?.(null); lastData.delete(id); updateLegendSections(); break;
      default: break;
    }
  }

  function updateLegendSections() {
    if (!legend?.setExtraSections) return;
    const sections = [];
    for (const layer of layersArr) {
      const st = stateFor(layer.id);
      if (!st?.on || st.status !== 'ok') continue;
      if (layer.render === 'country-fill') {
        const data = lastData.get(layer.id);
        if (!data) continue;
        const fmt = (v) => (typeof data.format === 'function' ? data.format(v) : String(v));
        const stops = data.higherIsBetter === false ? [...COUNTRY_PALETTE].reverse() : COUNTRY_PALETTE;
        sections.push({
          title: layer.title,
          items: [{ label: `${fmt(data.min)} – ${fmt(data.max)}${data.unit ? ` ${data.unit}` : ''}`, shape: 'gradient', stops }],
        });
      } else if (layer.legend?.length) {
        sections.push({ title: layer.title, items: layer.legend });
      }
    }
    legend.setExtraSections(sections);
  }

  async function loadLayer(id, { isPoll = false } = {}) {
    const layer = layersById.get(id);
    const st = stateFor(id);
    if (!layer || !st?.on) return;
    abort(id);
    const controller = new AbortController();
    controllers.set(id, controller);
    if (!isPoll) { st.status = 'loading'; st.error = null; emitChange(id); }
    try {
      const data = await layer.load(filterValues.get(id) ?? {}, { signal: controller.signal });
      if (controller.signal.aborted || !stateFor(id)?.on) return;
      applyData(id, layer, data);
      st.status = 'ok';
      st.count = countOf(layer, data);
      st.fetchedAt = data.fetchedAt ?? Date.now();
      st.extra = data.extra ?? null;
      st.skipped = data.skipped ?? 0;
      st.error = null;
    } catch (err) {
      if (controller.signal.aborted || !stateFor(id)?.on) return;
      st.status = 'error';
      st.error = String(err?.message ?? err);
    }
    emitChange(id);
    persist();
    schedulePoll(id);
  }

  function enable(id, { fromRestore = false, silent = false } = {}) {
    const layer = layersById.get(id);
    if (!layer) return;
    const group = groupsById.get(layer.group);
    if (group?.exclusive) {
      for (const other of layersArr) {
        if (other.group === layer.group && other.id !== id && stateFor(other.id)?.on) disable(other.id, { silent: true });
      }
    }
    const st = stateFor(id);
    st.on = true;
    if (fromRestore && isSlowConnection()) {
      st.status = 'paused-slow';
      if (!silent) emitChange(id);
      return;
    }
    st.status = 'loading';
    if (!silent) emitChange(id);
    loadLayer(id);
    if (!fromRestore && !silent) persist();
  }

  function disable(id, { silent = false } = {}) {
    const layer = layersById.get(id);
    const st = stateFor(id);
    if (!layer || !st?.on) return;
    st.on = false;
    st.status = 'idle';
    st.count = 0;
    st.error = null;
    st.fetchedAt = null;
    st.extra = null;
    clearPoll(id);
    clearTimeout(debounceTimers.get(id));
    debounceTimers.delete(id);
    abort(id);
    teardownStageData(id, layer);
    if (!silent) { emitChange(id); persist(); }
  }

  function disableAll() {
    for (const layer of layersArr) {
      if (layer.group !== 'base' && stateFor(layer.id)?.on) disable(layer.id, { silent: true });
    }
    const baseLayers = layersArr.filter((l) => l.group === 'base');
    const defaultBase = baseLayers[0];
    const currentBase = baseLayers.find((l) => stateFor(l.id)?.on);
    if (defaultBase && currentBase && currentBase.id !== defaultBase.id) {
      disable(currentBase.id, { silent: true });
      enable(defaultBase.id, { silent: true });
    }
    emitChange();
    persist();
  }

  function setFilter(id, key, value) {
    const layer = layersById.get(id);
    if (!layer) return;
    const fv = filterValues.get(id) ?? {};
    fv[key] = value;
    filterValues.set(id, fv);
    persist();
    if (stateFor(id)?.on) {
      clearTimeout(debounceTimers.get(id));
      debounceTimers.set(id, setTimeout(() => loadLayer(id), 300));
    }
    emitChange(id);
  }

  function getFilterValues(id) {
    return { ...(filterValues.get(id) ?? {}) };
  }

  function on(event, fn) {
    if (event !== 'change') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function onVisibilityChange() {
    if (document.hidden) return;
    for (const id of [...pendingResume]) {
      pendingResume.delete(id);
      if (stateFor(id)?.on) loadLayer(id, { isPoll: true });
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  function restore() {
    const saved = readPersisted();
    if (!saved) return;
    for (const [id, values] of Object.entries(saved.filters ?? {})) {
      if (layersById.has(id)) filterValues.set(id, { ...filterValues.get(id), ...values });
    }
    for (const id of saved.on ?? []) {
      if (layersById.has(id)) enable(id, { fromRestore: true, silent: true });
    }
    emitChange();
  }

  restore();

  function destroy() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    for (const id of controllers.keys()) abort(id);
    for (const t of pollTimers.values()) clearTimeout(t);
    for (const t of debounceTimers.values()) clearTimeout(t);
    listeners.clear();
  }

  return {
    enable,
    disable,
    setFilter,
    getFilterValues,
    disableAll,
    get state() {
      const out = {};
      for (const [id, s] of state) out[id] = { ...s };
      return out;
    },
    on,
    destroy,
  };
}
