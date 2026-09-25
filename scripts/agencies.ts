/**
 * Public-agency cameras: operators publish exact coordinates, so no geocoding is needed.
 * Live video (HLS) is probed at import time and kept only if the playlist answers;
 * everything else is a periodically refreshed snapshot, labelled as such in the UI.
 */
import { z } from 'zod';
import type { Category, Source } from '../lib/stream';

export interface AgencyCam {
  id: string;
  kind: 'hls' | 'snapshot';
  url: string;
  refresh?: number;
  name: string;
  latitude: number;
  longitude: number;
  /** Operator-supplied locality, if any; otherwise the nearest gazetteer place is used. */
  place?: string;
  country: string;
  category: Category;
  source: Source;
  /** Snapshot to fall back to if the HLS stream is dead at import time (stripped before writing). */
  fallback?: string;
}

export class SchemaError extends Error {}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new SchemaError(`${what} schema mismatch — upstream format changed? (${r.error.issues.length} issues, first 8 shown)\n`
      + z.prettifyError(new z.ZodError(r.error.issues.slice(0, 8))));
  }
  return r.data;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const coord = z.coerce.number().refine(Number.isFinite);
const inRange = (lat: number, lon: number) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

// ── Caltrans (California) ─────────────────────────────────────────────────────
const CaltransFile = z.object({
  data: z.array(z.object({
    cctv: z.object({
      index: z.string(),
      location: z.object({
        district: z.string(), locationName: z.string(), nearbyPlace: z.string(),
        latitude: coord, longitude: coord,
      }),
      inService: z.string(),
      imageData: z.object({
        streamingVideoURL: z.string(),
        static: z.object({ currentImageURL: z.string() }),
      }),
    }),
  })).min(1),
});

async function caltrans(): Promise<AgencyCam[]> {
  const out: AgencyCam[] = [];
  for (let d = 1; d <= 12; d++) {
    const dd = String(d).padStart(2, '0');
    const file = parse(CaltransFile, await getJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`), `Caltrans D${dd}`);
    for (const { cctv: c } of file.data) {
      if (c.inService !== 'true' || !inRange(c.location.latitude, c.location.longitude)) continue;
      const hls = c.imageData.streamingVideoURL.startsWith('https://') ? c.imageData.streamingVideoURL : '';
      const image = c.imageData.static.currentImageURL;
      if (!hls && !image.startsWith('https://')) continue;
      out.push({
        id: `caltrans:${d}-${c.index}`,
        kind: hls ? 'hls' : 'snapshot',
        url: hls || image,
        refresh: hls ? undefined : 60,
        fallback: hls && image.startsWith('https://') ? image : undefined,
        // "I-110 : (196) Avenue 26 Off Ramp" → "I-110 · Avenue 26 Off Ramp"; drop "(C 103)"-style camera codes.
        name: tidy(c.location.locationName.replace(/\([^)]*\d[^)]*\)\s*/g, '').replace(/\s*:\s*/, ' · ')),
        latitude: c.location.latitude,
        longitude: c.location.longitude,
        place: c.location.nearbyPlace && c.location.nearbyPlace !== 'Not Reported' ? `${c.location.nearbyPlace}, California` : undefined,
        country: 'US',
        category: 'traffic',
        source: 'caltrans',
      });
    }
  }
  return out;
}

// ── DelDOT (Delaware) ────────────────────────────────────────────────────────
const DeldotFile = z.object({
  videoCameras: z.array(z.object({
    id: z.string(), title: z.string(), county: z.string().optional(),
    lat: coord, lon: coord, enabled: z.boolean(),
    urls: z.object({ m3u8s: z.string() }),
  })).min(1),
});

async function deldot(): Promise<AgencyCam[]> {
  const file = parse(DeldotFile, await getJson('https://tmc.deldot.gov/json/videocamera.json'), 'DelDOT videocamera.json');
  return file.videoCameras.filter((c) => c.enabled && inRange(c.lat, c.lon)).map((c) => ({
    id: `deldot:${c.id}`,
    kind: 'hls',
    // The feed lists :443 explicitly; the plain https origin is the one that answers.
    url: c.urls.m3u8s.replace(':443/', '/'),
    name: tidy(c.title),
    latitude: c.lat,
    longitude: c.lon,
    place: c.county ? `${c.county} County, Delaware` : undefined,
    country: 'US',
    category: 'traffic',
    source: 'deldot',
  }));
}

// ── NYC DOT ──────────────────────────────────────────────────────────────────
const NycFile = z.array(z.object({
  id: z.string(), name: z.string(), latitude: coord, longitude: coord,
  area: z.string().nullable().optional(), isOnline: z.string(), imageUrl: z.string(),
})).min(1);

async function nycdot(): Promise<AgencyCam[]> {
  const file = parse(NycFile, await getJson('https://webcams.nyctmc.org/api/cameras'), 'NYC DOT cameras');
  return file.filter((c) => c.isOnline === 'true' && inRange(c.latitude, c.longitude)).map((c) => ({
    id: `nycdot:${c.id}`,
    kind: 'snapshot',
    url: c.imageUrl,
    refresh: 5,
    name: tidy(c.name),
    latitude: c.latitude,
    longitude: c.longitude,
    place: c.area ? `${c.area}, New York` : undefined,
    country: 'US',
    category: 'traffic',
    source: 'nycdot',
  }));
}

// ── DriveBC (British Columbia) ───────────────────────────────────────────────
const DriveBcFile = z.array(z.object({
  id: z.number(), name: z.string(), caption: z.string().nullable().optional(),
  marked_stale: z.boolean().optional(), is_on: z.boolean().optional(),
  region_name: z.string().nullable().optional(),
  location: z.object({ coordinates: z.tuple([coord, coord]) }),
})).min(1);

async function drivebc(): Promise<AgencyCam[]> {
  const file = parse(DriveBcFile, await getJson('https://www.drivebc.ca/api/webcams/'), 'DriveBC webcams');
  return file.filter((c) => !c.marked_stale && c.is_on !== false).flatMap((c) => {
    const [lon, lat] = c.location.coordinates;
    if (!inRange(lat, lon)) return [];
    return [{
      id: `drivebc:${c.id}`,
      kind: 'snapshot' as const,
      url: `https://www.drivebc.ca/images/${c.id}.jpg`,
      refresh: 60,
      name: tidy(c.name),
      latitude: lat,
      longitude: lon,
      country: 'CA',
      category: 'traffic' as const,
      source: 'drivebc' as const,
    }];
  });
}

