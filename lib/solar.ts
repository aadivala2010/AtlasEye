/** Solar position and day/night terminator geometry. Accurate to ~0.1°, plenty for a globe. */

const RAD = Math.PI / 180;

export interface SunPoint { lat: number; lon: number }

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The point on Earth where the sun is directly overhead. */
export function subsolarPoint(date: Date): SunPoint {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  return { lat: dec, lon: wrapLon(ra - gmst * 15) };
}

/** Sun altitude in degrees at a location. Negative = below the horizon. */
export function sunAltitude(lat: number, lon: number, sun: SunPoint): number {
  const s = Math.sin(lat * RAD) * Math.sin(sun.lat * RAD)
    + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/**
 * Polygon of everywhere the sun is more than `depression`° below the horizon:
 * a spherical cap of radius 90° − depression around the anti-solar point.
 */
function nightCap(sun: SunPoint, depression: number): GeoJSON.Position[] {
  const cLat = -sun.lat * RAD;
  const cLon = wrapLon(sun.lon + 180) * RAD;
  const r = (90 - depression) * RAD;
  const ring: GeoJSON.Position[] = [];
  for (let b = 0; b < 360; b += 2) {
    const t = b * RAD;
    const lat = Math.asin(Math.sin(cLat) * Math.cos(r) + Math.cos(cLat) * Math.sin(r) * Math.cos(t));
    const lon = cLon + Math.atan2(Math.sin(t) * Math.sin(r) * Math.cos(cLat), Math.cos(r) - Math.sin(cLat) * Math.sin(lat));
    ring.push([lon / RAD, lat / RAD]);
  }

  const poleLat = sun.lat > 0 ? -90 : 90; // the pole in darkness
  const containsPole = 90 - Math.abs(sun.lat) < 90 - depression;
  if (containsPole) {
    // The cap wraps all the way around: sort by longitude and close it over the dark pole.
    const pts = ring.map(([lon, lat]) => [wrapLon(lon), lat]).sort((a, b) => a[0] - b[0]);
    const [first, last] = [pts[0], pts[pts.length - 1]];
    const span = first[0] + 360 - last[0];
    const seamLat = last[1] + ((first[1] - last[1]) * (180 - last[0])) / span;
    return [[-180, seamLat], ...pts, [180, seamLat], [180, poleLat], [-180, poleLat], [-180, seamLat]];
  }
  // Otherwise keep longitudes continuous (may exceed ±180; the renderer wraps them).
  for (let i = 1; i < ring.length; i++) {
    while (ring[i][0] - ring[i - 1][0] > 180) ring[i][0] -= 360;
    while (ring[i][0] - ring[i - 1][0] < -180) ring[i][0] += 360;
  }
  return [...ring, ring[0]];
}

/** Stacked twilight bands every 2° from 0° to 18° — overlapping low-opacity fills read as a soft shadow. */
export function nightBands(date: Date): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const sun = subsolarPoint(date);
  // At the exact equinox the terminator passes through both poles; nudge off the degenerate case.
  if (Math.abs(sun.lat) < 0.01) sun.lat = 0.01;
  return {
    type: 'FeatureCollection',
    features: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18].map((depression) => ({
      type: 'Feature',
      properties: { depression },
      geometry: { type: 'Polygon', coordinates: [nightCap(sun, depression)] },
    })),
  };
}
