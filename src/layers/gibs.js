/** THIS FILE DOES: shared NASA GIBS WMS GetMap URL builder used by all base-* layers, ROLE: Data, MAINTAINER NOTE: full-globe EPSG:4326 GetMap confirmed CORS-open live on 2026-09-25; keep WIDTH/HEIGHT at 2048x1024 to match the base render contract. **/

const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

export function gibsGetMapUrl(layerName, date, { format = 'image/jpeg' } = {}) {
  const params = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180', WIDTH: '2048', HEIGHT: '1024', FORMAT: format,
    LAYERS: layerName, TIME: date,
  });
  return `${WMS}?${params.toString()}`;
}

export const GIBS_SOURCE = { org: 'NASA GIBS', domain: 'earthdata.nasa.gov', homepage: 'https://www.earthdata.nasa.gov/gibs', license: 'NASA Earth Science Data (public domain)', trust: 'government' };
