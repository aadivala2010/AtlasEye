import type { Planet } from './events';

export const INTEL_CATEGORIES = {
  conflicts: { label: 'Conflicts', color: '#D18484', query: '(war OR ceasefire OR diplomacy OR sanctions)' },
  news: { label: 'News', color: '#83B8EA', query: '(government OR international OR election OR infrastructure)' },
  accidents: { label: 'Accidents', color: '#E8B56C', query: '("plane crash" OR "aircraft accident" OR "ship collision" OR "train derailment")' },
  disasters: { label: 'Disasters', color: '#EE996E', query: null },
  safety: { label: 'Public safety', color: '#CFC787', query: '(evacuation OR "humanitarian crisis" OR "public safety advisory")' },
  internet: { label: 'Internet', color: '#B89AE0', query: '("internet outage" OR "internet shutdown" OR "communications disruption")' },
  economics: { label: 'Economics', color: '#8DC6A8', query: '(inflation OR "economic growth" OR "international trade")' },
  space: { label: 'Space', color: '#78CBD5', query: '("space launch" OR "space mission" OR "scientific discovery")' },
  infrastructure: { label: 'Infrastructure', color: '#9AAFC8', query: '("power outage" OR "airport closure" OR "port disruption")' },
} as const;
export type IntelCategory = keyof typeof INTEL_CATEGORIES;
export const INTEL_IDS = Object.keys(INTEL_CATEGORIES) as IntelCategory[];
export interface IntelEvent {
  id: string; category: IntelCategory; title: string; summary: string;
  lat: number | null; lon: number | null; location: string;
  precision: 'point' | 'region' | 'country' | 'unknown';
  eventTime: number | null; publishedAt: number | null; observedAt: number; retrievedAt: number;
  sourceName: string; sourceUrl: string; status: 'Official report' | 'Reported';
  earthId?: string;
}
export interface IntelFeed { events: IntelEvent[]; updatedAt: number | null; status: 'ok' | 'stale' | 'unavailable' }
export interface IntelSettings { categories: IntelCategory[]; hours: number; selected: string; query: string; scope: 'world' | 'viewport' }
export const INTEL_DEFAULT: IntelSettings = { categories: ['news', 'disasters'], hours: 24, selected: '', query: '', scope: 'world' };
export function readIntel(query: string): IntelSettings {
  const p = new URLSearchParams(query);
  return { categories: p.has('intel') ? INTEL_IDS.filter(id => p.get('intel')!.split(',').includes(id)) : INTEL_DEFAULT.categories,
    hours: [1, 6, 24, 72, 168].includes(Number(p.get('intelHours'))) ? Number(p.get('intelHours')) : 24,
    selected: (p.get('intelEvent') ?? '').slice(0, 300), query: (p.get('intelQuery') ?? '').slice(0, 120), scope: p.get('intelScope') === 'viewport' ? 'viewport' : 'world' };
}
export function writeIntel(p: URLSearchParams, settings: IntelSettings) {
  p.set('intel', settings.categories.join(',')); p.set('intelHours', String(settings.hours));
  if (settings.selected) p.set('intelEvent', settings.selected);
  if (settings.query) p.set('intelQuery', settings.query);
  if (settings.scope !== 'world') p.set('intelScope', settings.scope);
}
export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 3000) return null;
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}
export function deduplicateIntel(events: IntelEvent[]): IntelEvent[] {
  // Exact normalized source URLs only: syndicated coverage is not independent corroboration.
  const seen = new Set<string>();
  return events.filter(e => {
    const key = e.sourceUrl;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => b.observedAt - a.observedAt);
}
export function planetIntel(planet: Planet, retrievedAt: number): IntelEvent[] {
  return [
    ...(planet.quakes ?? []).map((q): IntelEvent => ({ id: `q:${q.id}`, earthId: `q:${q.id}`, category: 'disasters', title: `M${q.mag.toFixed(1)} earthquake · ${q.place}`,
      summary: `Depth ${q.depth.toFixed(1)} km. ${q.tsunami ? 'USGS tsunami flag; consult official tsunami advisories.' : ''}`,
      lat: q.lat, lon: q.lon, location: q.place, precision: 'point', eventTime: q.at, publishedAt: null, observedAt: q.at, retrievedAt,
      sourceName: 'USGS', sourceUrl: safeSourceUrl(q.url) ?? 'https://earthquake.usgs.gov/', status: 'Official report' })),
    ...(planet.events ?? []).map((e): IntelEvent => ({ id: `v:${e.id}`, earthId: `v:${e.id}`, category: 'disasters', title: e.title,
      summary: [e.category, e.magnitude].filter(Boolean).join(' · '), lat: e.lat, lon: e.lon, location: e.title, precision: 'region',
      eventTime: e.at, publishedAt: null, observedAt: e.at, retrievedAt, sourceName: 'NASA EONET',
      sourceUrl: `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(e.id)}`, status: 'Official report' })),
    ...(planet.launches ?? []).map((l): IntelEvent => ({ id: `l:${l.id}`, category: 'space', title: l.name, summary: `${l.provider} · ${l.status}. Launch times may change.`,
      lat: l.lat, lon: l.lon, location: l.pad, precision: 'point', eventTime: l.net, publishedAt: null, observedAt: l.net, retrievedAt,
      sourceName: 'The Space Devs', sourceUrl: `https://ll.thespacedevs.com/2.3.0/launches/${encodeURIComponent(l.id)}/`, status: 'Reported' })),
  ];
}
