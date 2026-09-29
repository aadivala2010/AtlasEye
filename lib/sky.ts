import { useEffect, useState } from 'react';
import type { AddProtocolAction, ExpressionSpecification } from 'maplibre-gl';
import { fillNoData } from './clouds';
import { subsolarPoint } from './solar';
import { cloudsDate } from './time';

/**
 * Everything drawn between the Esri imagery and the pins: clouds from the geostationary ring, the
 * daily true-colour pass, the night side's city lights, the "senses" (infrared, rain, sea temperature…),
 * the aurora oval and lightning. Most of it is painted per pixel by the tile protocols below.
 */

const RAD = Math.PI / 180;
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const EUMETSAT = 'https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&styles=&crs=EPSG:3857'
  + '&width=256&height=256&format=image/png&transparent=true';

export type SenseId = 'ir' | 'rain' | 'radar' | 'sst' | 'heatwave' | 'smoke' | 'snow' | 'ice' | 'co';

export interface Sky {
  /** Clouds as the geostationary ring sees them now: five satellites, a new frame every 10–15 min. */
  live: boolean;
  /** One day's true-colour composite (yesterday, or the time machine's day). */
  clouds: boolean;
  /** The night side, with its city lights. */
  night: boolean;
  aurora: boolean;
  lightning: boolean;
  sense: SenseId | null;
  /** 3D terrain and buildings once zoomed in. */
  terrain: boolean;
}

/** Mapzen/AWS Terrarium elevation tiles: open, no key, CORS-enabled. */
export const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** The sky above the horizon once the view tilts (the cockpit, and the globe in 3D). */
export const SKY_DAY = { 'sky-color': '#4F86C9', 'horizon-color': '#CFE0F2', 'fog-color': '#C4D6EA' };
export const SKY_NIGHT = { 'sky-color': '#03060F', 'horizon-color': '#1A2440', 'fog-color': '#0D1426' };
export const SKY_BLEND = { 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.4, 'atmosphere-blend': 0 };
/** No sky at all: what MapLibre itself falls back to (the starfield shows around the globe). */
export const SKY_OFF = { 'sky-color': 'transparent', 'horizon-color': 'transparent', 'fog-color': 'transparent', 'fog-ground-blend': 1, 'atmosphere-blend': 0 };

export const SKY_DEFAULT: Sky = { live: true, clouds: false, night: true, aurora: false, lightning: false, sense: null, terrain: true };

// ── the geostationary ring ─────────────────────────────────────────────────

/**
 * Drawn bottom to top; each satellite gives way to one drawn beneath it wherever that one sits nearer
 * to the pixel's nadir, so every point is painted by the satellite with the straightest view of it.
 * `clear`/`solid`: the grey levels where clear sky ends and cloud is opaque, in that source's rendering.
 * GIBS draws its infrared with an enhanced palette: its coloured pixels are the coldest cloud tops.
 */
export const GEO = [
  { id: 'himawari', name: 'Himawari-9', lon: 140.7, cadence: 10, gibs: 'Himawari_AHI_Band13_Clean_Infrared', clear: 145, solid: 205 },
  { id: 'iodc', name: 'Meteosat-9', lon: 45.5, cadence: 15, wms: 'msg_iodc:ir108', clear: 80, solid: 150 },
  { id: 'mtg', name: 'Meteosat-12', lon: 0, cadence: 10, wms: 'mtg_fd:ir105_hrfi', clear: 80, solid: 150 },
  { id: 'goes-east', name: 'GOES-19', lon: -75.2, cadence: 10, gibs: 'GOES-East_ABI_Band13_Clean_Infrared', clear: 145, solid: 205 },
  { id: 'goes-west', name: 'GOES-18', lon: -137.2, cadence: 10, gibs: 'GOES-West_ABI_Band13_Clean_Infrared', clear: 145, solid: 205 },
] as const;
type Geo = (typeof GEO)[number];

