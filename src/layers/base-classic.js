/** THIS FILE DOES: the bundled default base map layer (no fetch), ROLE: Data, MAINTAINER NOTE: the only layer whose load() never touches the network; keeps 3G-law compliant by construction. **/

export const baseClassic = {
  id: 'base-classic',
  group: 'base',
  title: 'Classic',
  description: 'The default Earth texture, bundled with the app.',
  source: { org: 'humanity-catalog', domain: 'nasa.gov', homepage: 'https://visibleearth.nasa.gov/', license: 'NASA Visible Earth (public domain)', trust: 'government' },
  render: 'base',
  approxBytes: 0,
  refreshMs: null,
  filters: [],
  legend: [],
  async load() {
    return { imageUrl: 'data/geo/earth-day.jpg', width: 2048, height: 1024, date: null, attribution: 'NASA Visible Earth' };
  },
};
