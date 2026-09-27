/**
 * Public camera operators: they publish exact coordinates, so no geocoding is needed.
 * Live video (HLS, MJPEG) is probed at import time and kept only if it answers (HLS also needs CORS);
 * everything else is a periodically refreshed snapshot, labelled as such in the UI.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Category, Source } from '../lib/stream';

export interface AgencyCam {
  id: string;
  kind: 'hls' | 'mjpeg' | 'snapshot';
  url: string;
  refresh?: number;
  name: string;
  latitude: number;
  longitude: number;
  /** Operator-supplied locality, if any; otherwise the nearest gazetteer place is used. */
  place?: string;
  /** IANA zone, for places the gazetteer has nothing near (Antarctica); otherwise the nearest place's. */
  timezone?: string;
  /** Omitted by sources that span borders; the nearest gazetteer place's country is used. */
  country?: string;
  category: Category;
  source: Source;
  /** Snapshot to fall back to if the HLS stream is dead at import time (stripped before writing). */
  fallback?: string;
  /** Unvetted image: fetched at import and dropped if it fails or is a shared placeholder (stripped before writing). */
  probe?: boolean;
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

/** A browser-like UA: several operators refuse requests that look like bots. */
const BROWSER = { 'user-agent': 'Mozilla/5.0 (compatible; AtlasEye/1.0; +https://github.com/aadivala2010/AtlasEye)' };

/** Fetch with a timeout and two retries: public 511 servers drop the odd request under load. */
async function get(url: string, init: RequestInit = {}, timeout = 60_000): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { ...BROWSER, ...init.headers }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}
const getJson = async (url: string, init?: RequestInit, timeout?: number): Promise<unknown> => (await get(url, init, timeout)).json();
const getText = async (url: string, init?: RequestInit): Promise<string> => (await get(url, init)).text();

const coord = z.coerce.number().refine(Number.isFinite);
const inRange = (lat: number, lon: number) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Text between `<tag>` and `</tag>` (namespace prefix included in `tag`), for flat XML feeds. */
const xmlText = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`))?.[1]?.trim();
const SMALL = new Set(['a', 'al', 'at', 'de', 'del', 'des', 'di', 'du', 'el', 'en', 'et', 'la', 'las', 'le', 'les', 'los', 'of', 'on', 'the', 'y']);
/** "PLAZA DE CASTILLA (NORTE)" → "Plaza de Castilla (Norte)". */
export const titleCase = (s: string) => tidy(s).toLowerCase()
  .replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (w, i: number) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));

/**
 * Inverse transverse Mercator on the GRS80 ellipsoid (Snyder 1987, eqs. 8-12 … 8-25): projected metres →
 * [lat, lon] degrees. Accurate to well under a metre within a few degrees of the central meridian.
 */
export function tmInverse(x: number, y: number, lon0: number, k0: number, falseEasting: number, falseNorthing = 0): [number, number] {
  const a = 6378137;
  const e2 = 0.00669438002290;
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = (y - falseNorthing) / k0 / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const p = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(p);
  const cos = Math.cos(p);
  const c = ep2 * cos ** 2;
  const t = Math.tan(p) ** 2;
  const n = a / Math.sqrt(1 - e2 * sin ** 2);
  const r = (a * (1 - e2)) / (1 - e2 * sin ** 2) ** 1.5;
  const d = (x - falseEasting) / (n * k0);
  const lat = p - ((n * Math.tan(p)) / r) * (d ** 2 / 2 - ((5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * ep2) * d ** 4) / 24
    + ((61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * ep2 - 3 * c ** 2) * d ** 6) / 720);
  const lon = (d - ((1 + 2 * t + c) * d ** 3) / 6 + ((5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * ep2 + 24 * t ** 2) * d ** 5) / 120) / cos;
  return [(lat * 180) / Math.PI, lon0 + (lon * 180) / Math.PI];
}

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

// ── IBI 511 platform: the same list endpoint behind many US state and Canadian provincial sites ──
const IbiPage = z.object({
  recordsTotal: z.number(),
  data: z.array(z.object({
    visible: z.boolean().optional(),
    location: z.string().nullable(),
    roadway: z.string().nullable().optional(),
    direction: z.string().nullable().optional(),
    latLng: z.object({ geography: z.object({ wellKnownText: z.string() }) }).nullable(),
    images: z.array(z.object({
      id: z.number(),
      imageUrl: z.string(),
      description: z.string().nullable().optional(),
      refreshRateMs: z.number().nullable().optional(),
      videoUrl: z.string().nullable().optional(),
      videoType: z.string().nullable().optional(),
      isVideoAuthRequired: z.boolean().optional(),
      videoDisabled: z.boolean().optional(),
      disabled: z.boolean().optional(),
      blocked: z.boolean().optional(),
    })),
  })),
});

/** "Site · view" when a site has several views; generic or missing view labels become "view N". */
function viewName(site: string, view: string | null | undefined, i: number, n: number): string {
  if (n === 1) return site;
  const v = tidy(view ?? '');
  return `${site} · ${v && v.length <= 40 && !/^(n\/a|traffic closest)/i.test(v) ? v : `view ${i + 1}`}`;
}

/** Road codes are not place words: "I485", "US74", "SR-44". */
const ROAD_CODE = /^(I|US|SR|NC|CR|CS|SH|RT|HWY|M)-?\d/i;

/**
 * A readable name from an operator's camera label. Drops internal camera numbers ("CHAT-0019: …",
 * "CAM 159 …", "D1 … 1-17"), and turns code-style IDs ("1068N_75_N/O_GoldenGate_M107",
 * "CCTV10-US74-271.3E_ANSONVILLE") into road + direction + the place words they contain.
 */
export function cameraName(label: string | null | undefined, road?: string | null, direction?: string | null): string {
  let s = tidy((label ?? '').replace(/&(amp;)+/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'"));
  if (!s || /^n\/?a$/i.test(s)) s = tidy(road ?? '');
  s = s.replace(/^[A-Z]{2,5}-\d{2,5}:\s*/, '').replace(/^CAM \d+\s+/i, '').replace(/^D\d\s+/, '').replace(/\s+\d-\d{1,3}$/, '')
    .replace(/(^|·\s*)(?:[-_]+|(?:sig)?cam-\d*|rwis\b)+\s*/gi, '$1'); // Indiana's "-_-_-cam-1 I-65/134.6 …"
  if (s && !/\s/.test(s) && /[_-]/.test(s)) {
    const words = s.replace(/^CCTV\d*-/i, '').split(/[_-]/)
      .filter((w) => /[A-Za-z]{3}/.test(w) && !ROAD_CODE.test(w) && !/cctv/i.test(w))
      .map((w) => w.replace(/([a-z])([A-Z])/g, '$1 $2'));
    const head = [road, direction && !/unknown/i.test(direction) ? direction : ''].filter(Boolean).join(' ');
    s = [head, titleCase(words.join(' '))].filter(Boolean).join(' · ') || s;
  }
  // Shouted place names ("SR 25 at SR 307 PORTS (CHATHAM)"); short all-caps words are usually acronyms.
  return s.replace(/\b[A-Z]{5,}\b/g, (w) => w[0] + w.slice(1).toLowerCase()) || 'Camera';
}

async function ibi(source: Source, host: string, country: string): Promise<AgencyCam[]> {
  const sites: z.infer<typeof IbiPage>['data'] = [];
  // Pages of 50: some sites (Alberta) answer 500 to pages of 100.
  for (let start = 0; ; start += 50) {
    const query = encodeURIComponent(JSON.stringify({ columns: [], start, length: 50 }));
    const page = parse(IbiPage, await getJson(`https://${host}/List/GetData/Cameras?query=${query}&lang=en-US`), `${source} cameras`);
    sites.push(...page.data);
    if (!page.data.length || sites.length >= page.recordsTotal) break;
  }
  return sites.flatMap((site) => {
    const m = site.latLng?.geography.wellKnownText.match(/POINT \((-?[\d.]+) (-?[\d.]+)\)/);
    const [lon, lat] = m ? [+m[1], +m[2]] : [NaN, NaN];
    if (site.visible === false || !inRange(lat, lon)) return [];
    const views = site.images.filter((v) => !v.disabled && !v.blocked);
    const name = cameraName(site.location, site.roadway, site.direction);
    return views.map((v, i): AgencyCam => {
      const still = new URL(v.imageUrl, `https://${host}/`).href;
      // Several states put video behind a login; those cameras are stills here.
      const hls = v.videoUrl?.startsWith('https://') && /mpegurl/i.test(v.videoType ?? '') && !v.isVideoAuthRequired && !v.videoDisabled
        ? v.videoUrl : '';
      return {
        id: `${source}:${v.id}`,
        kind: hls ? 'hls' : 'snapshot',
        url: hls || still,
        refresh: hls ? undefined : Math.max(10, Math.round((v.refreshRateMs ?? 60_000) / 1000)),
        fallback: hls ? still : undefined,
        name: viewName(name, v.description, i, views.length),
        latitude: lat,
        longitude: lon,
        country,
        category: 'traffic',
        source,
      };
    });
  });
}