const COS_EDGE = Math.cos(76 * RAD); // past this off-nadir angle a satellite paints nothing…
const COS_FULL = Math.cos(62 * RAD); // …and inside this it paints at full strength
const COS_COVERS = Math.cos(72 * RAD); // a satellite this close to its limb isn't worth yielding to
const YIELD_BAND = 0.04; // in cos(angle): ~3.5° of blend either side of the midline between two satellites

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 0 in full night, 1 in full day, a twilight ramp between (from sin of the sun's altitude). */
export const daylight = (sinAlt: number) => smooth(Math.sin(-9 * RAD), Math.sin(1 * RAD), sinAlt);

/**
 * How strongly satellite `i` paints a point, from the cosines of the point's angle to each satellite's
 * nadir (cos = cos(lat)·cos(Δlon) for a satellite over the equator).
 */
export function geoWeight(cosToNadir: (j: number) => number, i: number): number {
  const own = cosToNadir(i);
  let w = smooth(COS_EDGE, COS_FULL, own);
  for (let j = 0; j < i && w > 0; j++) {
    const other = cosToNadir(j);
    if (other > COS_COVERS) w *= smooth(-YIELD_BAND, YIELD_BAND, own - other);
  }
  return w;
}

/** How cloudy a pixel of one source's infrared is, 0–1. */
export function cloudiness(g: Pick<Geo, 'clear' | 'solid'> & { gibs?: string }, r: number, gr: number, b: number): number {
  const hi = Math.max(r, gr, b);
  if ('gibs' in g && g.gibs && hi - Math.min(r, gr, b) > 40) return 1;
  return smooth(g.clear, g.solid, hi);
}

// ── tile geometry ──────────────────────────────────────────────────────────

/** Latitude (radians) of each pixel row's centre, and longitude of each column's, in a Web Mercator tile. */
export function tileAxes(z: number, x: number, y: number, size: number) {
  const n = 2 ** z;
  const lat = new Float64Array(size);
  const lon = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    lat[i] = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (i + 0.5) / size)) / n)));
    lon[i] = (2 * Math.PI * (x + (i + 0.5) / size)) / n - Math.PI;
  }
  return { lat, lon };
}

/** A tile's EPSG:3857 box, for WMS. */
export function tileBbox(z: number, x: number, y: number): string {
  const R = 20037508.342789244;
  const s = (2 * R) / 2 ** z;
  const minx = -R + x * s;
  const maxy = R - y * s;
  return `${minx},${maxy - s},${minx + s},${maxy}`;
}

/** Per-pixel sin(sun altitude) is separable: A[row] + B[row]·C[col]. */
function sunAxes(lat: Float64Array, lon: Float64Array, when: number) {
  const sun = subsolarPoint(new Date(when));
  const sd = Math.sin(sun.lat * RAD);
  const cd = Math.cos(sun.lat * RAD);
  return {
    a: lat.map((l) => Math.sin(l) * sd),
    b: lat.map((l) => Math.cos(l) * cd),
    c: lon.map((l) => Math.cos(l - sun.lon * RAD)),
  };
}

function context(w: number, h: number) {
  const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d canvas');
  return ctx;
}

