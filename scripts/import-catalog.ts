/**
 * Build public/data/streams.json from Famelack + camlisted.
 *
 *   npm run import              fetch upstream, validate, snapshot, geocode, write
 *   npm run import -- --offline re-run from the committed snapshots in data/upstream/
 *   npm run import -- --force   allow the catalog to shrink by more than half
 *
 * Fails (exit 1) without touching the existing catalog on any schema mismatch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { Catalog, Category, Stream } from '../lib/stream';
import {
  distanceKm, geocode, loadGazetteer, nearestPlace, normalize, placeLabel, CONFIDENCE_THRESHOLD, type GeocodeHit,
} from './geocode';
import { AGENCIES, SchemaError, verifyHls, type AgencyCam } from './agencies';

const OFFLINE = process.argv.includes('--offline');
const FORCE = process.argv.includes('--force');
const FAMELACK = 'https://raw.githubusercontent.com/famelack/famelack-data/main/webcams/raw';
const CAMLISTED = 'https://raw.githubusercontent.com/tantran21501/camlisted/main/data/streams.json';
const CAMLISTED_LOCATIONS = 'https://raw.githubusercontent.com/tantran21501/camlisted/main/data/location_resolve.json';
const CATALOG = 'public/data/streams.json';

// ── upstream schemas ─────────────────────────────────────────────────────────

const FamelackEntry = z.object({
  nanoid: z.string(),
  name: z.string().min(1),
  sources: z.object({ youtube: z.array(z.string()).optional() }),
  country: z.string().length(2),
  isGeoBlocked: z.boolean(),
});
const FamelackFile = z.array(FamelackEntry);

const CamlistedEntry = z.object({
  video_id: z.string(),
  title: z.string(),
  channel_title: z.string().nullable(),
  status: z.string(),
  content_type: z.string(),
  embeddable: z.boolean(),
  visibility: z.string().optional(),
  approval_status: z.string(),
  country: z.string().length(2).nullable(),
  category: z.string(),
  added_at: z.string().optional(),
});
const CamlistedFile = z.object({
  format: z.literal('streams-v2'),
  generatedAt: z.string(),
  streams: z.array(CamlistedEntry).min(1),
});

/** camlisted's own location resolution. We trust only uploader GPS outright; place hints must agree with us. */
const CamlistedLocations = z.object({
  cameras: z.array(z.object({
    video_id: z.string(),
    location: z.object({ lat: z.number(), lng: z.number(), source: z.string() }).nullable(),
  })).min(1),
});
interface HintLoc { lat: number; lng: number; gps: boolean }

const Override = z.object({
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  place: z.string().min(1),
  country: z.string().length(2),
  category: z.enum(['city', 'nature', 'wildlife', 'beach', 'harbor', 'traffic', 'transit', 'weather', 'space', 'other']).optional(),
});
const Overrides = z.record(z.string(), Override);

/** Famelack category files, most specific first — a stream in several takes the first. */
const FAMELACK_CATEGORIES: Record<string, Category> = {
  space: 'space', animals: 'wildlife', underwater: 'wildlife', beach: 'beach', harbor: 'harbor',
  traffic: 'traffic', train: 'transit', airport: 'transit', weather: 'weather', volcano: 'nature',
  ski: 'nature', mountain: 'nature', lake: 'nature', river: 'nature', nature: 'nature', park: 'nature',
  landmark: 'city', construction: 'city', city: 'city', sports: 'other',
};

/** camlisted categories. `null` = excluded (surveillance-flavoured, see README). */
const CAMLISTED_CATEGORIES: Record<string, Category | null> = {
  mountain: 'nature', construction: 'city', downtown: 'city', wildlife: 'wildlife', beach: 'beach',
  plaza: 'city', park: 'nature', walk: 'city', skyline: 'city', airport: 'transit', traffic: 'traffic',
  indoor: 'other', aerial: 'city', avenue: 'city', river: 'nature', harbor: 'harbor', alley: 'city',
  resort: 'beach', coast: 'beach', train: 'transit', parking: null, dashcam: 'traffic', other: 'other',
  space: 'space',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function fail(msg: string): never {
  console.error(`\n✖ import aborted: ${msg}\n  ${CATALOG} was left untouched.`);
  process.exit(1);
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const { issues } = r.error;
    fail(`${what} schema mismatch — upstream format changed? (${issues.length} issues, first 8 shown)\n`
      + z.prettifyError(new z.ZodError(issues.slice(0, 8))));
  }
  return r.data;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) fail(`${url} → HTTP ${res.status}`);
  return res.json();
}

