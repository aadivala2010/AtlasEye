/**
 * Every aircraft on Earth from OpenSky's /states/all, reshaped to the readsb fields lib/flights parses.
 * Anonymous access allows ~100 global requests a day, so the CDN serves one snapshot for 15 min.
 * With OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET set (free account), it refreshes every 90 s.
 */
const UA = 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let token: { value: string; expires: number } | null = null;

async function openskyToken(): Promise<string | null> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (token && token.expires > Date.now()) return token.value;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  return token.value;
}

// icao24, callsign, country, time_position, last_contact, lon, lat, baro_alt m, on_ground, velocity m/s,
// true_track, vertical_rate m/s, sensors, geo_alt m, squawk, spi, position_source
type State = [string, string | null, string, number | null, number, number | null, number | null, number | null,
  boolean, number | null, number | null, number | null, unknown, number | null, string | null, boolean, number];

const FT = 3.28084;

export async function GET() {
  const auth = await openskyToken();
  const r = await fetch('https://opensky-network.org/api/states/all', {
    cache: 'no-store',
    headers: { 'user-agent': UA, ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  }).catch(() => null);
  if (!r?.ok) {
    // Cache the failure briefly too, so a rate-limited upstream isn't hammered by every viewer.
    return Response.json({ error: `upstream ${r?.status ?? 'unreachable'}` }, { status: 502, headers: { 'cache-control': 'public, s-maxage=60' } });
  }
  const j = (await r.json()) as { time: number; states: State[] | null };
  const ac = (j.states ?? []).flatMap((s) => {
    if (s[5] === null || s[6] === null) return [];
    const baro = s[7] === null ? undefined : Math.round(s[7] * FT);
    return [{
      hex: s[0],
      flight: s[1] ?? undefined,
      lon: s[5],
      lat: s[6],
      alt_baro: s[8] ? 'ground' : baro,
      alt_geom: s[13] === null ? undefined : Math.round(s[13] * FT),
      gs: s[9] === null ? undefined : +(s[9] * 1.94384).toFixed(1),
      track: s[10] ?? undefined,
      geom_rate: s[11] === null ? undefined : Math.round(s[11] * 196.85),
      squawk: s[14] ?? undefined,
      seen_pos: j.time - (s[3] ?? j.time),
    }];
  });
  return Response.json(
    { now: j.time * 1000, ac },
    { headers: { 'cache-control': `public, s-maxage=${auth ? 90 : 900}, stale-while-revalidate=600` } },
  );
}
