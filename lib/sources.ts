import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface SourceStatus { id: string; interval: number; at: number | null; error: boolean; loading: boolean }
let snapshot: SourceStatus[] = [];
const listeners = new Set<() => void>();
const EMPTY: SourceStatus[] = [];
const requests = new Map<string, symbol>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useSources = () => useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
export function sourceStatus(id: string, interval: number, state: 'loading' | 'ok' | 'error' | 'idle') {
  const old = snapshot.find((s) => s.id === id);
  snapshot = [...snapshot.filter((s) => s.id !== id), { id, interval, at: state === 'ok' ? Date.now() : old?.at ?? null,
    error: state === 'error' || (state === 'loading' && !!old?.error), loading: state === 'loading' }];
  listeners.forEach((fn) => fn());
}
export async function sourceFetch(id: string, interval: number, url: string, init?: RequestInit) {
  const request = Symbol(); requests.set(id, request);
  sourceStatus(id, interval, 'loading');
  try {
    const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    const r = await fetch(url, { ...init, signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (requests.get(id) === request) sourceStatus(id, interval, 'ok');
    return r;
  } catch (e) {
    if (requests.get(id) === request) sourceStatus(id, interval, init?.signal?.aborted ? 'idle' : 'error');
    throw e;
  }
}

/** Keep the last successful answer on a transient outage. Reset when the actual query changes. */
export function useFeed<T>(id: string, url: string | null, interval: number, parse: (j: never) => T): T | null {
  const [data, setData] = useState<T | null>(null);
  const parser = useRef(parse); parser.current = parse;
  useEffect(() => {
    setData(null);
    if (!url) return;
    const ctrl = new AbortController();
    let timer = 0, failures = 0;
    const tick = async () => {
      try {
        const r = await sourceFetch(id, interval, url, { signal: ctrl.signal });
        const value = parser.current(await r.json() as never);
        if (!ctrl.signal.aborted) setData(value);
        failures = 0;
      } catch { if (!ctrl.signal.aborted) { sourceStatus(id, interval, 'error'); failures++; } }
      if (!ctrl.signal.aborted && interval) timer = window.setTimeout(tick, interval * Math.min(4, 1 + failures));
    };
    void tick();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [id, url, interval]);
  return data;
}
