'use client';

import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { Stream } from '@/lib/stream';
import { countryName } from '@/components/stream/StreamPanel';
import { IconSearch } from './icons';

export interface SearchHandle { focus(): void }

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export default function Search({ ref, streams, onPick }: { ref?: Ref<SearchHandle>; streams: Stream[]; onPick(s: Stream): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const index = useMemo(
    () => streams.map((s) => ({ s, name: fold(s.name), hay: fold(`${s.name} ${s.place} ${countryName(s.country)} ${s.country}`) })),
    [streams],
  );

  const results = useMemo(() => {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return index
      .filter((x) => terms.every((t) => x.hay.includes(t)))
      .map((x) => ({ s: x.s, score: (x.name.startsWith(terms[0]) ? 2 : 0) + (x.name.includes(terms[0]) ? 1 : 0) + x.s.confidence }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.s);
  }, [index, q]);

  const pick = (s: Stream | undefined) => {
    if (!s) return;
    onPick(s);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="relative w-full md:w-60">
      <div className="flex h-8 items-center gap-2 rounded-[2px] border border-subtle bg-raised px-2 transition-colors duration-200 ease-atlas focus-within:border-accent-muted">
        <IconSearch width={14} height={14} className="shrink-0 text-tertiary" />
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') pick(results[active]);
            else if (e.key === 'Escape') { setQ(''); input.current?.blur(); }
          }}
          placeholder="Search places"
          aria-label="Search streams by place"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="search-results"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-primary placeholder:text-tertiary focus:outline-none"
        />
        <span className="kbd max-md:hidden">/</span>
      </div>
      {open && q && (
        <ul
          id="search-results"
          role="listbox"
          className="absolute right-0 left-0 top-9 z-30 overflow-hidden rounded-[4px] border border-strong bg-panel shadow-[0_12px_32px_rgba(0,0,0,0.6)] md:left-auto md:w-80"
        >
          {results.length === 0 && <li className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary">No matches</li>}
          {results.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer border-l px-3 py-2 ${i === active ? 'border-accent bg-hover' : 'border-transparent'}`}
            >
              <div className="truncate text-[13px] text-primary">{s.name}</div>
              <div className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary">{s.place} · {s.country}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