async function pixels(url: string, signal: AbortSignal): Promise<ImageData> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bmp = await createImageBitmap(await res.blob());
  const ctx = context(bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

const tileXYZ = (parts: string[]) => parts.slice(-3).map(Number) as [number, number, number];

// ── time strings ───────────────────────────────────────────────────────────

const floorTo = (ms: number, minutes: number) => Math.floor(ms / (minutes * 60_000)) * minutes * 60_000;
/** GIBS wants whole seconds: 2026-09-29T01:30:00Z. */
export const gibsTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── protocols ──────────────────────────────────────────────────────────────

/** `gibs://` — a day's true-colour composite, with stand-in clouds over its no-data black (lib/clouds). */
const loadClouds: AddProtocolAction = async ({ url }, { signal }) => {
  const img = await pixels(url.replace('gibs://', 'https://'), signal);
  const [z, y, x] = url.match(/(\d+)\/(\d+)\/(\d+)\.jpg$/)!.slice(1).map(Number);
  fillNoData(img.data, img.width, img.height, { z, x, y });
  return { data: await createImageBitmap(img) };
};

/** Upstream URL of one geostationary tile; `time` is a frame (ISO) or `latest-<bucket>`. */
function geoUrl(g: Geo, time: string, z: number, x: number, y: number): string {
  if ('gibs' in g) return `${GIBS}/${g.gibs}/default/${time}/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`;
  const when = time.startsWith('latest') ? `&_=${time.slice(7)}` : `&time=${new Date(time).toISOString()}`;
  return `${EUMETSAT}&layers=${g.wms}&bbox=${tileBbox(z, x, y)}${when}`;
}

/**
 * `live://<satellite>/<clouds|ir>/<time>/<z>/<x>/<y>` — one satellite's infrared, blended with its
 * neighbours by viewing angle. `clouds` turns it into white cloud (moonlit grey on the night side)
 * over the imagery; `ir` keeps the infrared itself, the coldest tops coloured.
 */
const loadLive: AddProtocolAction = async ({ url }, { signal }) => {
  const parts = url.slice('live://'.length).split('/');
  const [id, mode, time] = parts;
  const [z, x, y] = tileXYZ(parts);
  const i = GEO.findIndex((g) => g.id === id);
  const g = GEO[i];
  if (!g) throw new Error(`unknown satellite ${id}`);
  const img = await pixels(geoUrl(g, time, z, x, y), signal);
  const { width: w, height: h, data: px } = img;
  const { lat, lon } = tileAxes(z, x, y, w);
  const cosLat = lat.map(Math.cos);
  const toNadir = GEO.slice(0, i + 1).map((s) => lon.map((l) => Math.cos(l - s.lon * RAD)));
  const sun = sunAxes(lat, lon, time.startsWith('latest') ? Date.now() : Date.parse(time));
  for (let r = 0; r < h; r++) {
    const row = Math.min(r, lat.length - 1);
    for (let c = 0; c < w; c++) {
      const k = 4 * (r * w + c);
      if (px[k + 3] === 0) continue;
      const weight = geoWeight((j) => cosLat[row] * toNadir[j][c], i);
      if (weight === 0) { px[k + 3] = 0; continue; }
      if (mode === 'ir') {
        if (!('gibs' in g)) colorizeIr(px, k);
        px[k + 3] *= weight * 0.9;
        continue;
      }
      const cloud = cloudiness(g, px[k], px[k + 1], px[k + 2]);
      const day = daylight(sun.a[row] + sun.b[row] * sun.c[c]);
      const shade = 140 + 115 * day;
      px[k] = shade;
      px[k + 1] = shade;
      px[k + 2] = Math.min(255, shade + 10 * (1 - day));
      px[k + 3] *= cloud * weight;
    }
  }
  return { data: await createImageBitmap(img) };
};

/** EUMETSAT's plain grey infrared in the same spirit as GIBS's enhanced palette: cold tops coloured. */
function colorizeIr(px: Uint8ClampedArray, k: number) {
  const v = px[k];
  if (v < 150) return;
  const t = (v - 150) / 105; // 0 → 1 over the coldest tops
  const stops = [[80, 140, 255], [60, 220, 120], [250, 230, 60], [255, 70, 50], [230, 60, 230]];
  const f = t * (stops.length - 1);
  const s = Math.min(stops.length - 2, Math.floor(f));
  const u = f - s;
  for (let ch = 0; ch < 3; ch++) px[k + ch] = stops[s][ch] + (stops[s + 1][ch] - stops[s][ch]) * u;
}

/** How opaque full night is: the Black Marble's near-black and its lights, over the daylight imagery. */
const NIGHT_MAX = 0.94;
/** Black Marble's own dark, which the shade paints so the lights can arrive later without a seam. */
const NIGHT_RGB = [6, 9, 20];

/**
 * `shade://<ms>/<z>/<x>/<y>` — the dark of the night side at `<ms>`, computed, no download, so the
 * dark lands with the daylight imagery instead of waiting on GIBS. Per-pixel, so none of the polygon
 * trouble at the poles the old terminator had; the twilight ramp is ~10° wide, so 64 px is plenty.
 */
const loadShade: AddProtocolAction = async ({ url }) => {
  const parts = url.slice('shade://'.length).split('/');
  const [z, x, y] = tileXYZ(parts);
  const size = 64;
  const img = new ImageData(size, size);
  const { lat, lon } = tileAxes(z, x, y, size);
  const sun = sunAxes(lat, lon, Number(parts[0]));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const k = 4 * (r * size + c);
      img.data.set(NIGHT_RGB, k);
      img.data[k + 3] = 255 * NIGHT_MAX * (1 - daylight(sun.a[r] + sun.b[r] * sun.c[c]));
    }
  }
  return { data: await createImageBitmap(img) };
};