// ── Digitraffic weather cameras (Finland) ────────────────────────────────────
const DigitrafficFile = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.array(coord).min(2) }),
    properties: z.object({
      id: z.string(), name: z.string(), collectionStatus: z.string(),
      presets: z.array(z.object({ id: z.string(), inCollection: z.boolean() })),
    }),
  })).min(1),
});

const FI_ROAD: Record<string, string> = { vt: 'Highway', kt: 'Main road', st: 'Road', yt: 'Road', mt: 'Road' };

async function digitraffic(): Promise<AgencyCam[]> {
  const file = parse(DigitrafficFile, await getJson('https://tie.digitraffic.fi/api/weathercam/v1/stations'), 'Digitraffic weathercam stations');
  return file.features.flatMap((f) => {
    const p = f.properties;
    const preset = p.presets.find((x) => x.inCollection);
    const [lon, lat] = f.geometry.coordinates;
    if (p.collectionStatus !== 'GATHERING' || !preset || !inRange(lat, lon)) return [];
    // "vt4_Oulu_Kempele" → "Highway 4 · Oulu Kempele"
    const m = p.name.match(/^([a-z]+)(\d+)_(.+)$/);
    const name = m ? `${FI_ROAD[m[1]] ?? 'Road'} ${m[2]} · ${m[3].replace(/_/g, ' ')}` : p.name.replace(/_/g, ' ');
    return [{
      id: `digitraffic:${p.id}`,
      kind: 'snapshot' as const,
      url: `https://weathercam.digitraffic.fi/${preset.id}.jpg`,
      refresh: 300,
      name,
      latitude: lat,
      longitude: lon,
      country: 'FI',
      category: 'weather' as const,
      source: 'digitraffic' as const,
    }];
  });
}

// ── Transport Department, Hong Kong ─────────────────────────────────────────
async function hktd(): Promise<AgencyCam[]> {
  const url = 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv';
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = new TextDecoder('utf-16le').decode(await res.arrayBuffer()).replace(/^﻿/, '');
  const [header, ...rows] = text.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const Row = z.object({ key: z.string(), district: z.string(), description: z.string(), latitude: coord, longitude: coord, url: z.string().url() });
  const cols = header.map((h) => h.trim());
  for (const need of ['key', 'district', 'description', 'latitude', 'longitude', 'url']) {
    if (!cols.includes(need)) throw new SchemaError(`Hong Kong TD CSV schema mismatch — missing column "${need}"`);
  }
  return rows.flatMap((r) => {
    const row = Row.safeParse(Object.fromEntries(cols.map((c, i) => [c, r[i]?.trim()])));
    if (!row.success || !inRange(row.data.latitude, row.data.longitude)) return [];
    const c = row.data;
    return [{
      id: `hktd:${c.key}`,
      kind: 'snapshot' as const,
      url: c.url.replace(/^http:/, 'https:'),
      refresh: 120,
      name: tidy(c.description.replace(/\s*\[[^\]]+\]\s*$/, '')),
      latitude: c.latitude,
      longitude: c.longitude,
      place: `${c.district}, Hong Kong`,
      country: 'HK',
      category: 'traffic' as const,
      source: 'hktd' as const,
    }];
  });
}

/** A playlist is live if it answers 200 with an HLS header within a few seconds. */
async function probeHls(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    return res.ok && (await res.text()).startsWith('#EXTM3U');
  } catch { return false; }
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export const AGENCIES: Record<string, () => Promise<AgencyCam[]>> = { caltrans, deldot, nycdot, drivebc, digitraffic, hktd };

/**
 * Probe every HLS stream. A dead Caltrans stream falls back to that camera's snapshot;
 * other dead streams are dropped.
 */
export async function verifyHls(cams: AgencyCam[]): Promise<{ cams: AgencyCam[]; dead: number }> {
  const alive = await pool(cams, 32, (c) => (c.kind === 'hls' ? probeHls(c.url) : Promise.resolve(true)));
  let dead = 0;
  const out: AgencyCam[] = [];
  cams.forEach(({ fallback, ...cam }, i) => {
    if (alive[i]) { out.push(cam); return; }
    dead++;
    if (fallback) out.push({ ...cam, kind: 'snapshot', url: fallback, refresh: 60 });
  });
  return { cams: out, dead };
}