const IBI_SITES: [Source, string, string][] = [
  ['511ny', '511ny.org', 'US'], ['511ga', '511ga.org', 'US'], ['az511', 'az511.gov', 'US'], ['511wi', '511wi.gov', 'US'],
  ['511la', '511la.org', 'US'], ['511id', '511.idaho.gov', 'US'], ['udot', 'udottraffic.utah.gov', 'US'],
  ['nvroads', 'www.nvroads.com', 'US'], ['511pa', '511pa.com', 'US'], ['ctroads', 'ctroads.org', 'US'], ['fl511', 'fl511.com', 'US'],
  ['ne511', 'newengland511.org', 'US'], ['drivenc', 'www.drivenc.gov', 'US'], ['511ak', '511.alaska.gov', 'US'],
  ['511on', '511on.ca', 'CA'], ['511ab', '511.alberta.ca', 'CA'], ['skhotline', 'hotline.gov.sk.ca', 'CA'],
  ['511mb', 'www.manitoba511.ca', 'CA'], ['511nb', '511.gnb.ca', 'CA'], ['511ns', '511.novascotia.ca', 'CA'],
  ['511nl', '511nl.ca', 'CA'], ['511yt', '511yukon.ca', 'CA'],
];

// ── Castle Rock CARS platform (GraphQL, same schema on every state site) ─────
const CarsResponse = z.object({
  data: z.object({
    mapFeaturesQuery: z.object({
      mapFeatures: z.array(z.object({
        __typename: z.string(),
        title: z.string().nullable().optional(),
        active: z.boolean().optional(),
        features: z.array(z.object({ geometry: z.object({ type: z.string(), coordinates: z.unknown() }) })),
        views: z.array(z.object({
          uri: z.string(),
          title: z.string().nullable().optional(),
          url: z.string().nullable().optional(),
          sources: z.array(z.object({ type: z.string(), src: z.string() })).nullable().optional(),
        })).optional(),
      })),
    }),
  }),
});

const CARS_QUERY = 'query M($input: MapFeaturesArgs!) { mapFeaturesQuery(input: $input) { mapFeatures { title __typename '
  + 'features { geometry } ... on Camera { active views(limit: 8) { uri title ... on CameraView { url sources { type src } } } } } } }';

type Bbox = { north: number; south: number; east: number; west: number };
const NORTH_AMERICA: Bbox = { north: 72, south: 17, east: -60, west: -180 };

async function cars(source: Source, host: string, bbox: Bbox, country: string): Promise<AgencyCam[]> {
  const body = JSON.stringify({ query: CARS_QUERY, variables: { input: { ...bbox, zoom: 15, layerSlugs: ['normalCameras'] } } });
  const file = parse(CarsResponse, await getJson(`https://${host}/api/graphql`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  }, 120_000), `${source} cameras`);
  return file.data.mapFeaturesQuery.mapFeatures.flatMap((cam) => {
    const g = cam.features[0]?.geometry;
    const [lon, lat] = g?.type === 'Point' && Array.isArray(g.coordinates) ? g.coordinates.map(Number) : [NaN, NaN];
    if (cam.__typename !== 'Camera' || cam.active === false || !inRange(lat, lon)) return [];
    // A closed camera's view points at a "camera closed" icon instead of an image.
    const views = (cam.views ?? []).filter((v) => v.url?.startsWith('https://') && !v.url.includes('/images/icon-camera'));
    return views.map((v): AgencyCam => {
      const still = v.url!;
      // Tokenised playlists (Mass511's) expire within minutes, far sooner than a weekly catalog.
      const hls = v.sources?.find((s) => /mpegurl/i.test(s.type) && s.src.startsWith('https://') && !/[?&](token|expires)=/i.test(s.src))?.src;
      return {
        id: `${source}:${v.uri.replace(/^camera\//, '').replace('/', '-')}`,
        kind: hls ? 'hls' : 'snapshot',
        url: hls ?? still,
        refresh: hls ? undefined : 60,
        fallback: hls ? still : undefined,
        // "MN 149: T.H.149 NB @ Vikings Pkwy" → "MN 149 · T.H.149 NB @ Vikings Pkwy"; drop IDs like "1-065-089-5-2".
        name: cameraName((v.title ?? cam.title ?? '').replace(': ', ' · ').replace(/\b\d+(-\d+){2,}\b/g, '')),
        latitude: lat,
        longitude: lon,
        country,
        category: 'traffic',
        source,
      };
    });
  });
}

