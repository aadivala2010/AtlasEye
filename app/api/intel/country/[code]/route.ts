import { countryProfile } from '@/lib/worldbank';
export const maxDuration = 30;
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const code = (await context.params).code.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return Response.json({ error: 'Use a three-letter country code' }, { status: 400 });
  try {
    const data = await countryProfile(code);
    if (!data) return Response.json({ error: 'Country not found' }, { status: 404 });
    return Response.json(data, { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400' } });
  } catch { return Response.json({ error: 'Country indicators unavailable' }, { status: 503, headers: { 'Cache-Control': 'public, s-maxage=60' } }); }
}
