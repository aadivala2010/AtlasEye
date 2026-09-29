/**
 * Every active satellite's orbital elements (CelesTrak, three-line sets, ~2.8 MB / ~1 MB gzipped).
 * CelesTrak refuses clients that download the same set again within ~2 h, so the CDN keeps one copy
 * for all viewers; the elements themselves only change a few times a day.
 */
const TLE = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';
const UA = 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)';

export async function GET() {
  const r = await fetch(TLE, { cache: 'no-store', headers: { 'user-agent': UA } }).catch(() => null);
  const text = r?.ok ? await r.text() : '';
  // A refusal comes back as a sentence, not element sets.
  if (!/^1 25544/m.test(text)) {
    return Response.json({ error: 'upstream unavailable' }, { status: 503, headers: { 'cache-control': 'public, s-maxage=300' } });
  }
  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, s-maxage=7200, stale-while-revalidate=86400' },
  });
}
