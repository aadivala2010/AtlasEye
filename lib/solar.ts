/** Solar position and day/night terminator geometry. Accurate to ~0.1°, plenty for a globe. */

const RAD = Math.PI / 180;

export interface SunPoint { lat: number; lon: number }

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * A pole itself has no Mercator position — y runs to infinity there — and a polygon vertex at ±90
 * renders as a wedge radiating from the pole. Everything short of it projects finitely, so stop
 * just shy: near enough that the gap is far inside one pixel, far enough to stay finite.
 * (Web Mercator's better-known ±85.0511° limit is where the *tile grid* stops, not the geometry.
 * Clamping polygons to it leaves the cap above unshaded — a bright disc centred on the pole.)
 */
export const POLE_LIMIT_LAT = 89.99;
const clampLat = (lat: number) => Math.max(-POLE_LIMIT_LAT, Math.min(POLE_LIMIT_LAT, lat));

/**
 * Bearing step round each cap. A boundary that passes close to a pole sweeps ~180° of longitude in
 * a fraction of a degree of arc, so a coarse step turns it into a few long chords: at 2° the bands
 * near the pole scallop and bulge visibly. 0.5° traces it as a curve, and is indistinguishable from
 * evaluating sun altitude per pixel.
 */
const BEARING_STEP = 0.5;
/** Points along the pole's parallel when closing a wrapping cap — one lap, kept short-chorded. */
const POLE_SEAM_STEPS = 64;

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
  // Inclusive of 360: that repeat of the first point is what carries a cap circling a pole through
  // its last arc, so its longitude drift comes out as exactly one turn rather than falling short.
  for (let b = 0; b <= 360; b += BEARING_STEP) {
    const t = b * RAD;
    const lat = Math.asin(Math.sin(cLat) * Math.cos(r) + Math.cos(cLat) * Math.sin(r) * Math.cos(t));
    const lon = cLon + Math.atan2(Math.sin(t) * Math.sin(r) * Math.cos(cLat), Math.cos(r) - Math.sin(cLat) * Math.sin(lat));
    ring.push([lon / RAD, lat / RAD]);
  }

  // Keep longitudes continuous, so the ring reads as one curve rather than jumping ±360 at the
  // antimeridian. They may end up outside ±180; the renderer wraps them.
  for (let i = 1; i < ring.length; i++) {
    while (ring[i][0] - ring[i - 1][0] > 180) ring[i][0] -= 360;
    while (ring[i][0] - ring[i - 1][0] < -180) ring[i][0] += 360;
  }
  for (const p of ring) p[1] = clampLat(p[1]);

  const containsPole = 90 - Math.abs(sun.lat) < 90 - depression;
  if (!containsPole) return ring; // already closed: the b=360 sample repeats the b=0 one

  /*
   * The cap wraps all the way around, so the ring circles the pole once and its longitude has
   * drifted a full turn. Close it over the dark pole by walking along the pole's parallel from
   * where the ring ended back to where it started.
   *
   * Emphatically not by sorting the ring by longitude, which is what used to happen: that assumes
   * longitude increases along the ring, and near an equinox it does not. The shallowest cap is
   * then a hemisphere whose boundary is a great circle passing within a degree or two of the pole
   * — nearly a pair of meridians — so hundreds of points share a longitude and the sort orders
   * them arbitrarily in latitude. The result is a zigzag that renders as a wedge radiating from
   * the pole, for the few weeks either side of each equinox.
   */
  const poleLat = sun.lat > 0 ? -POLE_LIMIT_LAT : POLE_LIMIT_LAT; // the pole in darkness
  // The ring's ends are the same place a turn apart, so walking between their longitudes along the
  // pole's parallel is exactly one lap, and encloses the cap.
  const from = ring[ring.length - 1][0];
  const to = ring[0][0];
  const seam: GeoJSON.Position[] = [];
  for (let i = 0; i <= POLE_SEAM_STEPS; i++) seam.push([from + ((to - from) * i) / POLE_SEAM_STEPS, poleLat]);
  return [...ring, ...seam, ring[0]];
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
