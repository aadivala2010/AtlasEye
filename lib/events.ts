import { useEffect, useMemo, useRef, useState } from 'react';
import { parseFlights, type Flight } from './flights';
import { subsolarPoint } from './solar';
import type { Fires } from './fires';

/** What is happening on Earth: earthquakes, fires, storms, eruptions, ice, launches, space weather, emergencies. */

export interface Quake {
  id: string; lat: number; lon: number; depth: number; mag: number; place: string; at: number; url: string; tsunami: boolean;
}

export interface EarthEvent {
  id: string; title: string; category: string; at: number; lat: number; lon: number;
  /** Every point position up to the moment, oldest first (a storm's track). */
  track: [number, number][];
  magnitude?: string;
}

export interface Launch {
  id: string; name: string; provider: string; net: number; status: string; pad: string; lat: number; lon: number; webcast: boolean;
}


export interface Planet {
  quakes: Quake[] | null;
  events: EarthEvent[] | null;
  fires: Fires | null;
  launches: Launch[] | null;
  /** Planetary K index, 0–9 (estimated, 1-minute). */
  kp: number | null;
  emergencies: Flight[] | null;
}

export const EVENT_COLORS: Record<string, string> = {
  wildfires: '#FF8A1F', volcanoes: '#FF4D2E', severeStorms: '#B48CFF', seaLakeIce: '#9FE3FF', floods: '#4D9BFF',
  dustHaze: '#D9B77E', drought: '#C9A227', landslides: '#C08A5A', snow: '#E6EAF2', tempExtremes: '#FF5A5A', waterColor: '#2BD4C4',
};
export const EVENT_LABELS: Record<string, string> = {
  wildfires: 'Wildfire', volcanoes: 'Volcano', severeStorms: 'Severe storm', seaLakeIce: 'Sea & lake ice', floods: 'Flood',
  dustHaze: 'Dust & haze', drought: 'Drought', landslides: 'Landslide', snow: 'Snow', tempExtremes: 'Temperature extreme',
  waterColor: 'Water colour', manmade: 'Man-made', earthquakes: 'Earthquake',
};

// ── parsers ────────────────────────────────────────────────────────────────

interface QuakeJson {
  features: { id: string; geometry: { coordinates: [number, number, number] }; properties: { mag: number | null; place: string | null; time: number; url: string; tsunami: number } }[];
}

export const parseQuakes = (j: QuakeJson): Quake[] => j.features
  .filter((f) => f.properties.mag !== null)
  .map((f) => ({
    id: f.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: f.geometry.coordinates[2],
    mag: f.properties.mag!, place: f.properties.place ?? 'Unnamed region', at: f.properties.time, url: f.properties.url,
    tsunami: f.properties.tsunami === 1,
  }));

interface EonetJson {
  events: {
    id: string; title: string; categories: { id: string }[];
    geometry: { date: string; type: string; coordinates: unknown; magnitudeValue?: number | null; magnitudeUnit?: string | null }[];
  }[];
}

/** EONET events as of `t`: their positions up to then; a polygon counts by its first ring's centre. */
export function parseEonet(j: EonetJson, t = Infinity): EarthEvent[] {
  const out: EarthEvent[] = [];
  for (const e of j.events) {
    const geo = e.geometry
      .map((g) => ({ ...g, at: Date.parse(g.date), pt: point(g.type, g.coordinates) }))
      .filter((g) => g.pt && g.at <= t)
      .sort((a, b) => a.at - b.at);
    const last = geo.at(-1);
    if (!last?.pt) continue;
    out.push({
      id: e.id, title: e.title, category: e.categories[0]?.id ?? 'other', at: last.at, lon: last.pt[0], lat: last.pt[1],
      track: geo.map((g) => g.pt!),
      magnitude: last.magnitudeValue ? `${last.magnitudeValue} ${last.magnitudeUnit ?? ''}`.trim() : undefined,
    });
  }
  return out;
}