const CARS_SITES: [Source, string, Bbox, string][] = [
  ['511mn', '511mn.org', NORTH_AMERICA, 'US'], ['511ia', '511ia.org', NORTH_AMERICA, 'US'], ['511in', '511in.org', NORTH_AMERICA, 'US'],
  ['kandrive', 'kandrive.gov', NORTH_AMERICA, 'US'], ['511ne', '511.nebraska.gov', NORTH_AMERICA, 'US'],
  ['mass511', 'mass511.com', NORTH_AMERICA, 'US'], ['tii', 'traffic.tii.ie', { north: 56, south: 51, east: -5, west: -11 }, 'IE'],
];

// ── Colorado (COtrip: Castle Rock's camera REST service rather than the GraphQL map) ──
const CotripFile = z.array(z.object({
  id: z.number(), public: z.boolean(), active: z.boolean(), name: z.string(),
  location: z.object({ latitude: coord, longitude: coord }),
  views: z.array(z.object({
    name: z.string().nullable().optional(), type: z.string(), url: z.string().nullable().optional(),
    videoPreviewUrl: z.string().nullable().optional(),
  })),
})).min(1);

async function cotrip(): Promise<AgencyCam[]> {
  const file = parse(CotripFile, await getJson('https://cotg.carsprogram.org/cameras_v1/api/cameras'), 'COtrip cameras');
  return file.flatMap((c) => {
    const { latitude: lat, longitude: lon } = c.location;
    if (!c.public || !c.active || !inRange(lat, lon)) return [];
    return c.views.flatMap((v, i) => {
      const hls = v.type === 'WMP' && v.url?.startsWith('https://') && v.url.includes('.m3u8') ? v.url : '';
      const still = (hls ? v.videoPreviewUrl : v.url) ?? '';
      if (!hls && !still.startsWith('https://')) return [];
      return [{
        id: `cotrip:${c.id}-${i}`,
        kind: hls ? 'hls' as const : 'snapshot' as const,
        url: hls || still,
        refresh: hls ? undefined : 60,
        fallback: hls && still.startsWith('https://') ? still : undefined,
        name: cameraName(v.name || c.name),
        latitude: lat,
        longitude: lon,
        country: 'US',
        category: 'traffic' as const,
        source: 'cotrip' as const,
      }];
    });
  });
}

// ── ArcGIS feature layers: many agencies publish their camera list this way (keyless) ──
const ArcgisPage = z.object({
  features: z.array(z.object({
    attributes: z.record(z.string(), z.unknown()),
    geometry: z.object({ x: coord, y: coord }).nullable().optional(),
  })),
  exceededTransferLimit: z.boolean().optional(),
});

/** Every feature of an ArcGIS layer in WGS84, paged past the server's record limit. */
async function arcgisLayer(layer: string, what: string): Promise<{ a: Record<string, unknown>; lat: number; lon: number }[]> {
  const rows: { a: Record<string, unknown>; lat: number; lon: number }[] = [];
  for (let offset = 0; ;) {
    const query = new URLSearchParams({
      where: '1=1', outFields: '*', outSR: '4326', f: 'json', resultOffset: String(offset), resultRecordCount: '1000',
    });
    const page = parse(ArcgisPage, await getJson(`${layer}/query?${query}`), what);
    rows.push(...page.features.map((f) => ({ a: f.attributes, lat: f.geometry?.y ?? NaN, lon: f.geometry?.x ?? NaN })));
    if (!page.exceededTransferLimit || !page.features.length) break;
    offset += page.features.length;
  }
  return rows;
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

// ── Washington (WSDOT) ──────────────────────────────────────────────────────
async function wsdot(): Promise<AgencyCam[]> {
  const rows = await arcgisLayer('https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0', 'WSDOT cameras');
  return rows.flatMap(({ a, lat, lon }) => {
    const url = str(a.ImageURL);
    return url.startsWith('https://') && inRange(lat, lon) ? [{
      id: `wsdot:${str(a.OBJECTID)}`, kind: 'snapshot' as const, url, refresh: 120, name: cameraName(str(a.CameraTitle)),
      latitude: lat, longitude: lon, country: 'US', category: 'traffic' as const, source: 'wsdot' as const,
    }] : [];
  });
}

// ── Austin, Texas (city open data, Socrata) ────────────────────────────────
const AustinFile = z.array(z.object({
  camera_id: z.string(), camera_status: z.string(), location_name: z.string().nullable().optional(),
  screenshot_address: z.string().nullable().optional(),
  location: z.object({ coordinates: z.tuple([coord, coord]) }).nullable().optional(),
})).min(1);

async function austin(): Promise<AgencyCam[]> {
  const file = parse(AustinFile, await getJson('https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=5000&camera_status=TURNED_ON'), 'Austin traffic cameras');
  return file.flatMap((c) => {
    const [lon, lat] = c.location?.coordinates ?? [NaN, NaN];
    const url = c.screenshot_address ?? '';
    return c.camera_status === 'TURNED_ON' && url.startsWith('https://') && inRange(lat, lon) ? [{
      id: `austin:${c.camera_id}`, kind: 'snapshot' as const, url, refresh: 60, name: cameraName(c.location_name),
      latitude: lat, longitude: lon, country: 'US', category: 'traffic' as const, source: 'austin' as const,
    }] : [];
  });
}

// ── York Region, Ontario ────────────────────────────────────────────────────
async function york(): Promise<AgencyCam[]> {
  const rows = await arcgisLayer('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Traffic/MapServer/0', 'York Region traffic cameras');
  return rows.flatMap(({ a, lat, lon }) => {
    const url = str(a.photo);
    return url.startsWith('https://') && inRange(lat, lon) ? [{
      id: `york:${str(a.FACILITYID)}`, kind: 'snapshot' as const, url, refresh: 60, name: cameraName(str(a.cameralocation)),
      latitude: lat, longitude: lon, country: 'CA', category: 'traffic' as const, source: 'york' as const,
    }] : [];
  });
}

// ── Japan: MLIT regional bureaus' road and river cameras, indexed by Esri Japan ──
async function mlit(): Promise<AgencyCam[]> {
  const base = 'https://services.arcgis.com/wlVTGRSYTzAbjjiC/arcgis/rest/services/CCD_Camera_ViewMap/FeatureServer';
  const layers = [[1, 'traffic'], [2, 'nature']] as const; // roads, rivers
  const out: AgencyCam[] = [];
  for (const [layer, category] of layers) {
    for (const { a, lat, lon } of await arcgisLayer(`${base}/${layer}`, `Japan live cameras (layer ${layer})`)) {
      const link = str(a.PhotoURL);
      // Timestamped paths ("/gazou/201810041415/…") are frozen captures from when the index was built.
      if (!/^https?:\/\//.test(link) || /\/20\d{6,10}\//.test(link) || !inRange(lat, lon)) continue;
      out.push({
        id: `mlit:${layer}-${str(a.OBJECTID)}`,
        kind: 'snapshot',
        url: link.replace(/^http:/, 'https:').replace(/\?(\d+|ver=\d+|time=)$/, ''),
        refresh: 300,
        name: tidy(str(a.title)) || 'ライブカメラ',
        latitude: lat,
        longitude: lon,
        country: 'JP',
        category,
        source: 'mlit',
        probe: true, // some links are pages, not images; some servers are gone
      });
    }
  }
  return out;
}

// ── ALERTCalifornia: wildfire-watch cameras on California's ridgelines (UC San Diego) ──
const AlertCaFile = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.array(z.number().nullable()) }),
    properties: z.object({ id: z.string(), name: z.string().nullable().optional(), last_frame_ts: z.number().nullable().optional() }),
  })).min(1),
});

