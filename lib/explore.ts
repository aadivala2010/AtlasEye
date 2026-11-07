import { distanceKm } from './geo';
import { SKY_DEFAULT, type Sky } from './sky';
import type { Layers } from '@/components/chrome/Header';
import type { Camera } from '@/components/globe/GlobeView';
import type { PulseItem } from './events';
import type { Flight } from './flights';

export interface Place { id: string; name: string; lat: number; lon: number; radius: number }
export const DEFAULT_LAYERS: Layers = { cameras: true, flights: true, airports: false, satellites: false, events: true, radio: false, dossier: false };
export const KINDS = ['quake', 'event', 'emergency', 'launch', 'aurora'] as const;
export interface AlertFilter { level: number; kinds: PulseItem['kind'][]; placeId: string }
export const DEFAULT_FILTER: AlertFilter = { level: 2, kinds: [...KINDS], placeId: '' };
export interface WeatherLayers { alerts: boolean; cyclones: boolean; radar: boolean }
export const WEATHER_OFF: WeatherLayers = { alerts: false, cyclones: false, radar: false };
export type Target = { kind: 'dossier'; lat: number; lon: number } | { kind: 'satellite'; id: number }
  | { kind: 'flight'; hex: string } | { kind: 'earth' | 'pulse'; lat?: number; lon?: number; eventId?: string };
export interface Scene { camera: Camera | null; stream: string | null; target: Target | null; layers: Layers; sky: Sky; snapshots: boolean; weather: WeatherLayers; follow: boolean }
export const validPoint = (lat: unknown, lon: unknown): boolean => typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
export const wrapLon = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;

export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  if (!/^\s*[+-]?\d+(?:\.\d+)?\s*[, ]\s*[+-]?\d+(?:\.\d+)?\s*$/.test(text)) return null;
  const [lat, lon] = text.trim().split(/[,\s]+/).map(Number);
  return validPoint(lat, lon) ? { lat, lon } : null;
}

export function readScene(search: string): Scene {
  const p = new URLSearchParams(search);
  const c = (p.get('c') ?? '').split(',').map(Number);
  const camera = c.length >= 3 && validPoint(c[1], c[0]) && c.every(Number.isFinite) && c[2] >= .5 && c[2] <= 18
    ? { lon: c[0], lat: c[1], zoom: c[2], bearing: Math.max(-180, Math.min(180, c[3] ?? 0)), pitch: Math.max(0, Math.min(70, c[4] ?? 0)) } : null;
  const layers = { ...DEFAULT_LAYERS };
  if (p.has('layers')) for (const key of Object.keys(layers) as (keyof Layers)[]) layers[key] = p.get('layers')!.split(',').includes(key);
  const sky = { ...SKY_DEFAULT };
  if (p.has('sky')) {
    const on = p.get('sky')!.split(',');
    for (const key of ['live', 'clouds', 'night', 'aurora', 'lightning', 'terrain'] as const) sky[key] = on.includes(key);
    sky.sense = ['rain', 'snow', 'smoke'].find((s) => on.includes(s)) as Sky['sense'] ?? null;
  }
  const weather = { ...WEATHER_OFF };
  for (const key of Object.keys(weather) as (keyof WeatherLayers)[]) weather[key] = (p.get('weather') ?? '').split(',').includes(key);
  let target: Target | null = null;
  const point = parseCoordinates(p.get('at') ?? '');
  const kind = p.get('target');
  if (kind === 'dossier' && point) target = { kind, ...point };
  if ((kind === 'earth' || kind === 'pulse')) target = { kind, ...point, eventId: p.get('event')?.slice(0, 200) };
  if (kind === 'satellite' && /^\d{1,9}$/.test(p.get('id') ?? '')) target = { kind, id: Number(p.get('id')) };
  if (kind === 'flight' && /^[a-f\d]{6}$/i.test(p.get('id') ?? '')) target = { kind, hex: p.get('id')!.toLowerCase() };
  return { camera, layers, sky, weather, target, stream: p.get('s')?.slice(0, 200) ?? null, snapshots: p.get('snap') !== '0', follow: p.get('follow') === '1' };
}