/** Upstream uses `uk`; ISO 3166-1 says GB. */
const iso2 = (cc: string) => (cc.toUpperCase() === 'UK' ? 'GB' : cc.toUpperCase());

const youtubeId = (url: string) => url.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{11})/)?.[1];

const NOISE = /(?<![\p{L}\p{N}])(?:live\s*(?:stream(?:ing)?|cam(?:era)?|view|feed)?|livestream|4k|8k|uhd|hdr|hd|\d{3,4}p|24\/7|24h|en vivo|en directo|ao vivo|in diretta|now)(?![\p{L}\p{N}])/giu;

/** A readable name from an SEO title: the segment naming the place, minus emoji and stream jargon. */
export function cleanName(title: string, matched: string, fallback: string): string {
  const segments = title.normalize('NFKC')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{20E3}]/gu, ' ')
    .split(/\s*[|｜￨│•\/]\s*|\s+[-–—~:]\s+|[【】[\]()（）「」『』]/u)
    .map((s) => s.replace(NOISE, ' ')
      .replace(/\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}\S*|\d{1,2}:\d{2}\S*/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '')
      .trim())
    .filter((s) => /\p{L}{2}/u.test(s));
  const pick = segments.find((s) => normalize(s).includes(matched)) ?? segments[0] ?? '';
  return pick.length >= 3 && pick.length <= 70 ? pick : fallback;
}

// ── load upstream ────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  title: string;
  channel?: string;
  country?: string;
  category: Category;
  source: 'famelack' | 'camlisted';
  addedAt?: string;
}

async function loadFamelack(): Promise<Candidate[]> {
  const snapshot = 'data/upstream/famelack.json';
  let files: Record<string, unknown>;
  if (OFFLINE) {
    files = JSON.parse(readFileSync(snapshot, 'utf8')) as Record<string, unknown>;
  } else {
    files = { all: await getJson(`${FAMELACK}/categories/all.json`) };
    for (const cat of Object.keys(FAMELACK_CATEGORIES)) files[cat] = await getJson(`${FAMELACK}/categories/${cat}.json`);
  }
  const all = parse(FamelackFile, files.all, 'Famelack all.json');
  if (all.length === 0) fail('Famelack all.json is empty');
  const category = new Map<string, Category>();
  for (const [file, cat] of Object.entries(FAMELACK_CATEGORIES)) {
    for (const e of parse(FamelackFile, files[file], `Famelack ${file}.json`)) {
      if (!category.has(e.nanoid)) category.set(e.nanoid, cat);
    }
  }
  if (!OFFLINE) writeFileSync(snapshot, JSON.stringify(files));

  return all.filter((e) => !e.isGeoBlocked).flatMap((e) => {
    const id = e.sources.youtube?.map(youtubeId).find(Boolean);
    return id ? [{
      id, title: e.name.trim(), country: iso2(e.country),
      category: category.get(e.nanoid) ?? 'other', source: 'famelack' as const,
    }] : [];
  });
}

async function loadCamlisted(): Promise<Candidate[]> {
  const snapshot = 'data/upstream/camlisted.json';
  const raw = OFFLINE ? JSON.parse(readFileSync(snapshot, 'utf8')) as unknown : await getJson(CAMLISTED);
  const data = parse(CamlistedFile, raw, 'camlisted streams.json');
  // Only streams camlisted currently sees as live, embeddable, broadcasting (not an ended VOD) and approved.
  const usable = data.streams.filter((s) => s.status === 'live' && s.content_type === 'live' && s.embeddable
    && s.visibility !== 'hidden' && s.approval_status === 'approved');
  if (!OFFLINE) writeFileSync(snapshot, JSON.stringify({ ...data, streams: usable }));

  return usable.flatMap((s) => {
    const category = CAMLISTED_CATEGORIES[s.category];
    if (category === null) return [];
    return [{
      id: s.video_id, title: s.title.trim(), channel: s.channel_title ?? undefined,
      country: s.country ? iso2(s.country) : undefined, category: category ?? 'other', source: 'camlisted' as const,
      addedAt: s.added_at,
    }];
  });
}

async function loadCamlistedLocations(): Promise<Map<string, HintLoc>> {
  const snapshot = 'data/upstream/camlisted-locations.json';
  let pruned: Record<string, HintLoc>;
  if (OFFLINE) {
    pruned = JSON.parse(readFileSync(snapshot, 'utf8')) as Record<string, HintLoc>;
  } else {
    const data = parse(CamlistedLocations, await getJson(CAMLISTED_LOCATIONS), 'camlisted location_resolve.json');
    pruned = {};
    for (const c of data.cameras) {
      const l = c.location;
      if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) continue;
      // Country-centroid fallbacks are never usable; everything else is kept for the agreement check.
      if (l.source === 'youtube-channel-country') continue;
      pruned[c.video_id] = { lat: l.lat, lng: l.lng, gps: l.source === 'youtube-recordingDetails' };
    }
    writeFileSync(snapshot, JSON.stringify(pruned));
  }
  return new Map(Object.entries(pruned));
}

