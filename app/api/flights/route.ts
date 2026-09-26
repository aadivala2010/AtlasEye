/**
 * adsb.lol proxy (it sends no CORS headers). Two jobs a plain rewrite can't do:
 * - Vercel's egress IPs are shared, so adsb.lol often answers 429: retry with backoff.
 * - Snap the centre to a grid and let the CDN cache for a few seconds, so every viewer of the
 *   same area shares one upstream request.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const nm = Math.min(250, Math.max(1, Math.round(Number(q.get('nm')) || 250)));
  const step = nm >= 100 ? 0.5 : 0.05; // grid well inside the radius
  const snap = (v: string | null, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= max ? (Math.round(n / step) * step).toFixed(2) : null;
  };
  const lat = snap(q.get('lat'), 90);
  const lon = snap(q.get('lon'), 180);
  if (!lat || !lon) return Response.json({ error: 'bad lat/lon' }, { status: 400 });

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt));
    // adsb.lol 403s Node's default user agent; identify ourselves instead.
    const r = await fetch(`https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`, {
      cache: 'no-store',
      headers: { 'user-agent': 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)' },
    }).catch(() => null);
    if (r?.ok) {
      return new Response(r.body, {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=8, stale-while-revalidate=30' },
      });
    }
    if (r && r.status !== 429) return Response.json({ error: `upstream ${r.status}` }, { status: 502 });
  }
  return Response.json({ error: 'upstream busy' }, { status: 503 });
}
