import { useEffect, useState } from 'react';
import { eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';

/** Everything in orbit CelesTrak lists as active (~16,600 objects, ~11,000 of them Starlink), by SGP4. */

export type SatGroup = 'station' | 'starlink' | 'gnss' | 'geo' | 'other';

export interface Sat {
  /** NORAD catalogue number. */
  id: number;
  name: string;
  /** International designator (launch year, number, piece): "98067A". */
  intl: string;
  group: SatGroup;
  rec: SatRec;
}

export interface SatPos { lat: number; lon: number; alt: number; speed: number }

export const ISS = 25544;
export const EARTH_KM = 6371;
const RAD = Math.PI / 180;

export const GROUP_LABEL: Record<SatGroup, string> = {
  station: 'Space station', starlink: 'Starlink', gnss: 'Navigation', geo: 'Geostationary', other: 'Satellite',
};

/** Revolutions per day, from SGP4's mean motion (radians per minute). */
export const revsPerDay = (rec: SatRec) => (rec.no * 1440) / (2 * Math.PI);

export function groupOf(name: string, rec: SatRec): SatGroup {
  if (/^(ISS \(ZARYA\)|CSS \(TIANHE\))/.test(name)) return 'station';
  if (name.startsWith('STARLINK')) return 'starlink';
  if (/NAVSTAR|GPS |GLONASS|GALILEO|BEIDOU|QZS|IRNSS|NAVIC/.test(name)) return 'gnss';
  if (Math.abs(revsPerDay(rec) - 1) < 0.05) return 'geo';
  return 'other';
}

/** CelesTrak's three-line sets → satellites; anything SGP4 rejects is skipped. */
export function parseTle(text: string): Sat[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out: Sat[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const [name, l1, l2] = [lines[i].trim(), lines[i + 1], lines[i + 2]];
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) { i -= 2; continue; } // resync on a stray line
    try {
      const rec = twoline2satrec(l1, l2);
      if (rec.error) continue;
      out.push({ id: Number(l1.slice(2, 7)), name, intl: l1.slice(9, 17).trim(), group: groupOf(name, rec), rec });
    } catch { /* malformed set */ }
  }
  return out;
}

/** Where one satellite is at `date` (sub-satellite point, km above the ellipsoid, km/s); null if SGP4 gives up. */
export function subpoint(sat: Sat, date: Date, gmst = gstime(date)): SatPos | null {
  // Typed as always an answer, but SGP4 gives null for an orbit it can't carry (decayed, bad elements).
  const pv = propagate(sat.rec, date) as ReturnType<typeof propagate> | null;
  if (!pv) return null;
  const g = eciToGeodetic(pv.position, gmst);
  if (!Number.isFinite(g.latitude)) return null;
  const v = pv.velocity;
  return { lat: g.latitude / RAD, lon: g.longitude / RAD, alt: g.height, speed: Math.hypot(v.x, v.y, v.z) };
}

/** Every satellite's position at `date`, as a flat [lat, lon, alt, …] (NaN where SGP4 fails). ~30 ms for all. */
export function positions(sats: Sat[], date: Date): Float64Array {
  const gmst = gstime(date);
  const out = new Float64Array(sats.length * 3).fill(NaN);
  for (let i = 0; i < sats.length; i++) {
    const p = subpoint(sats[i], date, gmst);
    if (p) { out[3 * i] = p.lat; out[3 * i + 1] = p.lon; out[3 * i + 2] = p.alt; }
  }
  return out;
}

/**
 * The ground track from `before` to `after` minutes around `date`, split where it crosses the
 * antimeridian so the line doesn't streak across the globe.
 */
export function groundTrack(sat: Sat, date: Date, before: number, after: number, stepMin = 0.5): [number, number][][] {
  const lines: [number, number][][] = [[]];
  let prev: number | null = null;
  for (let m = -before; m <= after; m += stepMin) {
    const p = subpoint(sat, new Date(date.getTime() + m * 60_000));
    if (!p) continue;
    if (prev !== null && Math.abs(p.lon - prev) > 180) lines.push([]);
    lines.at(-1)!.push([p.lon, p.lat]);
    prev = p.lon;
  }
  return lines.filter((l) => l.length > 1);
}

