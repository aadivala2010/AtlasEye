import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2 || q.length > 120) return NextResponse.json({ error: 'Enter 2–120 characters.' }, { status: 400 });
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, {
      signal: AbortSignal.timeout(10_000), next: { revalidate: 86400 },
    });
    if (!r.ok) throw new Error('Place search unavailable');
    const j = await r.json();
    if (!Array.isArray(j.features)) throw new Error('Invalid place search response');
    return NextResponse.json(j, { headers: { 'Cache-Control': 'public, s-maxage=86400' } });
  } catch { return NextResponse.json({ error: 'Place search is unavailable. Camera, coordinate and loaded-object search still work.' }, { status: 503 }); }
}