function point(type: string, c: unknown): [number, number] | null {
  if (type === 'Point') return c as [number, number];
  if (type === 'Polygon') {
    const ring = (c as [number, number][][])[0];
    if (!ring?.length) return null;
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }
  return null;
}

interface LaunchJson {
  results: {
    id: string; name: string; net: string; status?: { abbrev?: string }; webcast_live?: boolean;
    launch_service_provider?: { name?: string };
    pad?: { name?: string; latitude?: number | string; longitude?: number | string; location?: { name?: string } };
  }[];
}

export const parseLaunches = (j: LaunchJson): Launch[] => j.results.flatMap((r) => {
  const lat = Number(r.pad?.latitude);
  const lon = Number(r.pad?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return [{
    id: r.id, name: r.name, provider: r.launch_service_provider?.name ?? '', net: Date.parse(r.net), status: r.status?.abbrev ?? '',
    pad: r.pad?.location?.name ?? r.pad?.name ?? '', lat, lon, webcast: !!r.webcast_live,
  }];
});

// ── fetching ───────────────────────────────────────────────────────────────

/** Fetch `url` (JSON) now and every `ms` while it's non-null; a new url drops the old data. */
function usePoll<T>(url: string | null, ms: number, parse: (j: never) => T): T | null {
  const [data, setData] = useState<T | null>(null);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  useEffect(() => {
    setData(null);
    if (!url) return;
    const ctrl = new AbortController();
    let timer = 0;
    const tick = async () => {
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (r.ok) setData(parseRef.current((await r.json()) as never));
      } catch { /* keep the last answer; try again next tick */ }
      if (!ctrl.signal.aborted && ms) timer = window.setTimeout(tick, ms);
    };
    void tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [url, ms]);
  return data;
}

const USGS = 'https://earthquake.usgs.gov';
const hour = (t: number) => Math.floor(t / 3600_000) * 3600_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
/** FDSN's plain UTC form: 2026-09-28T12:00:00. */
const utc = (t: number) => new Date(t).toISOString().slice(0, 19);

/**
 * Everything on the Earth layer and in the Pulse, while `on`. `t` (the time machine) swaps the live
 * feeds for the archives of that moment; the ones without an archive (fires, launches, space weather,
 * squawks) go quiet.
 */
export function usePlanet(on: boolean, t: number | null): Planet {
  const live = t === null;
  const T = t === null ? 0 : hour(t);
  const quakes = usePoll(
    !on ? null : live ? `${USGS}/earthquakes/feed/v1.0/summary/2.5_day.geojson`
      : `${USGS}/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&orderby=time&limit=2000&starttime=${utc(T - 86400_000)}&endtime=${utc(T)}`,
    live ? 60_000 : 0, parseQuakes,
  );
  const eventsUrl = !on ? null : live ? 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30'
    : `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&start=${day(T - 20 * 86400_000)}&end=${day(T)}`;
  const events = usePoll(eventsUrl, live ? 600_000 : 0, (j: EonetJson) => parseEonet(j, live ? Infinity : T));
  const fires = usePoll(on && live ? '/api/fires' : null, 1800_000, (j: Fires) => j);
  const launches = usePoll(on && live ? 'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=12&mode=normal' : null, 600_000, parseLaunches);
  const kp = usePoll(on && live ? 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json' : null, 600_000,
    (j: { estimated_kp: number }[]) => j.at(-1)?.estimated_kp ?? null);
  const emergencies = usePoll(on && live ? '/api/flights/global?feed=7700' : null, 30_000,
    (j: { ac?: Parameters<typeof parseFlights>[0]; now?: number }) => parseFlights(j.ac ?? [], j.now ?? Date.now()));
  return useMemo(() => ({ quakes, events, fires, launches, kp, emergencies }), [quakes, events, fires, launches, kp, emergencies]);
}

// ── the Pulse ──────────────────────────────────────────────────────────────

export interface PulseItem {
  id: string;
  kind: 'quake' | 'emergency' | 'event' | 'launch' | 'aurora';
  /** 0 of note, 1 notable, 2 critical. */
  level: 0 | 1 | 2;
  title: string;
  detail: string;
  at: number;
  lat: number;
  lon: number;
  hex?: string;
}

const SQUAWKS: Record<string, string> = { '7500': 'unlawful interference', '7600': 'radio failure', '7700': 'general emergency' };

/** The notable things on Earth right now, most urgent first, then nearest in time. */
export function pulseItems(p: Planet, now: number): PulseItem[] {
  const items: PulseItem[] = [];
  for (const q of p.quakes ?? []) {
    if (q.mag < 4.5 || now - q.at > 86400_000) continue;
    items.push({
      id: `q:${q.id}`, kind: 'quake', level: q.tsunami || q.mag >= 6.5 ? 2 : q.mag >= 5.5 ? 1 : 0,
      title: `M${q.mag.toFixed(1)} earthquake`, detail: `${q.place} · ${Math.round(q.depth)} km deep${q.tsunami ? ' · tsunami flag' : ''}`,
      at: q.at, lat: q.lat, lon: q.lon,
    });
  }
  for (const f of p.emergencies ?? []) {
    if (!f.emergency) continue;
    items.push({
      id: `e:${f.hex}`, kind: 'emergency', level: 2, title: `${f.callsign} squawking ${f.squawk ?? 'emergency'}`,
      detail: [f.type, f.ground ? 'on the ground' : `${Math.round(f.alt).toLocaleString('en-US')} ft`, SQUAWKS[f.squawk ?? '']].filter(Boolean).join(' · '),
      at: f.at, lat: f.lat, lon: f.lon, hex: f.hex,
    });
  }
  for (const e of p.events ?? []) {
    if (now - e.at > 3 * 86400_000) continue;
    items.push({
      id: `v:${e.id}`, kind: 'event', level: e.category === 'severeStorms' || e.category === 'volcanoes' ? 1 : 0,
      title: e.title, detail: [EVENT_LABELS[e.category] ?? e.category, e.magnitude].filter(Boolean).join(' · '),
      at: e.at, lat: e.lat, lon: e.lon,
    });
  }
  for (const l of p.launches ?? []) {
    if (l.net - now > 86400_000 || now - l.net > 3 * 3600_000) continue;
    items.push({
      id: `l:${l.id}`, kind: 'launch', level: Math.abs(l.net - now) < 3600_000 ? 1 : 0,
      title: l.name, detail: [l.provider, l.pad, l.webcast ? 'webcast live' : ''].filter(Boolean).join(' · '),
      at: l.net, lat: l.lat, lon: l.lon,
    });
  }
  if (p.kp !== null && p.kp >= 5) {
    const g = Math.min(5, Math.floor(p.kp) - 4);
    // Where the oval is best seen right now: high northern latitudes, on the midnight side.
    const sun = subsolarPoint(new Date(now));
    items.push({
      id: `a:${new Date(now).toISOString().slice(0, 13)}:${g}`, kind: 'aurora', level: g >= 3 ? 2 : 1,
      title: `G${g} geomagnetic storm`, detail: `Kp ${p.kp.toFixed(1)} · aurora reaching lower latitudes than usual`,
      at: now, lat: 64, lon: ((sun.lon + 360) % 360) - 180,
    });
  }
  return items.sort((a, b) => b.level - a.level || Math.abs(a.at - now) - Math.abs(b.at - now));
}

/**
 * A browser notification for each new critical item while the tab is in the background. Everything
 * present on the first load counts as already seen, so opening the page doesn't set off a volley.
 */
export function useNotify(items: PulseItem[], on: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!items.length) return;
    if (!seen.current) { seen.current = new Set(items.map((i) => i.id)); return; }
    for (const it of items) {
      if (seen.current.has(it.id)) continue;
      seen.current.add(it.id);
      if (on && it.level === 2 && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(it.title, { body: it.detail, tag: it.id }); } catch { /* some browsers only notify from a service worker */ }
      }
    }
  }, [items, on]);
}