async function alertca(): Promise<AgencyCam[]> {
  const file = parse(AlertCaFile, await getJson('https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json'), 'ALERTCalifornia cameras');
  const recent = Date.now() / 1000 - 6 * 3600;
  return file.features.flatMap(({ geometry: { coordinates: [lon, lat] }, properties: p }) => (
    lat != null && lon != null && inRange(lat, lon) && (p.last_frame_ts ?? 0) > recent ? [{
      id: `alertca:${p.id}`,
      kind: 'snapshot' as const,
      url: `https://cameras.alertcalifornia.org/public-camera-data/${encodeURIComponent(p.id)}/latest-frame.jpg`,
      refresh: 60,
      name: tidy(p.name || p.id),
      latitude: lat,
      longitude: lon,
      country: 'US',
      category: 'nature' as const,
      source: 'alertca' as const,
    }] : []));
}

// ── Virginia (VDOT 511) ─────────────────────────────────────────────────────
const VdotFile = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.tuple([coord, coord]) }),
    properties: z.object({
      id: z.coerce.string(), description: z.string().nullable(), route: z.string().nullable().optional(),
      active: z.boolean(), https_url: z.string().nullable().optional(), image_url: z.string().nullable().optional(),
    }),
  })).min(1),
});

async function vdot(): Promise<AgencyCam[]> {
  const file = parse(VdotFile, await getJson('https://511.vdot.virginia.gov/services/511/map/layers/map/cams'), 'VDOT cams');
  return file.features.flatMap(({ geometry: { coordinates: [lon, lat] }, properties: p }) => {
    const hls = p.https_url?.startsWith('https://') ? p.https_url : '';
    const still = p.image_url?.startsWith('https://') ? p.image_url : '';
    if (!p.active || !inRange(lat, lon) || !(hls || still)) return [];
    return [{
      id: `vdot:${p.id}`,
      kind: hls ? 'hls' as const : 'snapshot' as const,
      url: hls || still,
      refresh: hls ? undefined : 60,
      fallback: hls && still ? still : undefined,
      name: tidy([p.route, p.description].filter(Boolean).join(' · ') || 'Camera'),
      latitude: lat,
      longitude: lon,
      country: 'US',
      category: 'traffic' as const,
      source: 'vdot' as const,
    }];
  });
}

// ── Missouri (MoDOT) ─────────────────────────────────────────────────────────
const ModotFile = z.array(z.object({ location: z.string(), x: coord, y: coord, html: z.string().nullable() })).min(1);

