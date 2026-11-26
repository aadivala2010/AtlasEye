import { countries } from '@/lib/worldbank';
export async function GET() {
  try { return Response.json(await countries(), { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' } }); }
  catch { return Response.json({ error: 'Country directory unavailable' }, { status: 503, headers: { 'Cache-Control': 'public, s-maxage=60' } }); }
}
