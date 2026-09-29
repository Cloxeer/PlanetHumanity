/** THIS FILE DOES: aggregates every layer module into LAYER_GROUPS + LAYERS, ROLE: Data, MAINTAINER NOTE: this is the only place that imports every layer; LayerManager/LayersPanel import from here, never from individual layer files. **/

import { baseClassic } from './base-classic.js';
import { baseToday } from './base-today.js';
import { baseNight } from './base-night.js';
import { baseSmoke } from './base-smoke.js';
import { baseSst } from './base-sst.js';
import { quakes } from './quakes.js';
import { eonet } from './eonet.js';
import { aurora } from './aurora.js';
import { iss } from './iss.js';
import { outbreaks } from './outbreaks.js';
import { trials } from './trials.js';
import { wbLifeExp, wbU5Mort, wbHealthExp, wbPhysicians } from './worldbank.js';

export const LAYER_GROUPS = [
  { id: 'base', title: 'Base map', exclusive: true, allowNone: false },
  { id: 'events', title: 'Live Earth events' },
  { id: 'health', title: 'Health' },
  { id: 'space', title: 'Space' },
  { id: 'country', title: 'Health by country', exclusive: true, allowNone: true },
];

export const LAYERS = [
  baseClassic, baseToday, baseNight, baseSmoke, baseSst,
  quakes, eonet,
  aurora, iss,
  outbreaks, trials,
  wbLifeExp, wbU5Mort, wbHealthExp, wbPhysicians,
];
