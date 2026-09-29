/** THIS FILE DOES: "smoke & haze" aerosol optical depth base layer from NASA GIBS, ROLE: Data, MAINTAINER NOTE: MODIS_Combined_Value_Added_AOD (Aqua+Terra combined) confirmed live with PNG (alpha over base) on 2026-09-25. **/

import { gibsGetMapUrl, GIBS_SOURCE } from './gibs.js';
import { latestCompleteUtcDay } from './util.js';

export const baseSmoke = {
  id: 'base-smoke',
  group: 'base',
  title: 'Smoke & haze',
  description: 'Combined MODIS aerosol optical depth: wildfire smoke, dust and haze.',
  source: GIBS_SOURCE,
  render: 'base',
  approxBytes: 115000,
  refreshMs: null,
  filters: [],
  legend: [],
  async load(_filters, { signal } = {}) {
    const date = latestCompleteUtcDay();
    const imageUrl = gibsGetMapUrl('MODIS_Combined_Value_Added_AOD', date, { format: 'image/png' });
    const res = await fetch(imageUrl, { signal });
    if (!res.ok) throw new Error(`GIBS AOD -> HTTP ${res.status}`);
    return { imageUrl, width: 2048, height: 1024, date, attribution: 'NASA GIBS / MODIS Combined AOD' };
  },
};
