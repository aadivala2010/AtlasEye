import type { Stream } from './stream';
import { subsolarPoint, sunAltitude } from './solar';

export type WallMode = 'view' | 'world' | 'sunrise' | 'sunset';

/** YouTube embeds are the heavy players: at most this many on a wall. */
export const MAX_YOUTUBE = 4;

/** Whether the sun is rising or setting at a stream right now (within a few degrees of the horizon), or neither. */
export function sunPhase(s: Pick<Stream, 'latitude' | 'longitude'>, now: number): 'rise' | 'set' | null {
  const alt = sunAltitude(s.latitude, s.longitude, subsolarPoint(new Date(now)));
  if (alt < -4 || alt > 8) return null;
  const later = sunAltitude(s.latitude, s.longitude, subsolarPoint(new Date(now + 10 * 60_000)));
  return later > alt ? 'rise' : 'set';
}

/**
 * `n` streams for a wall, shuffled: live video favoured over stills, better-placed streams over
 * weaker ones, one per place (per country with `perCountry`), and no more than MAX_YOUTUBE embeds.
 */
export function pickWall(pool: Stream[], n: number, perCountry: boolean, random = Math.random): Stream[] {
  const ranked = pool
    .map((s) => ({ s, k: random() * (s.kind === 'snapshot' ? 0.3 : 1) * (0.5 + s.confidence) }))
    .sort((a, b) => b.k - a.k);
  const out: Stream[] = [];
  const taken = new Set<string>();
  let youtube = 0;
  for (const { s } of ranked) {
    if (out.length === n) break;
    const key = perCountry ? s.country : s.place;
    if (taken.has(key) || (s.kind === 'youtube' && youtube === MAX_YOUTUBE)) continue;
    if (s.kind === 'youtube') youtube++;
    taken.add(key);
    out.push(s);
  }
  return out;
}
