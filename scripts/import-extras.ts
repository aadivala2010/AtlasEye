/**
 * The catalogs that ride alongside the cameras:
 *
 *   public/data/iss.json   live video from the International Space Station, taken from the YouTube
 *                          snapshots `npm run import` keeps in data/upstream/. It has no fixed pin on
 *                          the ground, so it plays on the ISS itself in the satellite layer.
 *
 *   npm run extras
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Feed { id: string; name: string; source: 'famelack' | 'camlisted' }

const ISS_TITLE = /\bISS\b|International Space Station/i;
/** Looped footage set to music calls itself "ISS" too; it isn't a view from the station. */
const NOT_A_VIEW = /music|ambient|relax|sleep|lo-?fi/i;
const excluded = new Set(JSON.parse(readFileSync('data/excluded.json', 'utf8')) as string[]);
const youtubeId = (url: string) => url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)?.[1];
/** "🔴 Live Now: 24/7 NASA Live Stream of Earth from Space (ISS)" → "NASA Live Stream of Earth from Space (ISS)". */
export const tidyTitle = (t: string) => t.normalize('NFKC')
  .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '')
  .replace(/^\s*(live now|live)\s*[:|-]\s*/i, '')
  .replace(/\b24\/7\b\s*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function issFeeds(): Feed[] {
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

if (process.argv[1]?.endsWith('import-extras.ts')) {
  const builtAt = new Date().toISOString();
  const feeds = issFeeds();
  if (!feeds.length) console.warn('  ⚠ no ISS feeds found upstream; keeping the old list');
  else writeFileSync('public/data/iss.json', JSON.stringify({ builtAt, feeds }));
  console.log(`  iss    ${feeds.length} live feeds`);
}
