import { AIRLINER_TYPES } from '@/lib/airliners';

/**
 * Worldwide aircraft of one type: adsb.lol has no "everything" endpoint, but /v2/type/{type} is
 * global. (OpenSky's /states/all would be complete, but it refuses Vercel's data-centre IPs.)
 * Each type is its own CDN-cached URL and the client walks through them a few seconds apart,
 * so adsb.lol (≈6 quick requests before 429s) sees a steady trickle, not a burst.
 */
const UA = 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)';
const KEEP = ['hex', 'flight', 'r', 't', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track', 'roll', 'baro_rate', 'geom_rate', 'squawk', 'seen_pos', 'dbFlags', 'emergency'];

/** Worldwide feeds that aren't a type sweep. Both are single global endpoints, like /v2/type. */
const FEEDS: Record<string, string> = { mil: 'mil', '7700': 'squawk/7700' };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const type = q.get('type') ?? '';
  const feed = q.get('feed') ?? '';
  const path = feed ? FEEDS[feed] : (AIRLINER_TYPES as readonly string[]).includes(type) ? `type/${type}` : undefined;
  if (!path) return Response.json({ error: 'unknown feed' }, { status: 400 });
  // Emergencies are the point of the 7700 feed, so cache it far shorter than a type sweep.
  const maxAge = feed ? 20 : 120;

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