/**
 * Agency cameras. A schema change aborts the import; an agency that is merely unreachable keeps
 * its cameras from the previous catalog, so one flaky server doesn't blank a whole region.
 */
async function loadAgencies(previous: Catalog | null): Promise<{ cams: AgencyCam[]; carried: Stream[]; dead: number }> {
  const snapshot = 'data/upstream/agencies.json';
  if (OFFLINE) return { cams: JSON.parse(readFileSync(snapshot, 'utf8')) as AgencyCam[], carried: [], dead: 0 };
  const cams: AgencyCam[] = [];
  const carried: Stream[] = [];
  for (const [name, load] of Object.entries(AGENCIES)) {
    try {
      const got = await load();
      console.log(`  ${name.padEnd(11)} ${got.length} cameras`);
      cams.push(...got);
    } catch (e) {
      if (e instanceof SchemaError) fail(e.message);
      const keep = previous?.streams.filter((s) => s.source === name) ?? [];
      console.warn(`  ⚠ ${name} unreachable (${e instanceof Error ? e.message : String(e)}); keeping ${keep.length} from the previous catalog`);
      carried.push(...keep);
    }
  }
  console.log(`  probing ${cams.filter((c) => c.kind === 'hls').length} live video streams…`);
  const verified = await verifyHls(cams);
  writeFileSync(snapshot, JSON.stringify(verified.cams));
  return { ...verified, carried };
}

// ── main ─────────────────────────────────────────────────────────────────────

mkdirSync('data/upstream', { recursive: true });
const famelack = await loadFamelack();
const camlisted = await loadCamlisted();
const hints = await loadCamlistedLocations();
const overrides = parse(Overrides, JSON.parse(readFileSync('data/overrides.json', 'utf8')), 'data/overrides.json');
/** Broadcaster removal requests: video IDs never shown, whatever upstream says. */
const excluded = new Set(parse(z.array(z.string()), JSON.parse(readFileSync('data/excluded.json', 'utf8')), 'data/excluded.json'));
const gazetteer = loadGazetteer();

const previous: Catalog | null = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, 'utf8')) as Catalog : null;
const previousAdded = new Map(previous?.streams.map((s) => [s.id, s.addedAt]));
const now = new Date().toISOString();
const agencies = await loadAgencies(previous);

// Dedupe on video ID; Famelack first — its names are already clean and its categories hand-assigned.
const candidates = new Map<string, Candidate>();
for (const c of [...famelack, ...camlisted]) if (!candidates.has(c.id) && !excluded.has(c.id)) candidates.set(c.id, c);

const streams: Stream[] = [];
const rejected: { id: string; title: string; source: string; country?: string; reason: string; best?: { matched: string; place: string; confidence: number } }[] = [];
const describe = (h?: GeocodeHit) => h && { matched: h.matched, place: `${placeLabel(h.place)}, ${h.place.country}`, confidence: h.confidence };

const round = (x: number) => Math.round(x * 1e5) / 1e5;
const counts = { gps: 0, agreed: 0 };

