'use client';

import { useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { Stream } from '@/lib/stream';
import type { Flight } from '@/lib/flights';
import type { Sat } from '@/lib/satellites';
import type { PulseItem } from '@/lib/events';
import { parseCoordinates, validPoint } from '@/lib/explore';
import { countryName } from '@/components/stream/StreamPanel';
import { IconSearch } from './icons';

export interface SearchHandle { focus(): void }
export type SearchResult = { label: string; detail: string } & (
  { kind: 'camera'; stream: Stream } | { kind: 'flight'; flight: Flight } | { kind: 'satellite'; satellite: Sat }
  | { kind: 'event'; event: PulseItem } | { kind: 'place'; lat: number; lon: number }
);
export interface SearchData { flights: Flight[] | null; sats: Sat[] | null; events: PulseItem[]; onActive(on: boolean): void; onResult(result: SearchResult): void }
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export default function Search({ ref, streams, data }: { ref?: Ref<SearchHandle>; streams: Stream[]; data: SearchData }) {
  const input = useRef<HTMLInputElement>(null), request = useRef<AbortController | null>(null);
  const [q, setQ] = useState(''), query = useDeferredValue(q.trim());
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<SearchResult[]>([]), [status, setStatus] = useState('');
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  const searching = !!query;
  useEffect(() => { data.onActive(open && searching); }, [open, searching, data.onActive]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (active >= 0) document.getElementById(`search-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const index = useMemo(() => searching ? streams.map((s) => ({ s, hay: fold(`${s.name} ${s.place} ${countryName(s.country)} ${s.country}`) })) : [], [streams, searching]);
  const local = useMemo<SearchResult[]>(() => {
    if (!query) return [];
    const point = parseCoordinates(query), terms = fold(query).split(/\s+/);
    const match = (s: string) => terms.every((t) => fold(s).includes(t));
    return [
      ...(point ? [{ kind: 'place' as const, ...point, label: `${point.lat}, ${point.lon}`, detail: 'Coordinates · latitude, longitude' }] : []),
      ...(data.flights ?? []).filter((f) => match(`${f.callsign} ${f.hex} ${f.reg ?? ''}`)).slice(0, 3).map((flight) => ({ kind: 'flight' as const, flight, label: flight.callsign, detail: `Aircraft · ${flight.reg ?? flight.hex}` })),
      ...(data.sats ?? []).filter((s) => match(`${s.name} ${s.id}`)).slice(0, 3).map((satellite) => ({ kind: 'satellite' as const, satellite, label: satellite.name, detail: `Satellite · NORAD ${satellite.id}` })),
      ...data.events.filter((e) => match(`${e.title} ${e.detail}`)).slice(0, 3).map((event) => ({ kind: 'event' as const, event, label: event.title, detail: event.detail })),
      ...index.filter((s) => terms.every((t) => s.hay.includes(t))).slice(0, 5).map(({ s: stream }) => ({ kind: 'camera' as const, stream, label: stream.name, detail: `Camera · ${stream.place}, ${stream.country}` })),
    ];
  }, [query, data.flights, data.sats, data.events, index]);
  const results = [...remote, ...local];
  const pick = (r?: SearchResult) => { if (!r) return; data.onResult(r); setQ(''); setRemote([]); setOpen(false); request.current?.abort(); input.current?.blur(); };
  const findPlaces = async () => {
    const point = parseCoordinates(q);
    if (point) { pick({ kind: 'place', ...point, label: q, detail: 'Coordinates' }); return; }
    if (q.trim().length < 2) { setStatus('Enter at least two characters.'); return; }
    request.current?.abort(); const ctrl = new AbortController(); request.current = ctrl;
    setStatus('Finding cities and landmarks…'); setRemote([]); setOpen(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error('Place service unavailable. Local results are still available.');
      const j = await r.json() as GeoJSON.FeatureCollection<GeoJSON.Point>;
      const found: SearchResult[] = j.features.filter((f) => f.geometry?.type === 'Point' && validPoint(f.geometry.coordinates[1], f.geometry.coordinates[0])).map((f) => ({
        kind: 'place', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: String(f.properties?.name ?? q),
        detail: ['Place', f.properties?.city, f.properties?.state, f.properties?.country].filter(Boolean).join(' · '),
      }));
      if (ctrl.signal.aborted) return;
      setRemote(found); setStatus(found.length ? 'Places: © OpenStreetMap · Photon' : 'No places found. Try a nearby city.'); setActive(-1);
    } catch (e) { if (!ctrl.signal.aborted) setStatus(e instanceof Error ? e.message : 'Search failed.'); }
  };
  return <div className="relative min-w-0 w-full md:w-60" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <form className="flex h-9 items-center gap-2 rounded border border-strong bg-raised px-2 focus-within:border-accent" onSubmit={(e) => { e.preventDefault(); if (active >= 0) pick(results[active]); else void findPlaces(); }}>
      <input ref={input} value={q} maxLength={120} onChange={(e) => { request.current?.abort(); setQ(e.target.value); setRemote([]); setStatus(''); setActive(-1); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
          if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); input.current?.blur(); }
        }} placeholder="Search anywhere" aria-label="Search places, cameras, flights and satellites" role="combobox" aria-expanded={open && !!q} aria-controls="search-results"
        aria-autocomplete="list" aria-activedescendant={active >= 0 && results[active] ? `search-${active}` : undefined} className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none" />
      <button type="submit" aria-label="Find cities and landmarks" className="min-h-9 min-w-8 text-accent"><IconSearch width={18} height={18} /></button>
    </form>
    {open && q && <div className="absolute right-0 top-10 z-40 max-h-[65dvh] w-[min(380px,calc(100vw-24px))] overflow-y-auto rounded border border-strong bg-panel shadow-xl max-md:fixed max-md:inset-x-3 max-md:top-12 max-md:w-auto">
      <p className="px-3 py-2 text-xs text-secondary">Enter or tap search for cities and landmarks. Aircraft and events search loaded feeds.</p>
      <ul id="search-results" role="listbox">{results.map((r, i) => <li key={`${r.kind}:${i}`} id={`search-${i}`} role="option" aria-selected={active === i}>
        <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)} onMouseEnter={() => setActive(i)}
          className={`min-h-12 w-full px-3 py-2 text-left hover:bg-hover ${active === i ? 'bg-hover border-l-2 border-accent' : ''}`}><span className="block truncate">{r.label}</span><span className="block truncate text-xs text-secondary">{r.detail}</span></button>
      </li>)}</ul>
      <p role="status" className="px-3 py-2 text-xs text-secondary">{status || (!results.length ? 'No loaded matches. Search for a place above.' : `${results.length} matches`)}</p>
    </div>}
  </div>;
}
