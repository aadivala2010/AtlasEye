/** Solar position. Accurate to ~0.1°, plenty for a globe. */

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