export function sceneQuery(s: Scene): string {
  const p = new URLSearchParams();
  if (s.camera) { const c = s.camera; p.set('c', [wrapLon(c.lon).toFixed(4), c.lat.toFixed(4), c.zoom.toFixed(2), (c.bearing ?? 0).toFixed(1), (c.pitch ?? 0).toFixed(1)].join(',')); }
  if (s.stream) p.set('s', s.stream);
  p.set('layers', Object.entries(s.layers).filter(([, on]) => on).map(([id]) => id).join(','));
  p.set('sky', [...Object.entries(s.sky).filter(([k, v]) => k !== 'sense' && v === true).map(([k]) => k), ...(s.sky.sense ? [s.sky.sense] : [])].join(','));
  p.set('snap', s.snapshots ? '1' : '0');
  const weather = Object.entries(s.weather).filter(([, on]) => on).map(([id]) => id).join(',');
  if (weather) p.set('weather', weather);
  const t = s.target;
  if (t) {
    p.set('target', t.kind);
    if ('lat' in t && t.lat !== undefined && t.lon !== undefined) p.set('at', `${t.lat.toFixed(5)},${t.lon.toFixed(5)}`);
    if ('id' in t) p.set('id', String(t.id));
    if ('hex' in t) p.set('id', t.hex);
    if ('eventId' in t && t.eventId) p.set('event', t.eventId);
  }
  if (s.follow && t?.kind === 'satellite') p.set('follow', '1');
  return p.toString();
}

export function readPreferences(raw: string | null): { places: Place[]; filter: AlertFilter } {
  const fallback = { places: [], filter: DEFAULT_FILTER };
  try {
    const j = JSON.parse(raw ?? 'null');
    if (!j || typeof j !== 'object') return fallback;
    const places: Place[] = Array.isArray(j.places) ? j.places.filter((p: Place) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= 80 && validPoint(p.lat, p.lon) && Number.isFinite(p.radius) && p.radius >= 1 && p.radius <= 2000).slice(0, 50) : [];
    const f = j.filter;
    const filter = f && [0, 1, 2].includes(f.level) && Array.isArray(f.kinds) && typeof f.placeId === 'string'
      ? { level: f.level, kinds: KINDS.filter((k) => f.kinds.includes(k)), placeId: places.some((p) => p.id === f.placeId) ? f.placeId : '' } : DEFAULT_FILTER;
    return { places, filter };
  } catch { return fallback; }
}

export function matchesAlert(item: PulseItem, filter: AlertFilter, places: Place[]) {
  if (item.level < filter.level || !filter.kinds.includes(item.kind)) return false;
  if (!filter.placeId) return true;
  const place = places.find((p) => p.id === filter.placeId);
  return !!place && distanceKm(place.lat, place.lon, item.lat, item.lon) <= place.radius;
}

export type Fix = { lon: number; lat: number; at: number };
export function appendFix(fixes: Fix[], flight: Pick<Flight, 'lat' | 'lon' | 'at'>, now: number): Fix[] {
  const recent = fixes.filter((p) => now - p.at <= 30 * 60_000);
  if (!validPoint(flight.lat, flight.lon) || flight.at > now + 10_000 || now - flight.at > 30 * 60_000 || (recent.length && flight.at <= recent.at(-1)!.at)) return recent;
  return [...recent, { lat: flight.lat, lon: flight.lon, at: flight.at }].slice(-180);
}
export function trailGeometry(fixes: Fix[]): GeoJSON.MultiLineString {
  const lines: number[][][] = [[]];
  fixes.forEach((p, i) => {
    const prev = fixes[i - 1];
    // Gaps and dateline crossings are not observed tracks; never draw a line through them.
    if (prev && (Math.abs(prev.lon - p.lon) > 180 || p.at - prev.at > 120_000)) lines.push([]);
    lines.at(-1)!.push([p.lon, p.lat]);
  });
  return { type: 'MultiLineString', coordinates: lines.filter((l) => l.length >= 2) };
}

export type MeasureMode = 'off' | 'distance' | 'area';
export function measurement(points: [number, number][]) {
  let km = 0, sum = 0;
  const rad = Math.PI / 180;
  for (let i = 0; i < points.length; i++) {
    const [lon, lat] = points[i], [nextLon, nextLat] = points[(i + 1) % points.length];
    if (i + 1 < points.length) km += distanceKm(lat, lon, nextLat, nextLon);
    sum += wrapLon(nextLon - lon) * rad * (2 + Math.sin(lat * rad) + Math.sin(nextLat * rad));
  }
  const surface = 4 * Math.PI * 6371 ** 2;
  const area = Math.abs(sum * 6371 ** 2 / 2) % surface;
  return { km, km2: points.length < 3 ? 0 : Math.min(area, surface - area) };
}

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
