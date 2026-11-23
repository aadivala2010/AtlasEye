import { useEffect, useState } from 'react';
import { distanceKm } from './geo';

/** Latest AIS report from OpenSeaFeed. Destination and type are reported by the vessel. */
export interface Ship {
  mmsi: number; lat: number; lon: number; at: number;
  name?: string; type?: number; speed?: number; course?: number;
  destination?: string; imo?: number; flag?: string;
}

interface RawShip {
  mmsi?: number; lat?: number; lon?: number; ts?: number;
  name?: string; type?: number; sog?: number; cog?: number;
  dest?: string; imo?: number; flag?: string;
}

export function parseShips(raw: RawShip[], now = Date.now()): Ship[] {
  return raw.flatMap((s) => {
    if (!Number.isInteger(s.mmsi) || s.mmsi! < 100_000_000 || s.mmsi! > 999_999_999
      || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || Math.abs(s.lat!) > 90 || Math.abs(s.lon!) > 180
      || !s.ts || s.ts > now + 60_000 || now - s.ts > 30 * 60_000) return [];
    return [{ mmsi: s.mmsi!, lat: s.lat!, lon: s.lon!, at: s.ts,
      name: s.name?.trim() || undefined, type: s.type, speed: s.sog, course: s.cog,
      destination: s.dest?.trim() || undefined, imo: s.imo, flag: s.flag }];
  });
}

export function useShips(on: boolean) {
  const [ships, setShips] = useState<Ship[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!on) { setShips(null); setError(false); return; }
    const ctrl = new AbortController();
    let timer = 0;
    const tick = async () => {
      try {
        const r = await fetch('https://api.openseafeed.com/v1/snapshot', { signal: ctrl.signal });
        if (!r.ok) throw new Error(`AIS HTTP ${r.status}`);
        const j = await r.json() as { vessels?: RawShip[] };
        if (!Array.isArray(j.vessels)) throw new Error('Invalid AIS snapshot');
        setShips(parseShips(j.vessels));
        setError(false);
      } catch { if (!ctrl.signal.aborted) setError(true); }
      if (!ctrl.signal.aborted) timer = window.setTimeout(tick, 120_000);
    };
    tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on]);
  return { ships, error };
}

interface RawTrackPoint { lat: number; lon: number; ts: string }

/** Break the observed track at reception gaps and impossible jumps. */
export function shipTrack(points: RawTrackPoint[]): number[][][] {
  const lines: number[][][] = [];
  let line: number[][] = [];
  let previous: RawTrackPoint | undefined;
  let previousAt = 0;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
    const timestamp = p.ts.replace(' ', 'T');
    const at = Date.parse(/(?:[Zz]|[+-]\d\d:\d\d)$/.test(timestamp) ? timestamp : `${timestamp}Z`);
    if (!Number.isFinite(at)) continue;
    const gap = at - previousAt;
    if (previous && (Math.abs(p.lon - previous.lon) > 180 || distanceKm(previous.lat, previous.lon, p.lat, p.lon) > 100
      || gap <= 0 || gap > 60 * 60_000)) {
      if (line.length > 1) lines.push(line);
      line = [];
    }
    line.push([p.lon, p.lat]);
    previous = p;
    previousAt = at;
  }
  if (line.length > 1) lines.push(line);
  return lines;
}

export const shipType = (type?: number) => type === undefined ? 'Vessel'
  : type >= 80 && type < 90 ? 'Tanker'
  : type >= 70 && type < 80 ? 'Cargo ship'
  : type >= 60 && type < 70 ? 'Passenger ship'
  : type === 30 ? 'Fishing vessel'
  : type >= 36 && type < 40 ? 'Sailing vessel'
  : type >= 30 && type < 40 ? 'Leisure or fishing vessel'
  : 'Vessel';
