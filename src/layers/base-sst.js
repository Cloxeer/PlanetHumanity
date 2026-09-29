/** THIS FILE DOES: "ocean temperature" sea surface temperature base layer from NASA GIBS, ROLE: Data, MAINTAINER NOTE: GHRSST_L4_MUR_Sea_Surface_Temperature confirmed live PNG on 2026-09-25. **/

import { gibsGetMapUrl, GIBS_SOURCE } from './gibs.js';
import { latestCompleteUtcDay } from './util.js';

export const baseSst = {
  id: 'base-sst',
  group: 'base',
  title: 'Ocean temperature',
  description: 'Global sea surface temperature (GHRSST Multi-scale Ultra-high Resolution analysis).',
  source: GIBS_SOURCE,
  render: 'base',
  approxBytes: 770000,
  refreshMs: null,
  filters: [],
  legend: [],
  async load(_filters, { signal } = {}) {
    const date = latestCompleteUtcDay();
    const imageUrl = gibsGetMapUrl('GHRSST_L4_MUR_Sea_Surface_Temperature', date, { format: 'image/png' });
    const res = await fetch(imageUrl, { signal });
    if (!res.ok) throw new Error(`GIBS SST -> HTTP ${res.status}`);
    return { imageUrl, width: 2048, height: 1024, date, attribution: 'NASA GIBS / GHRSST MUR' };
  },
};
