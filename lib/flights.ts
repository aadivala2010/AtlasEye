import { useEffect, useMemo, useRef, useState } from 'react';

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

async function getFlights(url: string, signal?: AbortSignal): Promise<Flight[]> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // `now` is when the snapshot was taken upstream: a CDN-cached copy keeps its true age.
  const j = (await r.json()) as { ac?: Raw[]; now?: number };
  return parseFlights(j.ac ?? [], j.now ?? Date.now());
}

/** Aircraft within `nm` nautical miles (adsb.lol caps it at 250) of a point, live. */
export const fetchFlights = (lat: number, lon: number, nm: number, signal?: AbortSignal) =>
  getFlights(`/api/flights?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&nm=${nm}`, signal);

/**
 * Dead-reckoned position at `now`: straight along the track at ground speed (1 nm = 1 arcminute).
 * ponytail: flat-earth straight line, capped at 15 min (the worldwide snapshot's age); turns
 * aren't modelled, so far-off aircraft drift until the next snapshot.
 */
export function project(f: Flight, now: number): { lat: number; lon: number } {
  const dt = Math.min(900, Math.max(0, (now - f.at) / 1000));
  const nm = (f.gs * dt) / 3600;
  const t = (f.track * Math.PI) / 180;
  const lat = f.lat + (nm * Math.cos(t)) / 60;
  const lon = f.lon + (nm * Math.sin(t)) / (60 * Math.max(0.01, Math.cos((f.lat * Math.PI) / 180)));
  return { lat, lon };
}

/**
 * Poll live aircraft around `center()` every 10 s while `on`; with `worldwide`, also merge in the
 * OpenSky snapshot of every aircraft on Earth (live data wins per aircraft). Keeps the last good
 * lists on errors.
 */
export function useFlights(on: boolean, center: () => { lat: number; lon: number } | null, nm = 250, worldwide = false) {
  const [local, setLocal] = useState<Flight[] | null>(null);
  const [world, setWorld] = useState<Flight[] | null>(null);
  const [error, setError] = useState(false);
  const centerRef = useRef(center);
  centerRef.current = center;

  useEffect(() => {
    if (!on) { setLocal(null); setError(false); return; }
    const ctrl = new AbortController();
    let timer = 0;
    const tick = async () => {
      const c = centerRef.current();
      if (c) {
        try {
          setLocal(await fetchFlights(c.lat, c.lon, nm, ctrl.signal));
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

  useEffect(() => {
    if (!on || !worldwide) { setWorld(null); return; }
    const ctrl = new AbortController();
    const tick = () => getFlights('/api/flights/global', ctrl.signal).then(setWorld, () => undefined);
    tick();
    const t = window.setInterval(tick, 60_000); // the CDN answers most of these from cache
    return () => { ctrl.abort(); clearInterval(t); };
  }, [on, worldwide]);

  const flights = useMemo(() => {
    if (!world) return local;
    const byHex = new Map(world.map((f) => [f.hex, f]));
    for (const f of local ?? []) byHex.set(f.hex, f);
    return [...byHex.values()];
  }, [local, world]);

  return { flights, error: error && !world };
}

export const formatAlt = (f: Flight) => (f.ground ? 'GROUND' : `${Math.round(f.alt).toLocaleString('en-US')} ft`);