async function modot(): Promise<AgencyCam[]> {
  const file = parse(ModotFile, await getJson('https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json'), 'MoDOT StreamingCams2');
  return file.flatMap((c) => {
    const id = c.html?.match(/rtplive\/([^/]+)\//)?.[1];
    if (!id || !c.html?.startsWith('https://') || !inRange(c.y, c.x)) return [];
    return [{
      id: `modot:${id}`, kind: 'hls' as const, url: c.html, name: tidy(c.location),
      latitude: c.y, longitude: c.x, country: 'US', category: 'traffic' as const, source: 'modot' as const,
    }];
  });
}

// ── Maryland (CHART) ────────────────────────────────────────────────────────
const ChartFile = z.object({
  data: z.array(z.object({
    id: z.string(), name: z.string(), lat: coord, lon: coord, cctvIp: z.string(), opStatus: z.string(), commMode: z.string(),
  })).min(1),
});

async function chart(): Promise<AgencyCam[]> {
  const file = parse(ChartFile, await getJson('https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do'), 'CHART cameras');
  return file.data.filter((c) => c.opStatus === 'OK' && c.commMode === 'ONLINE' && inRange(c.lat, c.lon)).map((c) => ({
    id: `chart:${c.id}`,
    kind: 'hls' as const,
    url: `https://${c.cctvIp}/rtplive/${c.id}/playlist.m3u8`,
    name: tidy(c.name),
    latitude: c.lat,
    longitude: c.lon,
    country: 'US',
    category: 'traffic' as const,
    source: 'chart' as const,
  }));
}

// ── Oregon (TripCheck) ──────────────────────────────────────────────────────
const TripcheckFile = z.object({
  features: z.array(z.object({
    attributes: z.object({
      publishedImageId: z.number(), filename: z.string(), latitude: coord, longitude: coord, title: z.string(),
    }),
  })).min(1),
});

async function tripcheck(): Promise<AgencyCam[]> {
  const file = parse(TripcheckFile, await getJson('https://tripcheck.com/Scripts/map/data/cctvinventory.js'), 'TripCheck camera inventory');
  return file.features.flatMap(({ attributes: c }) => (inRange(c.latitude, c.longitude) ? [{
    id: `tripcheck:${c.publishedImageId}`,
    kind: 'snapshot' as const,
    url: `https://tripcheck.com/RoadCams/cams/${encodeURIComponent(c.filename)}`,
    refresh: 120,
    name: tidy(c.title),
    latitude: c.latitude,
    longitude: c.longitude,
    country: 'US',
    category: 'traffic' as const,
    source: 'tripcheck' as const,
  }] : []));
}

// ── South Africa (SANRAL i-traffic: an older IBI release) ─────────────────────
const ItrafficIcons = z.array(z.object({ itemId: z.string(), location: z.tuple([coord, coord]) })).min(1);

async function itraffic(): Promise<AgencyCam[]> {
  const base = 'https://www.i-traffic.co.za';
  const icons = parse(ItrafficIcons, await getJson(`${base}/map/mapIcons/Cameras`), 'i-traffic camera icons');
  // Names only appear in each camera's tooltip ("GP CCTV N12 711").
  const names = await pool(icons, 16, async (c) => {
    try { return (await getText(`${base}/tooltip/Cameras/${c.itemId}?lang=en`)).match(/<b>\s*([^<]+?)\s*<\/b>/)?.[1]; } catch { return undefined; }
  });
  return icons.flatMap((c, i) => {
    const [lat, lon] = c.location;
    return inRange(lat, lon) ? [{
      id: `itraffic:${c.itemId}`,
      kind: 'snapshot' as const,
      url: `${base}/map/Cctv/${c.itemId}`,
      refresh: 60,
      name: tidy(names[i] ?? 'Traffic camera'),
      latitude: lat,
      longitude: lon,
      country: 'ZA',
      category: 'traffic' as const,
      source: 'itraffic' as const,
      probe: true, // about half answer with a shared "stream unavailable" card
    }] : [];
  });
}

// ── Spain (DGT, DATEX II) ───────────────────────────────────────────────────
async function dgt(): Promise<AgencyCam[]> {
  const xml = await getText('https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml');
  const devices = xml.split('<ns2:device ').slice(1);
  if (!devices.length) throw new SchemaError('DGT DATEX II: no <ns2:device> elements — upstream format changed?');
  return devices.flatMap((d) => {
    const id = d.match(/^[^>]*\bid="([^"]+)"/)?.[1];
    const url = xmlText(d, 'fse:deviceUrl');
    const lat = Number(xmlText(d, 'loc:latitude'));
    const lon = Number(xmlText(d, 'loc:longitude'));
    if (!id || !url?.startsWith('https://') || !inRange(lat, lon)) return [];
    const road = xmlText(d, 'loc:roadName');
    const km = xmlText(d, 'lse:kilometerPoint');
    const toward = xmlText(d, 'loc:roadDestination');
    return [{
      id: `dgt:${id}`,
      kind: 'snapshot' as const,
      url,
      refresh: 120,
      name: [road, km && `km ${km}`, toward && `toward ${titleCase(toward)}`].filter(Boolean).join(' · ') || 'Traffic camera',
      latitude: lat,
      longitude: lon,
      country: 'ES',
      category: 'traffic' as const,
      source: 'dgt' as const,
    }];
  });
}

