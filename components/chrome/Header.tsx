'use client';

import type { Ref } from 'react';
import { CATEGORIES, type Category, type Stream } from '@/lib/stream';
import Search, { type SearchHandle } from './Search';
import { IconEye, IconRandom } from './icons';

interface Props {
  streams: Stream[];
  counts: Record<Category, number>;
  enabled: Set<Category>;
  searchRef: Ref<SearchHandle>;
  onToggle(c: Category): void;
  onReset(): void;
  onPick(s: Stream): void;
  onRandom(): void;
  snapshots: boolean;
  snapshotCount: number;
  onToggleSnapshots(): void;
}

export default function Header(p: Props) {
  const filtered = p.enabled.size < CATEGORIES.length;
  const chips = (
    <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label="Categories">
      {CATEGORIES.map((c) => {
        const on = p.enabled.has(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => p.onToggle(c)}
            className={`flex h-6 shrink-0 items-center gap-1.5 rounded-[2px] border px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas ${
              on ? 'border-strong bg-raised text-primary hover:border-accent-muted' : 'border-subtle text-tertiary hover:text-secondary'
            }`}
          >
            {c}
            <span className={on ? 'text-tertiary' : 'text-tertiary/60'}>{p.counts[c]}</span>
          </button>
        );
      })}
      <span className="mx-1 h-4 w-px shrink-0 bg-strong" aria-hidden />
      <button
        type="button"
        aria-pressed={p.snapshots}
        onClick={p.onToggleSnapshots}
        title="Still images from traffic and weather cameras, refreshed every few seconds to minutes"
        className={`flex h-6 shrink-0 items-center gap-1.5 rounded-[2px] border px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas ${
          p.snapshots ? 'border-strong bg-raised text-primary hover:border-accent-muted' : 'border-subtle text-tertiary hover:text-secondary'
        }`}
      >
        Snapshots
        <span className="text-tertiary">{p.snapshotCount}</span>
      </button>
      {filtered && (
        <button type="button" onClick={p.onReset} className="h-6 shrink-0 px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-accent hover:underline">
          All
        </button>
      )}
    </div>
  );

  return (
    <header className="relative z-20 shrink-0 border-b border-subtle bg-panel/90 backdrop-blur-sm">
      <div className="flex h-12 items-center gap-4 px-4">
        <a href="/about" className="flex shrink-0 items-center gap-2 text-primary" title="About Atlas Eye">
          <IconEye width={18} height={18} className="text-accent" />
          <span className="text-[13px] font-semibold tracking-[0.14em] max-sm:hidden">ATLAS EYE</span>
        </a>
        <div className="hidden min-w-0 flex-1 md:block">{chips}</div>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-none">
          <Search ref={p.searchRef} streams={p.streams} onPick={p.onPick} />
          <button
            type="button"
            onClick={p.onRandom}
            title="Random stream (R)"
            className="flex h-8 shrink-0 items-center gap-2 rounded-[2px] border border-accent-muted bg-accent-glow px-3 font-mono text-[11px] font-medium tracking-[0.08em] text-accent transition-[background-color,box-shadow] duration-200 ease-atlas hover:bg-accent/20 hover:shadow-[0_0_16px_var(--accent-glow)]"
          >
            <IconRandom width={14} height={14} />
            RANDOM
            <span className="kbd border-accent-muted text-accent/70 max-md:hidden">R</span>
          </button>
        </div>
      </div>
      <div className="border-t border-subtle px-4 py-1.5 md:hidden">{chips}</div>
    </header>
  );
}
