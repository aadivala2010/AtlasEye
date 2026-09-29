import { binFires } from '@/lib/fires';

/**
 * Every fire NOAA-20's VIIRS saw in the last 24 hours, worldwide (NASA FIRMS). The CSV is public and
 * keyless but sends no CORS headers, and it's ~9 MB: binned here to lat/lon/FRP on a ~2 km grid
 * (~250 KB gzipped) and cached at the CDN, so all viewers share one download per half hour.
 */
const CSV = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv';
const UA = 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)';

export async function GET() {
  const r = await fetch(CSV, { cache: 'no-store', headers: { 'user-agent': UA } }).catch(() => null);
  if (!r?.ok) return Response.json({ error: 'upstream unavailable' }, { status: 502, headers: { 'cache-control': 'public, s-maxage=300' } });
  return Response.json(binFires(await r.text()), {
    headers: { 'cache-control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
  });
}