// ── Madrid city (Informo) ───────────────────────────────────────────────────
async function madrid(): Promise<AgencyCam[]> {
  const kml = await getText('https://informo.madrid.es/informo/tmadrid/CCTV.kml');
  const marks = kml.split('<Placemark>').slice(1);
  if (!marks.length) throw new SchemaError('Madrid CCTV.kml: no <Placemark> elements — upstream format changed?');
  return marks.flatMap((m) => {
    const url = m.match(/src=(https:\/\/[^\s&"?]+\.jpg)/)?.[1];
    const id = m.match(/<Data name="Numero">\s*<Value>([^<]+)<\/Value>/)?.[1];
    const name = m.match(/<Data name="Nombre">\s*<Value>([^<]+)<\/Value>/)?.[1];
    const [lon, lat] = (xmlText(m, 'coordinates') ?? '').split(',').map(Number);
    if (!url || !id || !inRange(lat, lon)) return [];
    return [{
      id: `madrid:${id}`, kind: 'snapshot' as const, url, refresh: 60, name: titleCase(name ?? 'Cámara de tráfico'),
      latitude: lat, longitude: lon, country: 'ES', category: 'traffic' as const, source: 'madrid' as const,
    }];
  });
}

// ── Catalonia (Servei Català de Trànsit, WFS) ───────────────────────────────
async function sct(): Promise<AgencyCam[]> {
  const xml = await getText('https://www.gencat.cat/transit/opendata/cameres.xml');
  const features = xml.split('<gml:featureMember>').slice(1);
  if (!features.length) throw new SchemaError('SCT cameres.xml: no <gml:featureMember> elements — upstream format changed?');
  return features.flatMap((f) => {
    const [lon, lat] = (xmlText(f, 'gml:coordinates') ?? '').split(',').map(Number);
    const link = xmlText(f, 'cite:link') ?? '';
    const sctCam = link.match(/sctidcam=([\w.-]+)/)?.[1];
    // SCT's own cameras redirect to plain http; their https endpoint serves the same frame directly.
    const url = sctCam ? `https://mct.gencat.cat/mct2bo/TransitCamera?nom=${sctCam}&visualitzacio=imatge` : link.startsWith('https://') ? link : '';
    if (!url || !inRange(lat, lon)) return [];
    const road = xmlText(f, 'cite:carretera');
    const town = xmlText(f, 'cite:municipi');
    const pk = xmlText(f, 'cite:pk');
    return [{
      id: `sct:${sctCam ?? createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
      kind: 'snapshot' as const,
      url,
      refresh: 120,
      name: [road, pk && `km ${pk}`, town && titleCase(town)].filter(Boolean).join(' · ') || 'Traffic camera',
      latitude: lat,
      longitude: lon,
      country: 'ES',
      category: 'traffic' as const,
      source: 'sct' as const,
      probe: !sctCam, // municipal cameras linked from the feed are not SCT's own
    }];
  });
}

// ── London (TfL JamCams) ────────────────────────────────────────────────────
const TflFile = z.array(z.object({
  id: z.string(), commonName: z.string(), lat: coord, lon: coord,
  additionalProperties: z.array(z.object({ key: z.string(), value: z.string() })),
})).min(1);

async function tfl(): Promise<AgencyCam[]> {
  const file = parse(TflFile, await getJson('https://api.tfl.gov.uk/Place/Type/JamCam'), 'TfL JamCams');
  return file.flatMap((c) => {
    const prop = (k: string) => c.additionalProperties.find((p) => p.key === k)?.value;
    const url = prop('imageUrl');
    if (prop('available') !== 'true' || !url?.startsWith('https://') || !inRange(c.lat, c.lon)) return [];
    return [{
      id: `tfl:${c.id.replace(/^JamCams_/, '')}`, kind: 'snapshot' as const, url, refresh: 120, name: tidy(c.commonName),
      latitude: c.lat, longitude: c.lon, country: 'GB', category: 'traffic' as const, source: 'tfl' as const,
    }];
  });
}

// ── Iceland (Vegagerðin road weather cameras) ───────────────────────────────
const VegagerdinFile = z.array(z.object({
  Myndavel: z.string(), Skyring: z.string().nullable(), Slod: z.string(), Breidd: coord, Lengd: coord,
})).min(1);

async function vegagerdin(): Promise<AgencyCam[]> {
  const file = parse(VegagerdinFile, await getJson('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1'), 'Vegagerðin webcams');
  return file.flatMap((c) => {
    const slug = c.Slod.match(/\/([\w.-]+)\.jpg$/i)?.[1];
    if (!slug || !c.Slod.startsWith('https://') || !inRange(c.Breidd, c.Lengd)) return [];
    return [{
      id: `vegagerdin:${slug}`, kind: 'snapshot' as const, url: c.Slod, refresh: 300, name: tidy(c.Skyring || c.Myndavel),
      latitude: c.Breidd, longitude: c.Lengd, country: 'IS', category: 'weather' as const, source: 'vegagerdin' as const,
    }];
  });
}

// ── Lithuania (eismoinfo.lt; LKS-94 coordinates) ────────────────────────────
const EismoinfoFile = z.array(z.object({ id: z.number(), name: z.string(), image: z.string(), x: coord, y: coord })).min(1);

async function eismoinfo(): Promise<AgencyCam[]> {
  const file = parse(EismoinfoFile, await getJson('https://eismoinfo.lt/eismoinfo-backend/camera-info-table/'), 'eismoinfo cameras');
  return file.flatMap((c) => {
    const [lat, lon] = tmInverse(c.x, c.y, 24, 0.9998, 500_000); // LKS-94 / Lithuania TM (EPSG:3346)
    if (!c.image.startsWith('https://') || !inRange(lat, lon)) return [];
    return [{
      id: `eismoinfo:${c.id}`, kind: 'snapshot' as const, url: c.image, refresh: 120, name: tidy(c.name),
      latitude: lat, longitude: lon, country: 'LT', category: 'traffic' as const, source: 'eismoinfo' as const,
    }];
  });
}

// ── foto-webcam.eu (high-resolution Alpine panoramas) ───────────────────────
const FotoWebcamFile = z.object({
  cams: z.array(z.object({
    id: z.string(), title: z.string(), offline: z.boolean(), hidden: z.boolean(), latitude: coord, longitude: coord,
    country: z.string(), captureInterval: z.coerce.number().optional(),
  })).min(1),
});

async function fotowebcam(): Promise<AgencyCam[]> {
  const file = parse(FotoWebcamFile, await getJson('https://www.foto-webcam.eu/webcam/include/metadata.php'), 'foto-webcam.eu metadata');
  return file.cams.filter((c) => !c.offline && !c.hidden && inRange(c.latitude, c.longitude)).map((c) => ({
    id: `fotowebcam:${c.id}`,
    kind: 'snapshot' as const,
    url: `https://www.foto-webcam.eu/webcam/${c.id}/current/1200.jpg`,
    refresh: Math.max(60, c.captureInterval ?? 600),
    name: tidy(c.title),
    latitude: c.latitude,
    longitude: c.longitude,
    country: c.country.toUpperCase() === 'UK' ? 'GB' : c.country.toUpperCase(),
    category: 'nature' as const,
    source: 'fotowebcam' as const,
  }));
}

// ── New Zealand (NZTA traffic cameras) ──────────────────────────────────────
async function nzta(): Promise<AgencyCam[]> {
  const xml = await getText('https://www.trafficnz.info/service/traffic/rest/4/cameras/all');
  const cams = xml.split('<camera>').slice(1);
  if (!cams.length) throw new SchemaError('NZTA cameras: no <camera> elements — upstream format changed?');
  return cams.flatMap((c) => {
    // Nested <journey>/<region> blocks carry their own <id>/<name>; drop them before reading the camera's.
    const own = c.replace(/<(journey|journeyLeg|region|way)>[\s\S]*?<\/\1>/g, '');
    const id = xmlText(own, 'id');
    const image = xmlText(own, 'imageUrl');
    const lat = Number(xmlText(own, 'latitude'));
    const lon = Number(xmlText(own, 'longitude'));
    if (!id || !image || xmlText(own, 'offline') === 'true' || xmlText(own, 'underMaintenance') === 'true' || !inRange(lat, lon)) return [];
    return [{
      id: `nzta:${id}`, kind: 'snapshot' as const, url: new URL(image, 'https://www.trafficnz.info/').href, refresh: 60,
      name: tidy(xmlText(own, 'name') || xmlText(own, 'description') || 'Traffic camera'),
      latitude: lat, longitude: lon, country: 'NZ', category: 'traffic' as const, source: 'nzta' as const,
    }];
  });
}

// ── Taiwan (Freeway Bureau and Highway Bureau, via the Highway Bureau's app service; live MJPEG) ──
const TaiwanFile = z.array(z.object({
  id: z.string(), stakenumber: z.string().nullable(), gisx: coord, gisy: coord, html: z.string(),
})).min(1);

async function taiwan(list: 'freeway' | 'thb', source: Source): Promise<AgencyCam[]> {
  const file = parse(TaiwanFile, await getJson(`https://thbapp.thb.gov.tw/services/cctv/${list}`), `Taiwan ${list} CCTV`);
  return file.flatMap((c) => (c.html.startsWith('https://') && inRange(c.gisy, c.gisx) ? [{
    id: `${source}:${c.id}`,
    kind: 'mjpeg' as const,
    url: c.html,
    name: tidy(c.stakenumber || c.id), // "國道1號(基隆端到基隆交流道)", "台1線123k+850"
    latitude: c.gisy,
    longitude: c.gisx,
    country: 'TW',
    category: 'traffic' as const,
    source,
  }] : []));
}

// ── New South Wales (Live Traffic NSW; the cameras are one layer of an all-events feed) ──
const LiveTrafficFile = z.array(z.object({
  id: z.coerce.string(),
  eventType: z.string().nullable().optional(),
  geometry: z.object({ type: z.string(), coordinates: z.unknown() }).nullable(),
  properties: z.object({ title: z.string().nullable().optional(), href: z.string().nullable().optional() }),
})).min(1);

async function livetraffic(): Promise<AgencyCam[]> {
  const file = parse(LiveTrafficFile, await getJson('https://www.livetraffic.com/datajson/all-feeds-web.json'), 'Live Traffic NSW feeds');
  return file.flatMap((f) => {
    const [lon, lat] = f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates.map(Number) : [NaN, NaN];
    const url = f.properties.href;
    if (f.eventType !== 'liveCams' || !url?.startsWith('https://') || !inRange(lat, lon)) return [];
    return [{
      id: `livetraffic:${f.id}`, kind: 'snapshot' as const, url, refresh: 60, name: tidy(f.properties.title ?? 'Traffic camera'),
      latitude: lat, longitude: lon, country: 'AU', category: 'traffic' as const, source: 'livetraffic' as const,
    }];
  });
}

// ── USGS river cameras (HIVIS) ──────────────────────────────────────────────
const UsgsFile = z.array(z.object({
  camId: z.string(), camName: z.string(), lat: coord, lng: coord, smallDir: z.string(),
  hideCam: z.boolean().nullable().optional(), newestImageDT: z.string().nullable().optional(),
})).min(1);

async function usgs(): Promise<AgencyCam[]> {
  const file = parse(UsgsFile, await getJson('https://api.waterdata.usgs.gov/nims/cameras?enabled=true'), 'USGS HIVIS cameras');
  const dayAgo = Date.now() - 86_400_000;
  return file.flatMap((c) => (!c.hideCam && Date.parse(c.newestImageDT ?? '') > dayAgo && c.smallDir.startsWith('https://') && inRange(c.lat, c.lng) ? [{
    id: `usgs:${c.camId}`,
    kind: 'snapshot' as const,
    url: `${c.smallDir}${c.camId}_newest.jpg`,
    refresh: 300,
    name: tidy(c.camName),
    latitude: c.lat,
    longitude: c.lng,
    category: 'nature' as const,
    source: 'usgs' as const,
  }] : []));
}

// ── Polar research stations: hand-picked, stable "latest image" URLs; no operator publishes a list ──
const station = (source: Source, id: string, name: string, place: string, latitude: number, longitude: number, country: string,
  timezone: string, url: string): AgencyCam => ({
  id: `${source}:${id}`, kind: 'snapshot', url, refresh: 600, name, place, latitude, longitude, country, timezone,
  category: 'weather', source, probe: true,
});

const aad = async (): Promise<AgencyCam[]> => [
  station('aad', 'casey', 'Casey Station', 'Wilkes Land, Antarctica', -66.2821, 110.5268, 'AQ', 'Antarctica/Casey', 'https://images.antarctica.gov.au/webcams/casey/latest.jpg'),
  station('aad', 'davis', 'Davis Station', 'Princess Elizabeth Land, Antarctica', -68.5766, 77.9674, 'AQ', 'Antarctica/Davis', 'https://images.antarctica.gov.au/webcams/davis/latest.jpg'),
  station('aad', 'mawson', 'Mawson Station', 'Mac. Robertson Land, Antarctica', -67.6027, 62.8738, 'AQ', 'Antarctica/Mawson', 'https://images.antarctica.gov.au/webcams/mawson/latest.jpg'),
  station('aad', 'macca', 'Macquarie Island Station', 'Macquarie Island, Tasmania', -54.4997, 158.9364, 'AU', 'Antarctica/Macquarie', 'https://images.antarctica.gov.au/webcams/macca/latest.jpg'),
];

const noaagml = async (): Promise<AgencyCam[]> => [
  station('noaagml', 'spo', 'South Pole Observatory', 'Amundsen–Scott South Pole Station', -89.997, -24.8, 'AQ', 'Antarctica/McMurdo', 'https://gml.noaa.gov/webdata/spo/webcam/cmdlfullsize.jpg'),
  station('noaagml', 'brw', 'Barrow Atmospheric Baseline Observatory', 'Utqiaġvik, Alaska', 71.3230, -156.6114, 'US', 'America/Anchorage', 'https://gml.noaa.gov/webdata/brw/webcam/town.jpg'),
];

// ── NOAA buoy cameras (open ocean) ──────────────────────────────────────────
const NdbcFile = z.array(z.object({ id: z.string(), name: z.string(), lat: coord, lng: coord })).min(1);

async function ndbc(): Promise<AgencyCam[]> {
  const file = parse(NdbcFile, await getJson('https://www.ndbc.noaa.gov/buoycams.php'), 'NDBC buoycams');
  return file.filter((c) => inRange(c.lat, c.lng)).map((c) => {
    // "SOUTH HATTERAS - 225 NM South of Cape Hatteras": the second half says where the buoy is.
    const [title, where] = c.name.split(/\s+-\s+/, 2);
    return {
      id: `ndbc:${c.id}`,
      kind: 'snapshot' as const,
      url: `https://www.ndbc.noaa.gov/buoycam.php?station=${encodeURIComponent(c.id)}`,
      refresh: 600,
      name: `Buoy ${c.id} · ${titleCase(title)}`,
      latitude: c.lat,
      longitude: c.lng,
      place: where ? tidy(where) : undefined,
      category: 'weather' as const,
      source: 'ndbc' as const,
    };
  });
}

// ── OpenStreetMap: webcams mapped worldwide with a direct image link ─────────
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OSM_QUERY = '[out:json][timeout:300];('
  + 'nwr["contact:webcam"~"^https?://[^;]+\\\\.(jpe?g|png)",i];nwr["webcam"~"^https?://[^;]+\\\\.(jpe?g|png)",i];'
  + ');out center tags;';
const IMAGE_LINK = /^https?:\/\/[^\s;]+\.(jpe?g|png)(\?[^\s;]*)?$/i;

const OsmFile = z.object({
  elements: z.array(z.object({
    type: z.string(), id: z.number(), lat: z.number().optional(), lon: z.number().optional(),
    center: z.object({ lat: z.number(), lon: z.number() }).optional(),
    tags: z.record(z.string(), z.string()),
  })),
});

async function osm(): Promise<AgencyCam[]> {
  let data: unknown;
  let lastError: unknown;
  // One try per mirror (no retries: a busy Overpass takes minutes to say so, and answers 200 with an HTML error).
  for (const server of OVERPASS) {
    try {
      const res = await fetch(server, {
        method: 'POST', body: new URLSearchParams({ data: OSM_QUERY }), headers: BROWSER, signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) throw new Error(`${server} → HTTP ${res.status}`);
      data = await res.json();
      break;
    } catch (e) { lastError = e; }
  }
  if (data === undefined) throw lastError;
  const seen = new Set<string>();
  return parse(OsmFile, data, 'Overpass webcams').elements.flatMap((e) => {
    const t = e.tags;
    const lat = e.lat ?? e.center?.lat ?? NaN;
    const lon = e.lon ?? e.center?.lon ?? NaN;
    const link = [t['contact:webcam'], t.webcam].flatMap((v) => v?.split(';') ?? []).map((s) => s.trim()).find((s) => IMAGE_LINK.test(s));
    // Plain-http images can't load on an https page; the probe keeps them only if https answers.
    const url = link?.replace(/^http:/i, 'https:');
    if (!url || seen.has(url) || !inRange(lat, lon)) return [];
    seen.add(url);
    const traffic = t['surveillance:zone'] === 'traffic' || !!t.highway;
    return [{
      id: `osm:${e.type[0]}${e.id}`,
      kind: 'snapshot' as const,
      url,
      refresh: 60,
      name: tidy(t.name ?? t['name:en'] ?? (t.operator ? `${t.operator} webcam` : 'Webcam')),
      latitude: lat,
      longitude: lon,
      category: traffic ? 'traffic' as const : t.tourism === 'viewpoint' || t.natural ? 'nature' as const : 'other' as const,
      source: 'osm' as const,
      probe: true,
    }];
  });
}

/** A playlist is live if it answers 200 with an HLS header, and CORS headers hls.js needs, within a few seconds. */
async function probeHls(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { ...BROWSER, origin: 'https://atlas-eye.vercel.app' }, signal: AbortSignal.timeout(8_000) });
    return res.ok && res.headers.has('access-control-allow-origin') && (await res.text()).startsWith('#EXTM3U');
  } catch { return false; }
}

/** An MJPEG stream is live if it starts answering with a multipart (or JPEG) body; the endless body is then dropped. */
async function probeMjpeg(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(8_000) });
    void res.body?.cancel().catch(() => undefined);
    return res.ok && /multipart\/x-mixed-replace|image\/jpeg/i.test(res.headers.get('content-type') ?? '');
  } catch { return false; }
}

