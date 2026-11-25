import { createHash } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { z } from 'zod';
import { INTEL_CATEGORIES, deduplicateIntel, safeSourceUrl, type IntelCategory, type IntelEvent, type IntelFeed } from './intel';

const article = z.object({ title: z.string().min(1).max(2000), url: z.string(), seendate: z.string(), domain: z.string().optional() });
const response = z.object({ articles: z.array(z.unknown()).max(500) });
export function parseGdelt(input: unknown, category: IntelCategory, now = Date.now()): IntelEvent[] {
  const data = response.parse(input);
  return deduplicateIntel(data.articles.flatMap(raw => {
    const parsed = article.safeParse(raw);
    if (!parsed.success) return [];
    const a = parsed.data, sourceUrl = safeSourceUrl(a.url);
    const date = a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    const at = Date.parse(date);
    if (!sourceUrl || !Number.isFinite(at) || at > now + 300_000) return [];
    return [{ id: `news:${createHash('sha256').update(sourceUrl).digest('hex').slice(0, 24)}`, category,
      title: a.title.replace(/<[^>]*>/g, '').slice(0, 500), summary: 'Media report indexed by GDELT. Read the original source for details and verification.',
      lat: null, lon: null, location: 'Event location unverified', precision: 'unknown' as const,
      eventTime: null, publishedAt: null, observedAt: at, retrievedAt: now,
      sourceName: new URL(sourceUrl).hostname.replace(/^www\./, ''), sourceUrl, status: 'Reported' as const }];
  }));
}

const lastGood = new Map<IntelCategory, IntelFeed>();
const pending = new Map<IntelCategory, Promise<IntelFeed>>();
const failures = new Map<IntelCategory, { count: number; retryAt: number }>();
let queue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;
const fetchNews = unstable_cache(async (category: IntelCategory): Promise<IntelFeed> => {
  // One upstream request at a time per warm instance, with provider-friendly spacing.
  const job = queue.catch(() => {}).then(async () => {
    const delay = nextRequestAt - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    nextRequestAt = Date.now() + 5500;
    const query = INTEL_CATEGORIES[category].query;
    if (!query) return { events: [], updatedAt: null, status: 'ok' as const };
    const params = new URLSearchParams({ query, mode: 'ArtList', format: 'json', timespan: '7d', maxrecords: '75', sort: 'DateDesc' });
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
    if (!r.ok) throw new Error(`GDELT ${r.status}`);
    const body = await r.text();
    if (body.length > 1_000_000) throw new Error('Oversized GDELT response');
    const now = Date.now();
    return { events: parseGdelt(JSON.parse(body), category, now), updatedAt: now, status: 'ok' as const };
  });
  queue = job;
  return job;
}, ['intel-gdelt-v1'], { revalidate: 900 });

export function newsFeed(category: IntelCategory): Promise<IntelFeed> {
  const existing = pending.get(category);
  if (existing) return existing;
  const fallback = (): IntelFeed => {
    const old = lastGood.get(category);
    return old ? { ...old, status: 'stale' } : { events: [], updatedAt: null, status: 'unavailable' };
  };
  if ((failures.get(category)?.retryAt ?? 0) > Date.now()) return Promise.resolve(fallback());
  const job = fetchNews(category).then(data => {
    lastGood.set(category, data); failures.delete(category);
    return data.updatedAt && Date.now() - data.updatedAt > 1800_000 ? { ...data, status: 'stale' as const } : data;
  }).catch(() => {
    const count = (failures.get(category)?.count ?? 0) + 1;
    failures.set(category, { count, retryAt: Date.now() + Math.min(3600_000, 60_000 * 2 ** Math.min(count, 6)) });
    return fallback();
  }).finally(() => pending.delete(category));
  pending.set(category, job); return job;
}
