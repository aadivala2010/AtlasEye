import { useEffect, useRef, useState } from 'react';

/** One aircraft from adsb.lol (readsb JSON), trimmed to what we draw. */
export interface Flight {
  hex: string;
  callsign: string;
  reg?: string;
  type?: string;
  lat: number;
  lon: number;
  /** Feet: geometric (GPS) altitude when reported, else barometric. 0 on the ground. */
  alt: number;
  ground: boolean;
  /** Ground speed, knots. */
  gs: number;
  /** True track over ground, degrees. */
  track: number;
  roll: number;
  /** Vertical rate, ft/min. */
  vs: number;
  squawk?: string;
  /** Epoch ms of the position fix. */
  at: number;
}

interface Raw {
  hex: string; flight?: string; r?: string; t?: string; lat?: number; lon?: number;
  alt_baro?: number | 'ground'; alt_geom?: number; gs?: number; track?: number; true_heading?: number;
  roll?: number; baro_rate?: number; geom_rate?: number; squawk?: string; seen_pos?: number;
}

export function parseFlights(ac: Raw[], now: number): Flight[] {
  const out: Flight[] = [];
  for (const a of ac) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
    const ground = a.alt_baro === 'ground';
    out.push({
      hex: a.hex,
      callsign: a.flight?.trim() || a.r || a.hex.toUpperCase(),
      reg: a.r,
      type: a.t,
      lat: a.lat,
      lon: a.lon,
      alt: ground ? 0 : a.alt_geom ?? (typeof a.alt_baro === 'number' ? a.alt_baro : 0),
      ground,
      gs: a.gs ?? 0,
      track: a.track ?? a.true_heading ?? 0,
      roll: a.roll ?? 0,
      vs: a.geom_rate ?? a.baro_rate ?? 0,
      squawk: a.squawk,
      at: now - (a.seen_pos ?? 0) * 1000,
    });
  }
  return out;
}

/** Aircraft within `nm` nautical miles (adsb.lol caps it at 250) of a point. */
export async function fetchFlights(lat: number, lon: number, nm: number, signal?: AbortSignal): Promise<Flight[]> {
  const r = await fetch(`/api/adsb/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${nm}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { ac?: Raw[] };
  return parseFlights(j.ac ?? [], Date.now());
}

/**
 * Dead-reckoned position at `now`: straight along the track at ground speed (1 nm = 1 arcminute).
 * ponytail: flat-earth step, capped at 60 s so a stale fix doesn't fly off; fine between 10 s polls.
 */
export function project(f: Flight, now: number): { lat: number; lon: number } {
  const dt = Math.min(60, Math.max(0, (now - f.at) / 1000));
  const nm = (f.gs * dt) / 3600;
  const t = (f.track * Math.PI) / 180;
  const lat = f.lat + (nm * Math.cos(t)) / 60;
  const lon = f.lon + (nm * Math.sin(t)) / (60 * Math.max(0.01, Math.cos((f.lat * Math.PI) / 180)));
  return { lat, lon };
}

/** Poll aircraft around `center()` every 10 s while `on`. Keeps the last good list on errors. */
export function useFlights(on: boolean, center: () => { lat: number; lon: number } | null, nm = 250) {
  const [flights, setFlights] = useState<Flight[] | null>(null);
  const [error, setError] = useState(false);
  const centerRef = useRef(center);
  centerRef.current = center;

  useEffect(() => {
    if (!on) { setFlights(null); setError(false); return; }
    const ctrl = new AbortController();
    let timer = 0;
    const tick = async () => {
      const c = centerRef.current();
      if (c) {
        try {
          setFlights(await fetchFlights(c.lat, c.lon, nm, ctrl.signal));
          setError(false);
        } catch {
          if (ctrl.signal.aborted) return;
          setError(true);
        }
      }
      if (!ctrl.signal.aborted) timer = window.setTimeout(tick, c ? 10_000 : 500);
    };
    tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on, nm]);

  return { flights, error };
}

export const formatAlt = (f: Flight) => (f.ground ? 'GROUND' : `${Math.round(f.alt).toLocaleString('en-US')} ft`);