/** Black Marble tiles already fetched: the lights are a 2016 composite, so they never change. */
const marble = new Map<string, Promise<ImageData>>();

/**
 * `night://<ms>/<z>/<x>/<y>` — NASA's Black Marble city lights on top of the shade, shown only where
 * the sun is down at `<ms>`. Only the lights are opaque, so the shade underneath does the darkening.
 */
const loadNight: AddProtocolAction = async ({ url }) => {
  const parts = url.slice('night://'.length).split('/');
  const [z, x, y] = tileXYZ(parts);
  const key = `${z}/${y}/${x}`;
  let got = marble.get(key);
  if (!got) {
    // ponytail: FIFO of 96 tiles (~25 MB), an LRU if panning around evicts what's on screen.
    if (marble.size >= 96) marble.delete(marble.keys().next().value!);
    got = pixels(`${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${key}.png`, new AbortController().signal);
    got.catch(() => marble.delete(key));
    marble.set(key, got);
  }
  const src = await got;
  const { width: w, height: h } = src;
  const px = new Uint8ClampedArray(src.data);
  const { lat, lon } = tileAxes(z, x, y, w);
  const sun = sunAxes(lat, lon, Number(parts[0]));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const k = 4 * (r * w + c);
      const night = 1 - daylight(sun.a[r] + sun.b[r] * sun.c[c]);
      px[k + 3] = night > 0 ? 255 * NIGHT_MAX * night * smooth(24, 110, Math.max(px[k], px[k + 1], px[k + 2])) : 0;
    }
  }
  return { data: await createImageBitmap(new ImageData(px, w, h)) };
};

/** NOAA SWPC OVATION: aurora probability on a 1° grid, lon-major (index lon·181 + lat+90). */
let auroraGrid: Float32Array | null = null;

/** `aurora://<version>/<z>/<x>/<y>` — the oval, green, brighter on the night side where it can be seen. */
const loadAurora: AddProtocolAction = async ({ url }) => {
  const parts = url.slice('aurora://'.length).split('/');
  const [z, x, y] = tileXYZ(parts);
  const size = 256;
  const img = new ImageData(size, size);
  const grid = auroraGrid;
  if (grid) {
    const { lat, lon } = tileAxes(z, x, y, size);
    const sun = sunAxes(lat, lon, Date.now());
    for (let r = 0; r < size; r++) {
      const la = lat[r] / RAD;
      if (Math.abs(la) < 35) continue;
      const fy = la + 90;
      const j0 = Math.min(179, Math.floor(fy));
      const v0 = fy - j0;
      for (let c = 0; c < size; c++) {
        const fx = ((lon[c] / RAD) % 360 + 360) % 360;
        const i0 = Math.floor(fx) % 360;
        const i1 = (i0 + 1) % 360;
        const u = fx - Math.floor(fx);
        const v = (grid[i0 * 181 + j0] * (1 - u) + grid[i1 * 181 + j0] * u) * (1 - v0)
          + (grid[i0 * 181 + j0 + 1] * (1 - u) + grid[i1 * 181 + j0 + 1] * u) * v0;
        const a = smooth(3, 45, v) * (0.3 + 0.7 * (1 - daylight(sun.a[r] + sun.b[r] * sun.c[c])));
        if (a <= 0) continue;
        const hot = smooth(55, 90, v);
        const k = 4 * (r * size + c);
        img.data[k] = 70 + 150 * hot;
        img.data[k + 1] = 255 - 60 * hot;
        img.data[k + 2] = 150 + 80 * hot;
        img.data[k + 3] = 255 * 0.85 * a;
      }
    }
  }
  return { data: await createImageBitmap(img) };
};