for (const c of candidates.values()) {
  const base = { id: c.id, kind: 'youtube' as const, title: c.title, source: c.source, addedAt: previousAdded.get(c.id) ?? c.addedAt ?? now };
  const o = overrides[c.id];
  if (o) {
    streams.push({
      ...base, name: o.name, latitude: o.latitude, longitude: o.longitude, place: o.place, country: o.country,
      timezone: nearestPlace(gazetteer, o.latitude, o.longitude).place.timezone,
      category: o.category ?? c.category, geocode: 'override', confidence: 1,
    });
    continue;
  }
  const r = geocode(gazetteer, { title: c.title, channel: c.channel }, c.country);
  const hint = hints.get(c.id);
  if (!r.ok && hint?.gps) {
    // The broadcaster's own YouTube recording location, sanity-checked against the country field.
    const near = nearestPlace(gazetteer, hint.lat, hint.lng);
    if (near.km < 60 && (!c.country || near.place.country === c.country)) {
      counts.gps++;
      const place = placeLabel(near.place);
      streams.push({
        ...base, name: c.source === 'famelack' ? c.title : cleanName(c.title, '', place),
        latitude: round(hint.lat), longitude: round(hint.lng), place, country: near.place.country,
        timezone: near.place.timezone, category: c.category, geocode: 'gps', confidence: 0.9,
      });
      continue;
    }
  }
  if (!r.ok && r.best && hint && r.best.confidence >= 0.5
    && distanceKm(r.best.place.lat, r.best.place.lon, hint.lat, hint.lng) < 30) {
    // Two independent geocoders (ours and camlisted's) agree on a borderline match: accept it.
    counts.agreed++;
    const p = r.best.place;
    const place = placeLabel(p);
    streams.push({
      ...base, name: c.source === 'famelack' ? c.title : cleanName(c.title, r.best.matched, place),
      latitude: p.lat, longitude: p.lon, place, country: p.country, timezone: p.timezone,
      category: c.category, geocode: 'gazetteer', confidence: Math.max(r.best.confidence, 0.7),
    });
    continue;
  }
  if (!r.ok) {
    rejected.push({ id: c.id, title: c.title, source: c.source, country: c.country, reason: r.reason, best: describe(r.best) });
    continue;
  }
  const p = r.hit.place;
  const place = placeLabel(p);
  streams.push({
    ...base, name: c.source === 'famelack' ? c.title : cleanName(c.title, r.hit.matched, place),
    latitude: p.lat, longitude: p.lon, place, country: p.country, timezone: p.timezone,
    category: c.category, geocode: 'gazetteer', confidence: r.hit.confidence,
  });
}

// YouTube: keep the upstream title only when it differs from the display name.
for (const s of streams) if (s.title === s.name) delete s.title;

// ── agency cameras ───────────────────────────────────────────────────────────
const agencyStreams: Stream[] = [...agencies.carried];
for (const cam of agencies.cams) {
  const near = nearestPlace(gazetteer, cam.latitude, cam.longitude);
  agencyStreams.push({
    id: cam.id, kind: cam.kind, url: cam.url, ...(cam.refresh ? { refresh: cam.refresh } : {}),
    name: cam.name, latitude: round(cam.latitude), longitude: round(cam.longitude),
    place: cam.place ?? placeLabel(near.place), country: cam.country, timezone: near.place.timezone,
    category: cam.category, source: cam.source, geocode: 'operator', confidence: 1,
    addedAt: previousAdded.get(cam.id) ?? now,
  });
}
const youtubeCount = streams.length;
streams.push(...agencyStreams);
const tally = (list: Stream[], key: (s: Stream) => string) =>
  Object.entries(list.reduce<Record<string, number>>((m, s) => ((m[key(s)] = (m[key(s)] ?? 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${String(v).padStart(5)}  ${k}`).join('\n');

// ── report & write ───────────────────────────────────────────────────────────

const total = candidates.size;
const reasons = new Map<string, number>();
for (const r of rejected) {
  const k = r.reason.startsWith('ambiguous') ? 'ambiguous' : r.reason;
  reasons.set(k, (reasons.get(k) ?? 0) + 1);
}
const staleOverrides = Object.keys(overrides).filter((id) => !candidates.has(id));

console.log(`
  famelack   ${famelack.length} streams
  camlisted  ${camlisted.length} live streams
  unique     ${total}
  placed     ${youtubeCount}  (${streams.filter((s) => s.geocode === 'override').length} by override, ${counts.gps} by uploader GPS, ${counts.agreed} by geocoder agreement; threshold ${CONFIDENCE_THRESHOLD})
  dropped    ${rejected.length}  (${((rejected.length / total) * 100).toFixed(1)}%)
${[...reasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${String(v).padStart(5)}  ${k}`).join('\n')}

  agency cameras  ${agencyStreams.length}  (${agencies.dead} dead video streams dropped or downgraded to snapshots)
${tally(agencyStreams, (s) => `${s.source} ${s.kind}`)}

  TOTAL ON GLOBE  ${streams.length}
${tally(streams, (s) => s.kind)}`);
if (staleOverrides.length) console.log(`  ${staleOverrides.length} override(s) not in upstream (stream ended?): ${staleOverrides.join(', ')}`);

if (streams.length === 0) fail('no streams placed');
if (previous && streams.length < previous.count / 2 && !FORCE) {
  fail(`catalog would shrink from ${previous.count} to ${streams.length}; re-run with --force if that is expected`);
}

streams.sort((a, b) => a.id.localeCompare(b.id));
const catalog: Catalog = { builtAt: now, count: streams.length, streams };
mkdirSync('public/data', { recursive: true });
writeFileSync(CATALOG, JSON.stringify(catalog));
writeFileSync('public/data/rejected.json', JSON.stringify(rejected, null, 1));
console.log(`\n✔ wrote ${CATALOG} and public/data/rejected.json`);