/** Minutes per orbit. */
export const periodMin = (sat: Sat) => 1440 / revsPerDay(sat.rec);

/** Great-circle radius (km) of the patch of ground that can see the satellite above the horizon. */
export const footprintKm = (altKm: number) => EARTH_KM * Math.acos(EARTH_KM / (EARTH_KM + altKm));

/** The footprint as a closed ring of [lon, lat], for drawing. */
export function footprint(p: SatPos, n = 72): [number, number][] {
  const d = footprintKm(p.alt) / EARTH_KM;
  const lat1 = p.lat * RAD;
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const b = (2 * Math.PI * i) / n;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    const lon2 = p.lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    // Continuous longitudes (not wrapped), so a ring over the antimeridian stays one ring.
    ring.push([lon2 / RAD, lat2 / RAD]);
  }
  return ring;
}

/** Elevation (degrees above the horizon) of a satellite seen from a point on the ground (spherical Earth). */
export function elevation(lat: number, lon: number, p: { lat: number; lon: number; alt: number }): number {
  const o = xyz(lat, lon, EARTH_KM);
  const s = xyz(p.lat, p.lon, EARTH_KM + p.alt);
  const d = [s[0] - o[0], s[1] - o[1], s[2] - o[2]];
  const up = (d[0] * o[0] + d[1] * o[1] + d[2] * o[2]) / EARTH_KM;
  // Clamped: straight overhead the ratio can round to a hair over 1, and asin of that is NaN.
  return Math.asin(Math.min(1, up / Math.hypot(d[0], d[1], d[2]))) / RAD;
}

function xyz(lat: number, lon: number, r: number): [number, number, number] {
  return [r * Math.cos(lat * RAD) * Math.cos(lon * RAD), r * Math.cos(lat * RAD) * Math.sin(lon * RAD), r * Math.sin(lat * RAD)];
}

/** The next time `sat` climbs above `minEl` over a point, within `hours`; with the pass's highest elevation. */
export function nextPass(sat: Sat, lat: number, lon: number, from: Date, hours = 24, minEl = 10): { start: Date; maxEl: number } | null {
  let start: Date | null = null;
  let maxEl = -90;
  for (let s = 0; s <= hours * 3600; s += 30) {
    const t = new Date(from.getTime() + s * 1000);
    const p = subpoint(sat, t);
    if (!p) return null;
    const el = elevation(lat, lon, p);
    if (el >= minEl) {
      start ??= t;
      maxEl = Math.max(maxEl, el);
    } else if (start) {
      break;
    }
  }
  return start ? { start, maxEl } : null;
}

/** Days since the orbit was measured: SGP4 drifts a few km a day, so old elements mean a rougher position. */
export const epochAgeDays = (sat: Sat, now = Date.now()) => (now - (sat.rec.jdsatepoch - 2440587.5) * 86400_000) / 86400_000;

/**
 * The catalogue, loaded once while `on`. Through /api/satellites (CDN-cached: CelesTrak turns away
 * anyone re-downloading within ~2 h), straight from CelesTrak if that route is down.
 */
export function useSatellites(on: boolean): Sat[] | null {
  const [sats, setSats] = useState<Sat[] | null>(null);
  const [wanted, setWanted] = useState(false);
  useEffect(() => { if (on) setWanted(true); }, [on]);
  useEffect(() => {
    if (!wanted) return;
    const ctrl = new AbortController();
    (async () => {
      for (const url of ['/api/satellites', 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle']) {
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          if (!r.ok) continue;
          const list = parseTle(await r.text());
          if (list.length) { setSats(list); return; }
        } catch { if (ctrl.signal.aborted) return; }
      }
    })();
    return () => ctrl.abort();
  }, [wanted]);
  return sats;
}

export const satUrl = (id: number) => `https://www.n2yo.com/satellite/?s=${id}`;