export function registerSky(ml: typeof import('maplibre-gl')) {
  ml.addProtocol('gibs', loadClouds);
  ml.addProtocol('live', loadLive);
  ml.addProtocol('shade', loadShade);
  ml.addProtocol('night', loadNight);
  ml.addProtocol('aurora', loadAurora);
}

// ── senses ─────────────────────────────────────────────────────────────────

interface Sense {
  label: string;
  note: string;
  legend?: string;
  /** A GIBS layer (daily unless `step` gives minutes). */
  gibs?: { layer: string; tms: string; step?: number };
}

const legend = (name: string) => `https://gibs.earthdata.nasa.gov/legends/${name}_H.svg`;

export const SENSES: Record<SenseId, Sense> = {
  ir: { label: 'Infrared', note: 'Cloud-top temperature from the geostationary ring. Colours are the coldest, tallest storm tops.', legend: legend('Clean_Longwave_Infrared_Window_Band') },
  rain: { label: 'Rain', note: 'Satellite rain rate everywhere, oceans included (NASA IMERG, ~6 h behind).', legend: legend('GPM_Precipitation_Rate'), gibs: { layer: 'IMERG_Precipitation_Rate_30min', tms: 'GoogleMapsCompatible_Level6', step: 30 } },
  radar: { label: 'Radar', note: 'Ground weather radar every 10 min, where countries run it (RainViewer).' },
  sst: { label: 'Sea temperature', note: 'Sea-surface temperature, daily (GHRSST MUR).', legend: legend('GHRSST_Sea_Surface_Temperature'), gibs: { layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature', tms: 'GoogleMapsCompatible_Level7' } },
  heatwave: { label: 'Marine heatwaves', note: 'How far the sea is from its normal temperature for the date.', legend: legend('GHRSST_Sea_Surface_Temperature_Anomalies'), gibs: { layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', tms: 'GoogleMapsCompatible_Level7' } },
  smoke: { label: 'Smoke & dust', note: 'Aerosol optical depth: smoke, dust and haze in the air (MODIS, daily).', legend: legend('MODIS_Combined_Value_Added_AOD'), gibs: { layer: 'MODIS_Combined_Value_Added_AOD', tms: 'GoogleMapsCompatible_Level6' } },
  snow: { label: 'Snow', note: 'Snow cover seen from orbit (MODIS, daily; clouds hide the ground).', legend: legend('MODIS_NDSI_Snow_Cover'), gibs: { layer: 'MODIS_Terra_L3_NDSI_Snow_Cover_Daily', tms: 'GoogleMapsCompatible_Level8' } },
  ice: { label: 'Sea ice', note: 'Sea-ice concentration, daily (GHRSST MUR).', legend: legend('GHRSST_Sea_Ice_Concentration'), gibs: { layer: 'GHRSST_L4_MUR_Sea_Ice_Concentration', tms: 'GoogleMapsCompatible_Level7' } },
  co: { label: 'Carbon monoxide', note: 'Carbon monoxide at 500 hPa, the trail of fires and cities (AIRS, daily).', legend: legend('AIRS_Carbon_Monoxide_Volume_Mixing_Ratio'), gibs: { layer: 'AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day', tms: 'GoogleMapsCompatible_Level6' } },
};

const zoomOf = (tms: string) => Number(tms.match(/Level(\d+)$/)![1]);

// ── overlays: the raster layers, in draw order ─────────────────────────────

const fadeBy = (from: number, to: number, max = 1): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], from, max, to, 0];

export interface Overlay { id: string; maxzoom: number; opacity: ExpressionSpecification | number; attribution: string }

const NASA = '<a href="https://worldview.earthdata.nasa.gov" target="_blank" rel="noopener noreferrer">NASA EOSDIS GIBS</a>';
const EUM = '© <a href="https://view.eumetsat.int" target="_blank" rel="noopener noreferrer">EUMETSAT</a>';

export const OVERLAYS: Overlay[] = [
  // Faded out by the zoom GIBS runs out of detail at, so close-in views keep Esri's sharpness.
  { id: 'clouds', maxzoom: 8, opacity: ['interpolate', ['linear'], ['zoom'], 2, 0.62, 5, 0.5, 7.5, 0], attribution: NASA },
  { id: 'shade', maxzoom: 5, opacity: fadeBy(8, 11), attribution: '' },
  { id: 'night', maxzoom: 8, opacity: fadeBy(8, 11), attribution: NASA },
  ...GEO.map((g) => ({ id: `live-${g.id}`, maxzoom: 6, opacity: fadeBy(5.5, 8), attribution: 'gibs' in g ? NASA : EUM })),
  ...(Object.entries(SENSES) as [SenseId, Sense][]).filter(([, s]) => s.gibs)
    .map(([id, s]) => ({ id: `sense-${id}`, maxzoom: zoomOf(s.gibs!.tms), opacity: fadeBy(zoomOf(s.gibs!.tms) + 1, zoomOf(s.gibs!.tms) + 3, 0.8), attribution: NASA })),
  { id: 'sense-radar', maxzoom: 7, opacity: fadeBy(9, 11, 0.8), attribution: '<a href="https://www.rainviewer.com" target="_blank" rel="noopener noreferrer">RainViewer</a>' },
  { id: 'aurora', maxzoom: 5, opacity: fadeBy(6, 8), attribution: 'NOAA SWPC' },
  { id: 'lightning', maxzoom: 9, opacity: 1, attribution: EUM },
];
export const OVERLAY_IDS = new Set(OVERLAYS.map((o) => o.id));

export interface Radar { host: string; frames: { time: number; path: string }[] }

export interface When {
  /** The moment on screen: null = now. */
  t: number | null;
  /** Wall clock, bucketed so tiles that depend on it refresh every few minutes, not every frame. */
  now: number;
  /** Latest GIBS frame per geostationary satellite. */
  frames: Record<string, string> | null;
  radar: Radar | null;
  /** Version of the loaded aurora grid; 0 = none yet. */
  aurora: number;
}

/** Frames this recent count as "now": the ring's own latency is ~25–60 min. */
const LIVE_WINDOW = 45 * 60_000;

/** Tile URL per overlay for this sky at this moment; null = hidden. */
export function skyTiles(sky: Sky, w: When): Record<string, string[] | null> {
  const live = w.t === null || w.t > w.now - LIVE_WINDOW;
  const at = w.t ?? w.now;
  const out: Record<string, string[] | null> = {};

  // The day's composite: yesterday's while live; in the past, that day's (MODIS before VIIRS NOAA-20 flew).
  const day = [isoDay(at), cloudsDate(w.now)].sort()[0];
  const truecolor = day < '2018-01-05' ? 'MODIS_Terra_CorrectedReflectance_TrueColor' : 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';
  const oldDay = w.t !== null && w.t < w.now - 36 * 3600_000;
  out.clouds = sky.clouds || oldDay
    ? [`gibs://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${truecolor}/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`]
    : null;

  out.shade = sky.night ? [`shade://${floorTo(at, 5)}/{z}/{x}/{y}`] : null;
  out.night = sky.night ? [`night://${floorTo(at, 5)}/{z}/{x}/{y}`] : null;

  const ringMode = sky.sense === 'ir' ? 'ir' : sky.live ? 'clouds' : null;
  for (const g of GEO) {
    let time: string | null = null;
    if (ringMode && live) time = 'gibs' in g ? w.frames?.[g.id] ?? null : `latest-${floorTo(w.now, 10)}`;
    else if (ringMode) time = 'gibs' in g ? gibsTime(floorTo(at, g.cadence)) : new Date(floorTo(at, g.cadence)).toISOString();
    out[`live-${g.id}`] = time ? [`live://${g.id}/${ringMode}/${time}/{z}/{x}/{y}`] : null;
  }

  for (const [id, s] of Object.entries(SENSES) as [SenseId, Sense][]) {
    if (!s.gibs) continue;
    const time = w.t === null ? 'default' : s.gibs.step ? gibsTime(floorTo(at, s.gibs.step)) : isoDay(at);
    out[`sense-${id}`] = sky.sense === id ? [`${GIBS}/${s.gibs.layer}/default/${time}/${s.gibs.tms}/{z}/{y}/{x}.png`] : null;
  }

  // Radar keeps ~2 h of frames: the nearest one at or before the moment, if it's within 15 min.
  const frame = w.radar?.frames.filter((f) => f.time * 1000 <= at + 60_000).at(-1);
  out['sense-radar'] = sky.sense === 'radar' && w.radar && frame && at - frame.time * 1000 < 15 * 60_000
    ? [`${w.radar.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`]
    : null;

  // OVATION is a nowcast: no past to show.
  out.aurora = sky.aurora && w.aurora && live ? [`aurora://${w.aurora}/{z}/{x}/{y}`] : null;

  const flashes = live ? `&_=${floorTo(w.now, 5)}` : `&time=${new Date(floorTo(at, 5)).toISOString()}`;
  out.lightning = sky.lightning ? [`${EUMETSAT}&layers=mtg_fd:li_afa&bbox={bbox-epsg-3857}${flashes}`] : null;
  return out;
}

// ── data the overlays need ─────────────────────────────────────────────────

/** Wall-clock time, re-read every `ms` (bucketed, so it only changes that often). */
export function useClock(ms: number): number {
  const [now, setNow] = useState(() => floorTo(Date.now(), ms / 60_000));
  useEffect(() => {
    const t = window.setInterval(() => setNow(floorTo(Date.now(), ms / 60_000)), 30_000);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * The newest frame GIBS has for each geostationary satellite, from its DescribeDomains answer (a few
 * hundred bytes, unlike the 6 MB capabilities). GIBS 404s a time past its newest frame, so "now" can't
 * simply be asked for; `default` would work but never changes URL, so tiles would never refresh.
 */
export function useGeoFrames(on: boolean): Record<string, string> | null {
  const [frames, setFrames] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!on) return;
    const ctrl = new AbortController();
    let timer = 0;
    const load = async () => {
      const now = Date.now();
      const range = `${gibsTime(now - 6 * 3600_000)}--${gibsTime(now + 3600_000)}`;
      const got: Record<string, string> = {};
      await Promise.all(GEO.map(async (g) => {
        if (!('gibs' in g)) return;
        try {
          const r = await fetch(`${GIBS}/1.0.0/${g.gibs}/default/GoogleMapsCompatible_Level6/all/${range}.xml`, { signal: ctrl.signal });
          const times = (await r.text()).match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/g);
          if (times) got[g.id] = times.sort().at(-1)!;
        } catch { /* keep the previous frame */ }
      }));
      if (!ctrl.signal.aborted) setFrames((prev) => ({ ...prev, ...got }));
      if (!ctrl.signal.aborted) timer = window.setTimeout(load, 5 * 60_000);
    };
    void load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on]);
  return frames;
}

/** RainViewer's list of radar frames (the last ~2 h, every 10 min). */
export function useRadar(on: boolean): Radar | null {
  const [radar, setRadar] = useState<Radar | null>(null);
  useEffect(() => {
    if (!on) return;
    const ctrl = new AbortController();
    let timer = 0;
    const load = async () => {
      try {
        const j = (await (await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: ctrl.signal })).json()) as
          { host: string; radar: { past: { time: number; path: string }[] } };
        setRadar({ host: j.host, frames: j.radar.past });
      } catch { /* keep the last list */ }
      if (!ctrl.signal.aborted) timer = window.setTimeout(load, 5 * 60_000);
    };
    void load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on]);
  return radar;
}

/** Loads the OVATION aurora grid for the `aurora://` tiles; returns its version (0 until loaded). */
export function useAurora(on: boolean): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!on) return;
    const ctrl = new AbortController();
    let timer = 0;
    const load = async () => {
      try {
        const j = (await (await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', { signal: ctrl.signal })).json()) as
          { coordinates: [number, number, number][] };
        const grid = new Float32Array(360 * 181);
        for (const [lon, lat, v] of j.coordinates) grid[(Math.round(lon) % 360) * 181 + Math.round(lat) + 90] = v;
        auroraGrid = grid;
        setVersion(Date.now());
      } catch { /* keep the last grid */ }
      if (!ctrl.signal.aborted) timer = window.setTimeout(load, 10 * 60_000);
    };
    void load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on]);
  return version;
}
