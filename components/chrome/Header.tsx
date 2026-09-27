'use client';

import type { Ref } from 'react';
import type { Stream } from '@/lib/stream';
import Search, { type SearchHandle } from './Search';
import { IconEye, IconMoon, IconRandom } from './icons';

export type Layer = 'cameras' | 'flights' | 'dossier';
export type Layers = Record<Layer, boolean>;

const LAYERS: { id: Layer; label: string; title: string }[] = [
  { id: 'cameras', label: 'Cameras', title: 'Public live cameras' },
  { id: 'flights', label: 'Flights', title: 'Live aircraft (ADS-B) around the view; click one for the cockpit view' },
  { id: 'dossier', label: 'Dossier', title: 'Click anywhere on the globe for a dossier of that spot' },
];

interface Props {
  streams: Stream[];
  searchRef: Ref<SearchHandle>;
  layers: Layers;
  counts: Partial<Record<Layer, number | null>>;
  onToggleLayer(l: Layer): void;
  onPick(s: Stream): void;
  onRandom(): void;
  snapshots: boolean;
  snapshotCount: number;
  onToggleSnapshots(): void;
  terminator: boolean;
  onToggleTerminator(): void;
}

const CHIP = 'flex h-6 shrink-0 items-center gap-1.5 rounded-[2px] border px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas';
const chipState = (on: boolean) => (on ? 'border-strong bg-raised text-primary hover:border-accent-muted' : 'border-subtle text-tertiary hover:text-secondary');

export default function Header(p: Props) {
  const chips = (
    <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label="Layers">
      {LAYERS.map(({ id, label, title }) => {
        const on = p.layers[id];
        const n = p.counts[id];
        return (
          <button key={id} type="button" aria-pressed={on} title={title} onClick={() => p.onToggleLayer(id)} className={`${CHIP} ${chipState(on)}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${on ? LAYER_DOT[id] : 'bg-strong'}`} />
            {label}
            {n != null && <span className="text-tertiary">{n.toLocaleString('en-US')}</span>}
          </button>
        );
      })}
      {p.layers.cameras && (
        <>
          <span className="mx-1 h-4 w-px shrink-0 bg-strong" aria-hidden />
          <button
            type="button"
            aria-pressed={p.snapshots}
            onClick={p.onToggleSnapshots}
            title="Still images from traffic and weather cameras, refreshed every few seconds to minutes"
            className={`${CHIP} ${chipState(p.snapshots)}`}
          >
            Snapshots
            <span className="text-tertiary">{p.snapshotCount.toLocaleString('en-US')}</span>
          </button>
        </>
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
          <button
            type="button"
            aria-pressed={p.terminator}
            aria-label="Day/night shading"
            onClick={p.onToggleTerminator}
            title="Day/night shading"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] border transition-colors duration-200 ease-atlas ${chipState(p.terminator)}`}
          >
            <IconMoon width={14} height={14} />
          </button>
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

const LAYER_DOT: Record<Layer, string> = { cameras: 'bg-live', flights: 'bg-flight', dossier: 'bg-accent' };
