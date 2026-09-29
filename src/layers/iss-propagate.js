/** THIS FILE DOES: pure ECI(J2000)->lat/lng/alt propagation math for the ISS ephemeris, ROLE: Data, MAINTAINER NOTE: GMST-only rotation (no precession/nutation) per contract "no library"; error over a 15-day OEM span is well under a display pixel at globe scale. **/

const EARTH_RADIUS_KM = 6371;

// IAU 1982 GMST approximation from Julian date (good to ~0.1s over decades).
export function gmstRad(dateMs) {
  const jd = dateMs / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  let deg = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000;
  deg = ((deg % 360) + 360) % 360;
  return (deg * Math.PI) / 180;
}

// Cubic Hermite interpolation of position between two OEM state vectors (km, km/s).
function hermite(p0, v0, p1, v1, dtSec, sSec) {
  const s = sSec / dtSec;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return [0, 1, 2].map((i) => h00 * p0[i] + h10 * dtSec * v0[i] + h01 * p1[i] + h11 * dtSec * v1[i]);
}

// records: [{ t: msEpoch, r: [x,y,z] km (ECI/EME2000), v: [vx,vy,vz] km/s }], time-ascending.
export function interpolateEci(records, tMs) {
  if (!records.length) return null;
  if (tMs <= records[0].t) return records[0];
  if (tMs >= records[records.length - 1].t) return records[records.length - 1];
  let lo = 0, hi = records.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (records[mid].t <= tMs) lo = mid; else hi = mid;
  }
  const a = records[lo], b = records[hi];
  const dtSec = (b.t - a.t) / 1000;
  const sSec = (tMs - a.t) / 1000;
  const r = hermite(a.r, a.v, b.r, b.v, dtSec, sSec);
  return { t: tMs, r };
}

// ECI (Earth-centered inertial, treated as ~ECEF-aligned-at-epoch via GMST) -> geodetic (spherical approx).
export function eciToLatLngAlt(r, tMs) {
  const theta = gmstRad(tMs);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const xEcef = r[0] * cos + r[1] * sin;
  const yEcef = -r[0] * sin + r[1] * cos;
  const zEcef = r[2];
  const radius = Math.sqrt(xEcef * xEcef + yEcef * yEcef + zEcef * zEcef);
  const lat = (Math.asin(zEcef / radius) * 180) / Math.PI;
  const lng = (Math.atan2(yEcef, xEcef) * 180) / Math.PI;
  return { lat, lng, altKm: radius - EARTH_RADIUS_KM };
}
