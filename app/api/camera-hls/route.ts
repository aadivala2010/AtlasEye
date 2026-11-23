/** Same-origin relay for licensed public HLS feeds whose operators do not send browser CORS headers. */
const HOSTS = new Set([
  'atcs-dishub.bandung.go.id:1990', 'atcs.cianjurkab.go.id:5443', 'atcs.denpasarkota.go.id',
  'stream.palembang.go.id', 'cctv.pekanbaru.go.id', 'atcs.tasikmalayakota.go.id',
  'cctv.cirebonkota.go.id', 'cctvjss.jogjakota.go.id', 'cctv.kebumenkab.go.id',
  'dev.cctv.magelangkota.go.id', 'restreamer.magelangkota.go.id',
  'streamcctv.padang.go.id:3000', 'restreamer.salatiga.go.id', 'mata.wonosobokab.go.id',
  'kamera.vegvesen.no', 'streaming1.highwaytraffic.go.th', 'streaming2.highwaytraffic.go.th',
]);

const allowed = (url: URL) => url.protocol === 'https:' && HOSTS.has(url.host)
  && /\.(?:m3u8|ts|m4s|mp4|aac|key|bin)$/i.test(url.pathname);

export async function GET(req: Request) {
  let url: URL;
  try { url = new URL(new URL(req.url).searchParams.get('url') ?? ''); }
  catch { return Response.json({ error: 'Invalid camera URL' }, { status: 400 }); }
  if (!allowed(url)) return Response.json({ error: 'Camera host or path not allowed' }, { status: 400 });

  const upstream = await fetch(url, {
    cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: { 'user-agent': 'AtlasEye/1.0 (+https://atlas-eye-globe.vercel.app)' },
  }).catch(() => null);
  if (!upstream?.ok) return Response.json({ error: 'Camera unavailable' }, { status: 502 });

  if (url.pathname.endsWith('.m3u8')) {
    const playlist = (await upstream.text()).split('\n').map((line) => {
      const proxy = (path: string) => {
        const next = new URL(path, url);
        return allowed(next) ? `/api/camera-hls?url=${encodeURIComponent(next.href)}` : path;
      };
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, path: string) => `URI="${proxy(path)}"`);
      return line.trim() ? proxy(line.trim()) : line;
    }).join('\n');
    if (!playlist.startsWith('#EXTM3U')) return Response.json({ error: 'Invalid camera playlist' }, { status: 502 });
    return new Response(playlist, { headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' } });
  }
  const size = Number(upstream.headers.get('content-length'));
  if (size > 10_000_000) { await upstream.body?.cancel(); return Response.json({ error: 'Camera segment too large' }, { status: 502 }); }
  return new Response(upstream.body, { headers: {
    'content-type': upstream.headers.get('content-type') || 'video/mp2t',
    'cache-control': 'public, s-maxage=30',
  } });
}