const MAGIC = [[0xff, 0xd8], [0x89, 0x50, 0x4e, 0x47], [0x47, 0x49, 0x46], [0x52, 0x49, 0x46, 0x46]]; // JPEG PNG GIF WEBP

/** Hash of an image's first 64 KB, or null if the URL doesn't answer with a real (non-trivial) image. */
async function sniffImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: BROWSER, signal: AbortSignal.timeout(12_000) });
    // A frame last modified over a month ago is a camera that stopped, not a live view.
    const modified = Date.parse(res.headers.get('last-modified') ?? '');
    if (!res.ok || !res.body || Date.now() - modified > 30 * 86_400_000) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 65_536) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    void reader.cancel().catch(() => undefined);
    const head = Buffer.concat(chunks).subarray(0, 65_536);
    if (head.length < 2048 || !MAGIC.some((m) => m.every((b, i) => head[i] === b))) return null;
    return createHash('sha1').update(head).digest('hex');
  } catch { return null; }
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** Every camera source, keyed by the `source` its cameras carry (so a failed one can keep its previous cameras). */
export const AGENCIES: Partial<Record<Source, () => Promise<AgencyCam[]>>> = {
  caltrans, deldot, nycdot, drivebc, digitraffic, hktd,
  ...Object.fromEntries(IBI_SITES.map(([source, host, country]) => [source, () => ibi(source, host, country)])),
  ...Object.fromEntries(CARS_SITES.map(([source, host, bbox, country]) => [source, () => cars(source, host, bbox, country)])),
  vdot, modot, chart, tripcheck, cotrip, wsdot, austin, york, alertca, itraffic, dgt, madrid, sct, tfl, vegagerdin, eismoinfo, fotowebcam,
  nzta, livetraffic, mlit, usgs, aad, noaagml, ndbc, osm,
  twfreeway: () => taiwan('freeway', 'twfreeway'),
  twthb: () => taiwan('thb', 'twthb'),
};

