'use client';
import { useEffect, useRef, useState } from 'react';
import { INTEL_CATEGORIES, INTEL_IDS, type IntelCategory, type IntelEvent, type IntelFeed, type IntelSettings } from '@/lib/intel';

interface Props {
  settings: IntelSettings; events: IntelEvent[]; feeds: Partial<Record<IntelCategory, IntelFeed>>;
  earthReady: boolean; onChange(value: IntelSettings): void; onPick(event: IntelEvent): void;
  onDossier(lat: number, lon: number): void; onClose(): void;
}
const date = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export default function IntelPanel(p: Props) {
  const [feedOpen, setFeedOpen] = useState(false);
  const box = useRef<HTMLElement>(null);
  const selected = p.events.find(e => e.id === p.settings.selected);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  const toggle = (id: IntelCategory) => p.onChange({ ...p.settings, categories: p.settings.categories.includes(id) ? p.settings.categories.filter(c => c !== id) : [...p.settings.categories, id] });
  return <section ref={box} role="dialog" aria-label="Global intelligence" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } }}
    className="absolute right-3 top-3 z-20 max-h-[calc(100%-24px)] w-[360px] max-w-[calc(100%-24px)] overflow-y-auto rounded-[4px] border border-strong bg-panel/95 p-3 shadow-xl">
    <div className="mb-3 flex items-center justify-between"><h2 className="label text-primary">Intel · public reports</h2><button type="button" className="h-8 w-8 text-secondary hover:bg-hover" aria-label="Close intelligence" onClick={p.onClose}>×</button></div>
    <div className="grid grid-cols-2 gap-1" role="group" aria-label="Intelligence categories">
      <button type="button" aria-pressed={p.settings.categories.length === INTEL_IDS.length} onClick={() => p.onChange({ ...p.settings, categories: p.settings.categories.length === INTEL_IDS.length ? [] : [...INTEL_IDS] })}
        className="col-span-2 min-h-8 rounded-[2px] border border-subtle px-2 text-left font-mono text-[11px] text-secondary hover:bg-hover">All intelligence</button>
      {INTEL_IDS.map(id => {
        const active = p.settings.categories.includes(id), category = INTEL_CATEGORIES[id];
        const count = p.events.filter(e => e.category === id).length;
        const status = id === 'disasters' ? p.earthReady ? 'ok' : 'loading' : p.feeds[id]?.status ?? 'loading';
        return <button type="button" key={id} aria-pressed={active} onClick={() => toggle(id)} title={active ? `${category.label}: ${status}` : `Show ${category.label}`}
          className={`flex min-h-9 items-center gap-2 rounded-[2px] border px-2 text-left font-mono text-[11px] hover:bg-hover ${active ? 'border-strong bg-raised text-primary' : 'border-subtle text-secondary'}`}>
          <span aria-hidden style={{ background: active ? category.color : undefined }} className="h-1.5 w-1.5 shrink-0 rounded-full border border-strong" />
          <span className="flex-1">{category.label}</span><span>{active ? status === 'unavailable' ? '—' : count : ''}</span>
        </button>;
      })}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-secondary">
      <label>Time window<select value={p.settings.hours} onChange={e => p.onChange({ ...p.settings, hours: Number(e.target.value) })} className="mt-1 min-h-9 w-full rounded border border-strong bg-raised px-1 text-primary">
        {[1, 6, 24, 72, 168].map(h => <option key={h} value={h}>Last {h < 48 ? `${h} hours` : `${h / 24} days`}</option>)}
      </select></label>
      <label>Geography<select value={p.settings.scope} onChange={e => p.onChange({ ...p.settings, scope: e.target.value as IntelSettings['scope'] })} className="mt-1 min-h-9 w-full rounded border border-strong bg-raised px-1 text-primary"><option value="world">Worldwide</option><option value="viewport">Current viewport</option></select></label>
    </div>
    <label className="mt-3 block text-xs text-secondary">Filter headlines and locations<input value={p.settings.query} maxLength={120} onChange={e => p.onChange({ ...p.settings, query: e.target.value })} placeholder="Headline, place or incident ID" className="mt-1 min-h-9 w-full rounded border border-strong bg-raised px-2 text-primary" /></label>
    <p className="mt-2 text-[11px] leading-4 text-secondary">News location unverified? It stays in the feed without a map pin. News times indicate when GDELT indexed a report. Upcoming launches remain visible.</p>
    {p.settings.scope === 'viewport' && <p className="mt-2 text-[11px] text-secondary">Viewport excludes reports without verified geography.</p>}
    <div role="status" className="mt-2 text-[11px] leading-4 text-secondary">
      {p.settings.categories.filter(id => id !== 'disasters').map(id => <p key={id}>{INTEL_CATEGORIES[id].label}: {p.feeds[id]?.status ?? 'queued / loading'}{p.feeds[id]?.updatedAt ? ` · fetched ${date(p.feeds[id]!.updatedAt!)}` : ''}</p>)}
      {p.settings.categories.includes('disasters') && <p>Disasters: {p.earthReady ? 'shared USGS / EONET feeds' : 'waiting for Earth feeds'}</p>}
    </div>
    {selected && <article className="mt-3 border-t border-strong pt-3">
      <div className="label">{INTEL_CATEGORIES[selected.category].label} · {selected.status}</div>
      <h3 className="mt-2 text-sm font-medium text-primary">{selected.title}</h3>
      <p className="mt-2 text-xs leading-5 text-secondary">{selected.summary}</p>
      <dl className="mt-2 space-y-1 text-[11px] text-secondary">
        <div><dt className="inline">Location: </dt><dd className="inline">{selected.location} · {selected.precision}</dd></div>
        <div><dt className="inline">{selected.eventTime ? 'Event' : 'Indexed'}: </dt><dd className="inline">{date(selected.eventTime ?? selected.observedAt)}</dd></div>
        <div><dt className="inline">Retrieved: </dt><dd className="inline">{date(selected.retrievedAt)}</dd></div>
      </dl>
      <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block min-h-8 text-xs text-accent underline">Open source · {selected.sourceName} ↗</a>
      {selected.lat !== null && selected.lon !== null && <button type="button" className="min-h-9 text-xs text-accent" onClick={() => p.onDossier(selected.lat!, selected.lon!)}>Explore location in Dossier</button>}
      <button type="button" className="ml-3 min-h-9 text-xs text-secondary" onClick={() => p.onChange({ ...p.settings, selected: '' })}>Close report</button>
    </article>}
    {p.settings.selected && !selected && <p role="status" className="mt-3 text-xs text-secondary">This report is unavailable or outside the current filters.</p>}
    <button type="button" aria-expanded={feedOpen} onClick={() => setFeedOpen(!feedOpen)} className="mt-3 min-h-9 w-full border-t border-strong text-left font-mono text-[11px] text-accent">{feedOpen ? 'Hide' : 'Show'} intelligence feed · {p.events.length}</button>
    {feedOpen && <ul className="divide-y divide-subtle">{p.events.slice(0, 100).map(e => <li key={e.id}><button type="button" onClick={() => p.onPick(e)} className="w-full py-3 text-left hover:bg-hover">
      <span className="block text-[10px] uppercase" style={{ color: INTEL_CATEGORIES[e.category].color }}>{INTEL_CATEGORIES[e.category].label} · {e.sourceName}</span>
      <span className="mt-1 block text-xs leading-5 text-primary">{e.title}</span><span className="mt-1 block text-[10px] text-secondary">{e.location} · {date(e.observedAt)}</span>
    </button></li>)}{!p.events.length && <li className="py-3 text-xs text-secondary">No loaded reports match these filters. Check feed status above.</li>}{p.events.length > 100 && <li className="py-2 text-xs text-secondary">Showing the newest 100. Narrow the filters for more.</li>}</ul>}
  </section>;
}
