import { useEffect, useMemo, useRef, useState } from 'react';
import { AIRLINER_TYPES } from './airliners';
import { sourceFetch } from './sources';

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
  /** Military, per readsb's database flags — travels with the aircraft, so it survives feed merges. */
  mil: boolean;
  /** Declared emergency, or an emergency squawk: 7500 unlawful interference, 7600 radio failure, 7700 general. */
  emergency: boolean;
  source: 'adsb.lol' | 'OpenSky' | 'PocketWorld';
  /** Epoch ms of the position fix. */
  at: number;
}

interface Raw {
  hex: string; flight?: string; r?: string; t?: string; lat?: number; lon?: number;
  alt_baro?: number | 'ground'; alt_geom?: number; gs?: number; track?: number; true_heading?: number;
  roll?: number; baro_rate?: number; geom_rate?: number; squawk?: string; seen_pos?: number;
  dbFlags?: number; emergency?: string; source?: 'OpenSky' | 'PocketWorld';
}

/** readsb dbFlags is a bitfield: 1 military, 2 interesting, 4 PIA, 8 LADD. */
const MIL_FLAG = 1;
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

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
      mil: ((a.dbFlags ?? 0) & MIL_FLAG) !== 0,
      emergency: EMERGENCY_SQUAWKS.has(a.squawk ?? '') || (!!a.emergency && a.emergency !== 'none'),
      source: a.source ?? 'adsb.lol',
      at: now - (a.seen_pos ?? 0) * 1000,
    });
  }
  return out;
}

async function getFlights(url: string, signal?: AbortSignal, onPartial?: (partial: boolean) => void): Promise<Flight[]> {
  const r = await sourceFetch(url.includes('feed=world') ? 'Worldwide aircraft'
    : url.includes('/global') ? 'ADS-B worldwide sweep' : 'ADS-B local aircraft', url.includes('/global') ? 60000 : 10000, url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // `now` is when the snapshot was taken upstream: a CDN-cached copy keeps its true age.
  const j = (await r.json()) as { ac?: Raw[]; now?: number; partial?: boolean };
  onPartial?.(!!j.partial);
  return parseFlights(j.ac ?? [], j.now ?? Date.now());
}

/**
 * The worldwide rotation: every airliner type, plus military and anyone squawking 7700. The two
 * extra feeds are global single endpoints like a type sweep, so they ride the same pacing — and
 * they carry aircraft no airliner sweep would ever show (helicopters, transports, fighters).
 */
const WORLD_FEEDS = [...AIRLINER_TYPES.map((t) => `type=${t}`), 'feed=mil', 'feed=7700'];

/** Aircraft within `nm` nautical miles (adsb.lol caps it at 250) of a point, live. */
export const fetchFlights = (lat: number, lon: number, nm: number, signal?: AbortSignal) =>
  getFlights(`/api/flights?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&nm=${nm}`, signal);

/**
 * Dead-reckoned position at `now`: straight along the track at ground speed (1 nm = 1 arcminute).
 * ponytail: flat-earth straight line, capped at 15 min for ADS-B and 2 min for aggregated feeds; turns
 * aren't modelled, so far-off aircraft drift until the next snapshot.
 */
export function project(f: Flight, now: number): { lat: number; lon: number } {
  const dt = Math.min(f.source === 'adsb.lol' ? 900 : 120, Math.max(0, (now - f.at) / 1000));
  const nm = (f.gs * dt) / 3600;
  const t = (f.track * Math.PI) / 180;
  const lat = f.lat + (nm * Math.cos(t)) / 60;
  const lon = f.lon + (nm * Math.sin(t)) / (60 * Math.max(0.01, Math.cos((f.lat * Math.PI) / 180)));
  return { lat, lon };
}

/**
 * Poll live aircraft around `center()` every 10 s while `on`; with `worldwide`, also merge in the
 * worldwide airliner sweep (live data wins per aircraft). Keeps the last good
 * lists on errors.
 */
export function useFlights(on: boolean, center: () => { lat: number; lon: number } | null, nm = 250, worldwide = false) {
  const [local, setLocal] = useState<Flight[] | null>(null);
  const [world, setWorld] = useState<Flight[] | null>(null);
  const [globalFlights, setGlobalFlights] = useState<Flight[] | null>(null);
  const [globalPartial, setGlobalPartial] = useState(false);
  const [globalError, setGlobalError] = useState(false);
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
      } else {
        setLocal(null); // no centre = live feed paused (e.g. zoomed out): drop its stale circle
        setError(false);
      }
      if (!ctrl.signal.aborted) timer = window.setTimeout(tick, c ? 10_000 : 500);
    };
    tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on, nm]);

  useEffect(() => {
    if (!on || !worldwide) { setWorld(null); return; }
    if (globalFlights) return;
    const ctrl = new AbortController();
    const byFeed = new Map<string, Flight[]>();
    let i = 0;
    let timer = 0;
    // Only sweep types when the all-aircraft feed is unavailable. Anonymous ADS-B is quota-limited.
    const tick = async () => {
      const feed = WORLD_FEEDS[i++ % WORLD_FEEDS.length];
      try {
        byFeed.set(feed, await getFlights(`/api/flights/global?${feed}`, ctrl.signal));
        setWorld([...byFeed.values()].flat());
      } catch { /* busy or aborted: keep what we have, try the next feed */ }
      if (!ctrl.signal.aborted) timer = window.setTimeout(tick, 5 * 60_000);
    };
    tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on, worldwide, !!globalFlights]);

  useEffect(() => {
    if (!on || !worldwide) { setGlobalFlights(null); setGlobalPartial(false); setGlobalError(false); return; }
    const ctrl = new AbortController();
    let timer = 0;
    const tick = async () => {
      try {
        const all = await getFlights('/api/flights/global?feed=world', ctrl.signal, setGlobalPartial);
        setGlobalFlights(all);
        setGlobalError(false);
      } catch { if (!ctrl.signal.aborted) { setGlobalFlights(null); setGlobalError(true); } }
      if (!ctrl.signal.aborted) timer = window.setTimeout(tick, 2 * 60_000);
    };
    tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on, worldwide]);

  const flights = useMemo(() => {
    if (!world && !globalFlights) return local;
    const byHex = new Map((globalFlights ?? []).filter((f) => Date.now() - f.at < 20 * 60_000).map((f) => [f.hex, f]));
    for (const f of world ?? []) if (Date.now() - f.at < 15 * 60_000) byHex.set(f.hex, f);
    for (const f of local ?? []) byHex.set(f.hex, f);
    return [...byHex.values()];
  }, [local, world, globalFlights]);

  return { flights, error: (error || globalError) && !world && !globalFlights, partial: globalPartial || globalError };
}

export const formatAlt = (f: Flight) => (f.ground ? 'GROUND' : `${Math.round(f.alt).toLocaleString('en-US')} ft`);
