import { AIRLINER_TYPES } from '@/lib/airliners';

/**
 * OpenSky supplies the all-aircraft snapshot; adsb.lol type feeds are a limited fallback.
 * Each type has a separate CDN-cached URL to avoid bursting the anonymous API.
 */
const UA = 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)';
const KEEP = ['hex', 'flight', 'r', 't', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track', 'roll', 'baro_rate', 'geom_rate', 'squawk', 'seen_pos', 'dbFlags', 'emergency'];

/** Worldwide feeds that aren't a type sweep. Both are single global endpoints, like /v2/type. */
const FEEDS: Record<string, string> = { mil: 'mil', '7700': 'squawk/7700' };

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
  if (feed === 'opensky' && !hex) return openSky();
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
