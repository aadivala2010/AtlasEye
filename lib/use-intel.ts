'use client';
import { useEffect, useState } from 'react';
import { INTEL_CATEGORIES, type IntelCategory, type IntelFeed } from './intel';

export function useIntel(on: boolean, categories: IntelCategory[]) {
  const [feeds, setFeeds] = useState<Partial<Record<IntelCategory, IntelFeed>>>({});
  const key = categories.filter(id => INTEL_CATEGORIES[id].query).sort().join(',');
  useEffect(() => {
    if (!on || !key) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      for (const id of key.split(',') as IntelCategory[]) {
        if (ctrl.signal.aborted) return;
        try {
          const r = await fetch(`/api/intel?category=${id}`, { signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(55_000)]) });
          if (!r.ok) throw new Error('Feed unavailable');
          const data = await r.json() as IntelFeed;
          if (!ctrl.signal.aborted) setFeeds(old => ({ ...old, [id]: data.status === 'unavailable' && old[id]?.updatedAt ? { ...old[id]!, status: 'stale' } : data }));
        } catch {
          if (!ctrl.signal.aborted) setFeeds(old => ({ ...old, [id]: old[id]?.updatedAt ? { ...old[id]!, status: 'stale' } : { events: [], updatedAt: null, status: 'unavailable' } }));
        }
      }
      if (!ctrl.signal.aborted) timer = setTimeout(tick, 900_000);
    };
    void tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [on, key]);
  return feeds;
}
