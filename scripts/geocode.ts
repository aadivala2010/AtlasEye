/**
 * Offline gazetteer geocoder. Pure functions over data/gazetteer/cities.tsv.
 * See README → "How geocoding works" for the scoring rationale.
 */
import { readFileSync } from 'node:fs';
import { STOPWORDS } from './stopwords';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  country: string;
  admin1Code: string;
  admin1: string;
  population: number;
  timezone: string;
}

export interface Gazetteer {
  places: Place[];
  index: Map<string, Place[]>;
}

export interface GeocodeHit {
  place: Place;
  confidence: number;
  matched: string;
  field: 'title' | 'channel';
}

export type GeocodeResult = { ok: true; hit: GeocodeHit } | { ok: false; reason: string; best?: GeocodeHit };

/** Scripts written without spaces between words: matched by substring, not by word. */
const DENSE = '\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}\\p{sc=Thai}\\u30FC';
const DENSE_RUN = new RegExp(`[${DENSE}]+`, 'gu');
const WORD = new RegExp(`[[\\p{L}\\p{N}\\p{M}']--[${DENSE}]]+`, 'gv');
const IS_DENSE = new RegExp(`^[${DENSE}]+$`, 'u');

export const CONFIDENCE_THRESHOLD = 0.65;
const MAX_NGRAM = 6;
/** A top place holding less than this share of its name's population, with no state/prefecture named, is a coin flip. */
const MIN_NAME_SHARE = 0.75;
/** Words that, following a place name, make it part of a street or facility name. */
const FEATURE_SUFFIX = new Set([
  'street', 'st', 'avenue', 'ave', 'road', 'rd', 'boulevard', 'blvd', 'drive', 'dr', 'lane', 'ln', 'way',
  'highway', 'hwy', 'parkway', 'pkwy', 'pike', 'terrace', 'trail', 'court', 'ct', 'field', 'meadow', 'meadows',
  'county', 'township', 'mountain', 'mtn', 'creek', 'hall', 'college', 'university', 'river', 'subdivision', 'sub', 'peak', 'canyon', 'onsen',
]);
const DENSE_FEATURE_SUFFIX = '山川湖岳島峠';
const FEATURE_PREFIX = new Set([
  'mount', 'mt', 'lake', 'cape', 'monte', 'lago', 'rio', 'río', 'isla', 'piazza', 'plaza', 'praça', 'place',
  'via', 'calle', 'rue', 'avenida', 'straße', 'strasse', 'tred',
  // "Outer Banks", "South Dakota", "Great Lakes": the town name is the tail of a larger name.
  'north', 'south', 'east', 'west', 'great', 'outer', 'inner', 'upper', 'lower', 'little', 'big', 'old', 'new',
]);

/** Lowercase, fold Latin diacritics, collapse to space-separated words. */
export function normalize(s: string): string {
  const folded = s.normalize('NFKC').toLowerCase().normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
  if (IS_DENSE.test(folded.replace(/\s+/g, ''))) return folded.replace(/\s+/g, '');
  return (folded.match(WORD) ?? []).join(' ');
}

export function loadGazetteer(path = 'data/gazetteer/cities.tsv'): Gazetteer {
  const places: Place[] = [];
  const index = new Map<string, Place[]>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 10) continue;
    const place: Place = {
      name: f[1], lat: +f[2], lon: +f[3], country: f[4], admin1Code: f[5],
      admin1: f[6], population: +f[7], timezone: f[8],
    };
    places.push(place);
    const keys = new Set([f[1], ...f[9].split('|')].map(normalize).filter((k) => k.length >= 2));
    for (const k of keys) {
      if (STOPWORDS.has(k)) continue;
      const list = index.get(k);
      if (list) list.push(place);
      else index.set(k, [place]);
    }
  }
  return { places, index };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const isCapOrUncased = (c: string) => c !== c.toLowerCase() || c.toLowerCase() === c.toUpperCase();

