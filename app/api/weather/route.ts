import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get('lat')), lon = Number(p.get('lon'));
  const local = p.has('lat') || p.has('lon');
  if (local && (!p.get('lat')?.trim() || !p.get('lon')?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
    return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
  }
  try {
    const r = await fetch(`https://api.weather.gov/alerts/active${local ? `?point=${lat.toFixed(3)},${lon.toFixed(3)}` : ''}`, {
      headers: { 'User-Agent': 'AtlasEye (https://github.com/aadivala2010/AtlasEye)', Accept: 'application/geo+json' },
      // The nationwide feed exceeds Next's per-item data cache limit; cache the trimmed route at the CDN.
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    if (!r.ok) throw new Error('Weather service unavailable');
    const j = await r.json();
    if (!Array.isArray(j.features)) throw new Error('Invalid weather response');
    return NextResponse.json({ type: 'FeatureCollection', features: j.features.filter((f: GeoJSON.Feature) => f.properties?.status === 'Actual' && f.properties?.messageType !== 'Cancel').map((f: GeoJSON.Feature) => ({ type: 'Feature', id: f.id, geometry: f.geometry,
      properties: Object.fromEntries(['id', 'event', 'headline', 'severity', 'sent', 'expires', 'areaDesc', 'description', 'instruction', 'web'].map((k) => [k, f.properties?.[k] ?? null])) })) },
    { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=120' } });
  } catch { return NextResponse.json({ error: 'NWS alerts temporarily unavailable.' }, { status: 503 }); }
}
