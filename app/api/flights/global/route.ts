import { AIRLINER_TYPES } from '@/lib/airliners';

/**
 * Worldwide aircraft of one type: adsb.lol has no "everything" endpoint, but /v2/type/{type} is
 * global. (OpenSky's /states/all would be complete, but it refuses Vercel's data-centre IPs.)
 * Each type is its own CDN-cached URL and the client walks through them a few seconds apart,
 * so adsb.lol (≈6 quick requests before 429s) sees a steady trickle, not a burst.
 */
const UA = 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)';
const KEEP = ['hex', 'flight', 'r', 't', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track', 'roll', 'baro_rate', 'geom_rate', 'squawk', 'seen_pos'];

export async function GET(req: Request) {
  const type = new URL(req.url).searchParams.get('type') ?? '';
  if (!(AIRLINER_TYPES as readonly string[]).includes(type)) return Response.json({ error: 'unknown type' }, { status: 400 });

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt));
    const r = await fetch(`https://api.adsb.lol/v2/type/${type}`, { cache: 'no-store', headers: { 'user-agent': UA } }).catch(() => null);
    if (r?.ok) {
      const j = (await r.json()) as { ac?: Record<string, unknown>[]; now?: number };
      const ac = (j.ac ?? []).filter((a) => typeof a.lat === 'number')
        .map((a) => Object.fromEntries(KEEP.filter((k) => k in a).map((k) => [k, a[k]])));
      return Response.json({ now: j.now ?? Date.now(), ac }, {
        headers: { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=300' },
      });
    }
    if (r && r.status !== 429) break;
  }
  return Response.json({ error: 'upstream busy' }, { status: 503, headers: { 'cache-control': 'public, s-maxage=20' } });
}
