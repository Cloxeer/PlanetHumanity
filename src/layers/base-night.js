/** THIS FILE DOES: "night lights" base layer from NASA GIBS, ROLE: Data, MAINTAINER NOTE: VIIRS_SNPP_DayNightBand confirmed live on 2026-09-25 (no dedicated Black-Marble-labeled layer exists in GetCapabilities; DayNightBand is GIBS's closest daily night imagery). **/

import { gibsGetMapUrl, GIBS_SOURCE } from './gibs.js';
import { latestCompleteUtcDay } from './util.js';

export const baseNight = {
  id: 'base-night',
  group: 'base',
  title: 'Night lights',
  description: 'City lights and moonlit clouds from the VIIRS day/night band.',
  source: GIBS_SOURCE,
  render: 'base',
  approxBytes: 450000,
  refreshMs: null,
  filters: [],
  legend: [],
  async load(_filters, { signal } = {}) {
    const date = latestCompleteUtcDay();
    const imageUrl = gibsGetMapUrl('VIIRS_SNPP_DayNightBand', date);
    const res = await fetch(imageUrl, { signal });
    if (!res.ok) throw new Error(`GIBS DayNightBand -> HTTP ${res.status}`);
    return { imageUrl, width: 2048, height: 1024, date, attribution: 'NASA GIBS / VIIRS SNPP Day/Night Band' };
  },
};
