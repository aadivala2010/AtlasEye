import { AIRLINER_TYPES } from '@/lib/airliners';

/**
 * PocketWorld's documented map chunks supply the all-aircraft snapshot. OpenSky and
 * adsb.lol type feeds are fallbacks when a provider is unavailable.
 * Each type has a separate CDN-cached URL to avoid bursting the anonymous API.
 */
const UA = 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)';
const KEEP = ['hex', 'flight', 'r', 't', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track', 'roll', 'baro_rate', 'geom_rate', 'squawk', 'seen_pos', 'dbFlags', 'emergency'];

/** Worldwide feeds that aren't a type sweep. Both are single global endpoints, like /v2/type. */
const FEEDS: Record<string, string> = { mil: 'mil', '7700': 'squawk/7700' };

/** PocketWorld publishes 16 geographic chunks for map clients, with observation age per row. */
async function pocketWorld(): Promise<Response | null> {
  try {
    const now = Date.now();
    const ac: Record<string, unknown>[] = [];
    const loaded = new Set<number>();
    for (let start = 0; start < 16; start += 8) {
      const chunks = await Promise.allSettled(Array.from({ length: 8 }, async (_, offset) => {
        const r = await fetch(`https://pocketworld.org/api/flights?wire=1&chunk=${start + offset}`, {
          cache: 'no-store', signal: AbortSignal.timeout(12_000), headers: { 'user-agent': UA },
        });
        if (!r.ok) throw new Error(`PocketWorld HTTP ${r.status}`);
        return await r.json() as { flight_fields?: string[]; flight_rows?: unknown[][]; stale?: boolean };
      }));
      for (const [offset, result] of chunks.entries()) {
        if (result.status !== 'fulfilled') continue;
        const chunk = result.value;
        if (chunk.stale || !Array.isArray(chunk.flight_fields) || !Array.isArray(chunk.flight_rows)) continue;
        loaded.add(start + offset);
        const index = Object.fromEntries(chunk.flight_fields.map((name, i) => [name, i]));
        for (const row of chunk.flight_rows) {
          const get = (name: string) => row[index[name]];
          const hex = get('icao24'), lat = get('lat'), lon = get('lng'), contact = get('last_contact');
          if (typeof hex !== 'string' || !/^[a-f\d]{6}$/i.test(hex)
            || typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180
            || typeof contact !== 'number' || now - contact * 1000 > 120_000 || contact * 1000 - now > 60_000
            || get('cache_stale') === true || get('source_stale') === true) continue;
          const alt = get('alt'), velocity = get('velocity'), vertical = get('vertical_rate');
          ac.push({ hex, lat, lon,
            flight: typeof get('callsign') === 'string' ? get('callsign') : undefined,
            r: typeof get('registration') === 'string' ? get('registration') : undefined,
            t: typeof get('typecode') === 'string' ? get('typecode') : undefined,
            alt_baro: get('on_ground') === true ? 'ground' : typeof alt === 'number' ? alt * 3.28084 : undefined,
            gs: typeof velocity === 'number' ? velocity * 1.94384 : undefined,
            track: typeof get('heading') === 'number' ? get('heading') : undefined,
            baro_rate: typeof vertical === 'number' ? vertical * 196.85 : undefined,
            squawk: typeof get('squawk') === 'string' ? get('squawk') : undefined,
            seen_pos: (now - contact * 1000) / 1000, source: 'PocketWorld' });
        }
      }
    }
    if (ac.length < 1000) return null;
    const partial = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].some((id) => !loaded.has(id));
    return Response.json({ now, ac, partial }, { headers: { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=60' } });
  } catch { return null; }
}

/** OpenSky includes aircraft of every type. Its anonymous global quota is 100 snapshots/day. */
async function openSky() {
  const r = await fetch('https://opensky-network.org/api/states/all', {
    cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': UA },
  }).catch(() => null);
  if (!r?.ok) return Response.json({ error: 'OpenSky unavailable' }, { status: 503 });
  const data = await r.json() as { time?: number; states?: unknown[][] };
  const now = (data.time ?? Math.floor(Date.now() / 1000)) * 1000;
  const ac = (data.states ?? []).flatMap((s) => {
    const [hex, flight, , positionTime, , lon, lat, altBaro, ground, velocity, track, verticalRate, , altGeom, squawk] = s;
    if (typeof hex !== 'string' || !/^[a-f\d]{6}$/i.test(hex) || typeof lat !== 'number' || typeof lon !== 'number'
      || typeof positionTime !== 'number' || now - positionTime * 1000 > 60_000) return [];
    return [{ hex, flight: typeof flight === 'string' ? flight : undefined, lat, lon,
      alt_baro: ground ? 'ground' : typeof altBaro === 'number' ? altBaro * 3.28084 : undefined,
      alt_geom: typeof altGeom === 'number' ? altGeom * 3.28084 : undefined,
      gs: typeof velocity === 'number' ? velocity * 1.94384 : undefined,
      track: typeof track === 'number' ? track : undefined,
      baro_rate: typeof verticalRate === 'number' ? verticalRate * 196.85 : undefined,
      squawk: typeof squawk === 'string' ? squawk : undefined, seen_pos: (now - positionTime * 1000) / 1000,
      source: 'OpenSky' }];
  });
  return Response.json({ now, ac }, { headers: { 'cache-control': 'public, s-maxage=900, stale-while-revalidate=300' } });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const type = q.get('type') ?? '';
  const feed = q.get('feed') ?? '';
  const hex = q.get('hex');
  if ((feed === 'world' || feed === 'opensky') && !hex) return await pocketWorld() ?? await openSky();
  const path = hex ? /^[a-f\d]{6}$/i.test(hex) ? `hex/${hex}` : undefined : feed ? FEEDS[feed] : (AIRLINER_TYPES as readonly string[]).includes(type) ? `type/${type}` : undefined;
  if (!path) return Response.json({ error: 'unknown feed' }, { status: 400 });
  // Emergencies are the point of the 7700 feed, so cache it far shorter than a type sweep.
  const maxAge = feed || hex ? 20 : 120;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt));
    const r = await fetch(`https://api.adsb.lol/v2/${path}`, { cache: 'no-store', headers: { 'user-agent': UA } }).catch(() => null);
    if (r?.ok) {
      const j = (await r.json()) as { ac?: Record<string, unknown>[]; now?: number };
      const ac = (j.ac ?? []).filter((a) => typeof a.lat === 'number')
        .map((a) => Object.fromEntries(KEEP.filter((k) => k in a).map((k) => [k, a[k]])));
      return Response.json({ now: j.now ?? Date.now(), ac }, {
        headers: { 'cache-control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}` },
      });
    }
    if (r && r.status !== 429) break;
  }
  return Response.json({ error: 'upstream busy' }, { status: 503, headers: { 'cache-control': 'public, s-maxage=20' } });
}