/** Probes and failures per source, so the importer can tell "blocked from this machine" from "dead cameras". */
export type ProbeTally = Map<string, { probed: number; failed: number }>;

/**
 * Operators whose probes nearly all failed. Every camera dying at once doesn't happen; this machine being
 * refused (a CI runner abroad, a rate limit) does.
 */
export const blockedSources = (tally: ProbeTally) =>
  new Set([...tally].filter(([, t]) => t.probed >= 20 && t.failed >= 0.9 * t.probed).map(([name]) => name));

function tallyProbe(tally: ProbeTally, source: string, ok: boolean) {
  const t = tally.get(source) ?? { probed: 0, failed: 0 };
  t.probed++;
  if (!ok) t.failed++;
  tally.set(source, t);
}

/**
 * Probe every live stream. A dead one (or an HLS one without CORS, which hls.js can't play) falls back to
 * the camera's snapshot when the operator publishes one; otherwise it is dropped.
 */
export async function verifyLive(cams: AgencyCam[], tally: ProbeTally): Promise<{ cams: AgencyCam[]; dead: number }> {
  const alive = await pool(cams, 48, (c) => (c.kind === 'hls' ? probeHls(c.url) : c.kind === 'mjpeg' ? probeMjpeg(c.url) : Promise.resolve(true)));
  let dead = 0;
  const out: AgencyCam[] = [];
  cams.forEach(({ fallback, ...cam }, i) => {
    if (cam.kind !== 'snapshot') tallyProbe(tally, cam.source, alive[i]);
    if (alive[i]) { out.push(cam); return; }
    dead++;
    if (fallback) out.push({ ...cam, kind: 'snapshot', url: fallback, refresh: 60 });
  });
  return { cams: out, dead };
}

/**
 * Fetch every unvetted image. Drops those that fail, and frames that are byte-identical at three or more
 * cameras: that is an operator's "camera offline" card, not a view.
 */
export async function verifyImages(cams: AgencyCam[], tally: ProbeTally): Promise<{ cams: AgencyCam[]; dropped: number }> {
  const hashes = await pool(cams, 48, (c) => (c.probe ? sniffImage(c.url) : Promise.resolve(null)));
  const uses = new Map<string, number>();
  for (const h of hashes) if (h) uses.set(h, (uses.get(h) ?? 0) + 1);
  let dropped = 0;
  const out: AgencyCam[] = [];
  cams.forEach(({ probe, ...cam }, i) => {
    const h = hashes[i];
    if (probe) tallyProbe(tally, cam.source, h !== null); // a placeholder still answered: not a block
    if (!probe || (h && uses.get(h)! < 3)) out.push(cam);
    else dropped++;
  });
  return { cams: out, dropped };
}
