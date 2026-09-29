/**
 * The catalogs that ride alongside the cameras:
 *
 *   public/data/iss.json    live video from the International Space Station, taken from the YouTube
 *                           snapshots `npm run import` keeps in data/upstream/. It has no fixed pin on
 *                           the ground, so it plays on the ISS itself in the satellite layer.
 *   public/data/radio.json  live radio with a place on the map, from Radio Browser: HTTPS streams only
 *                           (an https page can't play http audio), not HLS, last check OK.
 *
 *   npm run extras
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Station } from '../lib/radio';

interface Feed { id: string; name: string; source: 'famelack' | 'camlisted' }

const ISS_TITLE = /\bISS\b|International Space Station/i;
/** Looped footage set to music calls itself "ISS" too; it isn't a view from the station. */
const NOT_A_VIEW = /music|ambient|relax|sleep|lo-?fi/i;
const youtubeId = (url: string) => url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)?.[1];
/** "🔴 Live Now: 24/7 NASA Live Stream of Earth from Space (ISS)" → "NASA Live Stream of Earth from Space (ISS)". */
export const tidyTitle = (t: string) => t.normalize('NFKC')
  .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '')
  .replace(/^\s*(live now|live)\s*[:|-]\s*/i, '')
  .replace(/\b24\/7\b\s*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function issFeeds(excluded: Set<string>): Feed[] {
  const feeds = new Map<string, Feed>();
  const famelack = JSON.parse(readFileSync('data/upstream/famelack.json', 'utf8')) as
    { all: { name: string; sources: { youtube?: string[] }; isGeoBlocked: boolean }[] };
  for (const e of famelack.all) {
    if (e.isGeoBlocked || !ISS_TITLE.test(e.name) || NOT_A_VIEW.test(e.name)) continue;
    const id = e.sources.youtube?.map(youtubeId).find(Boolean);
    if (id && !excluded.has(id) && !feeds.has(id)) feeds.set(id, { id, name: tidyTitle(e.name), source: 'famelack' });
  }
  // The snapshot holds only streams camlisted saw live, embeddable and approved.
  const camlisted = JSON.parse(readFileSync('data/upstream/camlisted.json', 'utf8')) as { streams: { video_id: string; title: string }[] };
  for (const s of camlisted.streams) {
    if (!ISS_TITLE.test(s.title) || NOT_A_VIEW.test(s.title) || excluded.has(s.video_id) || feeds.has(s.video_id)) continue;
    feeds.set(s.video_id, { id: s.video_id, name: tidyTitle(s.title), source: 'camlisted' });
  }
  // Views of Earth first; a tracker map is the least interesting thing to open on.
  return [...feeds.values()].sort((a, b) => Number(/tracker/i.test(a.name)) - Number(/tracker/i.test(b.name)));
}

// ── radio ──────────────────────────────────────────────────────────────────

export interface RawStation {
  stationuuid: string; name: string; url_resolved: string; geo_lat: number | null; geo_long: number | null;
  countrycode: string; tags: string; codec: string; bitrate: number; hls: number; lastcheckok: number; votes: number;
}

/** Radio Browser's list → stations that can play here, one per stream, most-voted first. */
export function pickStations(raw: RawStation[]): Station[] {
  const seen = new Set<string>();
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  return raw
    .filter((r) => r.url_resolved?.startsWith('https://') && r.hls !== 1 && r.lastcheckok === 1
      && Number.isFinite(r.geo_lat) && Number.isFinite(r.geo_long) && !(r.geo_lat === 0 && r.geo_long === 0)
      && Math.abs(r.geo_lat!) <= 90 && Math.abs(r.geo_long!) <= 180)
    .sort((a, b) => b.votes - a.votes)
    .filter((r) => !seen.has(r.url_resolved) && !!seen.add(r.url_resolved))
    .map((r) => ({
      id: r.stationuuid,
      name: r.name.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unnamed station',
      url: r.url_resolved,
      lat: round(r.geo_lat!),
      lon: round(r.geo_long!),
      cc: r.countrycode.toUpperCase(),
      tags: r.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 3).join(', '),
      codec: r.codec,
      kbps: r.bitrate,
    }));
}

const UA = { 'user-agent': 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)' };

async function radioStations(): Promise<Station[]> {
  // Radio Browser asks clients to take a server from its list rather than hard-code one.
  const servers = await fetch('https://all.api.radio-browser.info/json/servers', { headers: UA })
    .then((r) => r.json() as Promise<{ name: string }[]>).catch(() => []);
  for (const host of [...new Set([...servers.map((s) => s.name), 'de1.api.radio-browser.info'])]) {
    try {
      const r = await fetch(`https://${host}/json/stations/search?has_geo_info=true&is_https=true&hidebroken=true&limit=200000`, { headers: UA });
      if (!r.ok) continue;
      const stations = pickStations((await r.json()) as RawStation[]);
      if (stations.length) return stations;
    } catch { /* try the next server */ }
  }
  return [];
}

if (process.argv[1]?.endsWith('import-extras.ts')) {
  const builtAt = new Date().toISOString();
  const excluded = new Set(JSON.parse(readFileSync('data/excluded.json', 'utf8')) as string[]);
  const feeds = issFeeds(excluded);
  if (!feeds.length) console.warn('  ⚠ no ISS feeds found upstream; keeping the old list');
  else writeFileSync('public/data/iss.json', JSON.stringify({ builtAt, feeds }));
  console.log(`  iss    ${feeds.length} live feeds`);

  const stations = await radioStations();
  // Radio Browser down is a reason to keep last week's list, not to empty the map.
  if (stations.length < 1000) console.warn(`  ⚠ only ${stations.length} stations from Radio Browser; keeping the old list`);
  else writeFileSync('public/data/radio.json', JSON.stringify({ builtAt, count: stations.length, stations }));
  console.log(`  radio  ${stations.length} stations`);
}