interface Match { key: string; start: number; end: number; places: Place[] }

/** Every gazetteer name occurring in `text`, longest-first, non-overlapping. */
export function findMatches(g: Gazetteer, text: string, country?: string): Match[] {
  const src = text.normalize('NFKC');
  const found: Match[] = [];
  const add = (key: string, start: number, end: number) => {
    const all = g.index.get(key);
    if (!all) return;
    const places = country ? all.filter((p) => p.country === country) : all;
    if (places.length) found.push({ key, start, end, places });
  };

  const words = [...src.matchAll(WORD)].map((m) => ({ raw: m[0], start: m.index, end: m.index + m[0].length }));
  for (let i = 0; i < words.length; i++) {
    for (let j = i; j < Math.min(words.length, i + MAX_NGRAM); j++) {
      // "Duval Street", "Newton Field": the name belongs to a street or facility, not the town.
      const next = words[j + 1]?.raw.toLowerCase();
      // …but "Venice St. Mark's": St/Dr before another proper noun is Saint/Doctor.
      const titleAfter = (next === 'st' || next === 'dr') && words[j + 2] && isCapOrUncased(words[j + 2].raw[0]);
      if (next && FEATURE_SUFFIX.has(next) && !titleAfter) continue;
      // "Mount Fuji", "Lake Cumberland", "Piazza del Popolo": a natural feature or square, not the town.
      if (i > 0 && FEATURE_PREFIX.has(words[i - 1].raw.toLowerCase())) continue;
      // Place names are proper nouns: require capitalised first and last words ("nice view" ≠ Nice).
      if (!isCapOrUncased(words[i].raw[0]) || !isCapOrUncased(words[j].raw[0])) continue;
      add(normalize(words.slice(i, j + 1).map((w) => w.raw).join(' ')), words[i].start, words[j].end);
    }
  }
  for (const m of src.matchAll(DENSE_RUN)) {
    const run = m[0];
    for (let a = 0; a < run.length; a++) {
      for (let b = a + 2; b <= Math.min(run.length, a + 10); b++) {
        // 富士山 is Mount Fuji, not Fuji city: skip names followed by mountain/river/lake/peak/island.
        if (DENSE_FEATURE_SUFFIX.includes(run[b] ?? '')) continue;
        add(run.slice(a, b), m.index + a, m.index + b);
      }
    }
  }

  // Longest first so "New York" beats "York".
  found.sort((x, y) => (y.end - y.start) - (x.end - x.start));
  const kept: Match[] = [];
  for (const f of found) {
    if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  }
  return kept;
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function lengthScore(key: string): number {
  if (IS_DENSE.test(key)) return key.length >= 4 ? 1 : key.length === 3 ? 0.8 : 0.45;
  const letters = key.replace(/ /g, '').length;
  return clamp((letters - 3) / 7 + (key.includes(' ') ? 0.3 : 0));
}

/**
 * Resolve a stream to one gazetteer place, or reject it.
 * confidence = 0.25·length + 0.20·country + 0.25·population + 0.15·field + 0.15·unambiguity
 */
export function geocode(
  g: Gazetteer,
  fields: { title: string; channel?: string },
  country?: string,
): GeocodeResult {
  const context = normalize(`${fields.title} ${fields.channel ?? ''}`);
  const contextWords = new Set(`${fields.title} ${fields.channel ?? ''}`.split(/[^A-Za-z]+/));
  const admin1Hit = (p: Place) =>
    (p.admin1 !== '' && normalize(p.admin1) !== normalize(p.name) && ` ${context} `.includes(` ${normalize(p.admin1)} `))
    || (p.country === 'US' && contextWords.has(p.admin1Code));

  const hits: GeocodeHit[] = [];
  for (const field of ['title', 'channel'] as const) {
    const text = fields[field];
    if (!text) continue;
    for (const m of findMatches(g, text, country)) {
      const ranked = [...m.places].sort((a, b) =>
        Number(admin1Hit(b)) - Number(admin1Hit(a)) || b.population - a.population);
      const top = ranked[0];
      const total = m.places.reduce((s, p) => s + p.population, 0);
      // Unknown populations (0) count as an even split.
      const unambiguous = admin1Hit(top) ? 1 : total > 0 ? top.population / total : 1 / m.places.length;
      if (unambiguous < MIN_NAME_SHARE) {
        hits.push({ place: top, confidence: -1, matched: m.key, field }); // Springfield problem
        continue;
      }
      const confidence =
        0.25 * lengthScore(m.key)
        + 0.2 * (country ? 1 : 0.3)
        + 0.25 * clamp((Math.log10(Math.max(top.population, 1)) - 3) / 3.5)
        + 0.15 * (field === 'title' ? 1 : 0.5)
        + 0.15 * unambiguous;
      hits.push({ place: top, confidence: Math.round(confidence * 1000) / 1000, matched: m.key, field });
    }
  }
  if (!hits.length) return { ok: false, reason: country ? 'no-gazetteer-match-in-country' : 'no-gazetteer-match' };

  // "Seattle, Washington": a match that names another match's own state is context, not a place.
  const regions = new Set(hits.flatMap((h) => [normalize(h.place.admin1), h.place.admin1Code.toLowerCase()]));
  const places = hits.filter((h) => !regions.has(h.matched));
  if (places.length) hits.splice(0, hits.length, ...places);
  hits.sort((a, b) => b.confidence - a.confidence);
  let best = hits[0];
  if (best.confidence < 0) return { ok: false, reason: `ambiguous-name:${best.matched}`, best: { ...best, confidence: 0 } };
  // Two strong matches far apart ("Tokyo to Osaka") — we can't tell which one the camera is at.
  const rival = hits.find((h) => h !== best && h.confidence >= best.confidence - 0.1
    && distanceKm(h.place.lat, h.place.lon, best.place.lat, best.place.lon) > 75);
  if (rival) return { ok: false, reason: `ambiguous:${best.matched}|${rival.matched}`, best };
  // A nearby, smaller place named alongside the city is the more precise location (Shibuya within Tokyo).
  const specific = hits.find((h) => h.field === 'title' && h.place.population < best.place.population
    && distanceKm(h.place.lat, h.place.lon, best.place.lat, best.place.lon) < 40);
  if (specific) best = { ...specific, confidence: Math.max(specific.confidence, best.confidence) };

  if (!(best.confidence >= CONFIDENCE_THRESHOLD)) return { ok: false, reason: 'below-threshold', best };
  return { ok: true, hit: best };
}

/** 1°×1° buckets of places, built on first use, for nearest-place lookups. */
let grid: Map<string, Place[]> | null = null;
const cell = (lat: number, lon: number) => `${Math.floor(lat)},${Math.floor(lon)}`;

/** Nearest gazetteer place — gives agency cameras and overrides a timezone and a place name. */
export function nearestPlace(g: Gazetteer, lat: number, lon: number): { place: Place; km: number } {
  if (!grid) {
    grid = new Map();
    for (const p of g.places) {
      const k = cell(p.lat, p.lon);
      const list = grid.get(k);
      if (list) list.push(p); else grid.set(k, [p]);
    }
  }
  let best = g.places[0];
  let bestKm = Infinity;
  // Search outward ring by ring; stop once the ring is farther than the best hit (~111 km per ring).
  for (let r = 0; r <= 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const p of grid.get(cell(lat + dy, lon + dx)) ?? []) {
          const d = distanceKm(lat, lon, p.lat, p.lon);
          if (d < bestKm) { best = p; bestKm = d; }
        }
      }
    }
    if (bestKm < r * 111 * Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180)) break;
  }
  return { place: best, km: bestKm };
}

export function placeLabel(p: Place): string {
  return p.admin1 && normalize(p.admin1) !== normalize(p.name) && !p.admin1.includes(p.name)
    ? `${p.name}, ${p.admin1}` : p.name;
}
