/** THIS FILE DOES: "yesterday from space" true-color base layer from NASA GIBS, ROLE: Data, MAINTAINER NOTE: VIIRS_NOAA20_CorrectedReflectance_TrueColor confirmed live with real imagery bytes at T-1 day on 2026-09-25. **/

import { gibsGetMapUrl, GIBS_SOURCE } from './gibs.js';
import { latestCompleteUtcDay } from './util.js';

export const baseToday = {
  id: 'base-today',
  group: 'base',
  title: 'Yesterday from space',
  description: 'True-color satellite view of Earth from the latest complete day.',
  source: GIBS_SOURCE,
  render: 'base',
  approxBytes: 600000,
  refreshMs: null,
  filters: [],
  legend: [],
  async load(_filters, { signal } = {}) {
    const date = latestCompleteUtcDay();
    const imageUrl = gibsGetMapUrl('VIIRS_NOAA20_CorrectedReflectance_TrueColor', date);
    // fetch eagerly so load errors surface to LayerManager rather than the <img> tag.
    const res = await fetch(imageUrl, { signal });
    if (!res.ok) throw new Error(`GIBS TrueColor -> HTTP ${res.status}`);
    return { imageUrl, width: 2048, height: 1024, date, attribution: 'NASA GIBS / VIIRS NOAA-20' };
  },
};
