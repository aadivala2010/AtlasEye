import { INTEL_IDS, type IntelCategory } from '@/lib/intel';
import { newsFeed } from '@/lib/intel-news';

export const maxDuration = 60;
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const category = p.get('category') ?? 'news';
  if (!INTEL_IDS.includes(category as IntelCategory) || category === 'disasters') {
    return Response.json({ error: 'Select a news category. Disasters use the shared Earth feeds.' }, { status: 400 });
  }
  const data = await newsFeed(category as IntelCategory);
  return Response.json(data, { headers: { 'Cache-Control': data.status === 'ok' ? 'public, s-maxage=900, stale-while-revalidate=1800' : 'public, s-maxage=60' } });
}
