'use client';

import { useEffect, useRef, useState, type Ref } from 'react';
import type { Stream } from '@/lib/stream';
import type { Sky } from '@/lib/sky';
import Search, { type SearchHandle } from './Search';
import SkyMenu from './SkyMenu';
import { IconEye, IconRandom } from './icons';

export type Layer = 'cameras' | 'flights' | 'airports' | 'satellites' | 'events' | 'radio' | 'dossier';
export type Layers = Record<Layer, boolean>;

const LAYERS: { id: Layer; label: string; title: string }[] = [
  { id: 'cameras', label: 'Cameras', title: 'Public live cameras' },
  { id: 'flights', label: 'Flights', title: 'Live aircraft (ADS-B) around the view; click one for the cockpit view' },
  { id: 'airports', label: 'Airports', title: 'Highlight airports and runways; zoom in and click an airport to explore' },
  { id: 'satellites', label: 'Satellites', title: 'Everything in orbit, live (CelesTrak); click one to follow it' },
  { id: 'events', label: 'Earth', title: 'Earthquakes, fires, storms, eruptions and ice, live; click one for a dossier' },
  { id: 'radio', label: 'Radio', title: 'Live radio stations worldwide (Radio Browser); click one to listen' },
];

/** A panel rather than a map layer. */
export interface Tool { id: string; label: string; title: string; on: boolean; count?: number | null; key: string }

interface Props {
  streams: Stream[];
  searchRef: Ref<SearchHandle>;
  layers: Layers;
  counts: Partial<Record<Layer, number | null>>;
  onToggleLayer(l: Layer): void;
  onEarthEvents(): void;
  onPick(s: Stream): void;
  onRandom(): void;
  snapshots: boolean;
  snapshotCount: number;
  onToggleSnapshots(): void;
  sky: Sky;
  onSky(next: Sky): void;
  tools: Tool[];
  onTool(id: string): void;
}

const CHIP = 'flex h-6 shrink-0 items-center gap-1.5 rounded-[2px] border px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas';
const chipState = (on: boolean) => (on ? 'border-strong bg-raised text-primary hover:border-accent-muted' : 'border-subtle text-tertiary hover:text-secondary');

export default function Header(p: Props) {
  const [cameraMenu, setCameraMenu] = useState<{ left: number; top: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openCameras = (button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    trigger.current = button;
    setCameraMenu({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.bottom + 6 });
  };
  useEffect(() => {
    if (!cameraMenu) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) setCameraMenu(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCameraMenu(null); trigger.current?.focus(); }
    };
    const dismiss = () => setCameraMenu(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [cameraMenu]);
  const chips = (
    <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label="Layers">
      {LAYERS.map(({ id, label, title }) => {
        const on = p.layers[id];
        const n = p.counts[id];
        return (
          <div key={id} className="flex shrink-0 items-center">
          <button type="button" aria-pressed={on} title={`${title}${id === 'cameras' ? '; right-click for snapshots' : id === 'events' ? '; right-click for all events' : ''}`}
            onContextMenu={id === 'cameras' || id === 'events' ? (e) => { e.preventDefault(); if (id === 'cameras') openCameras(e.currentTarget); else p.onEarthEvents(); } : undefined}
            onKeyDown={(e) => {
              if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
                if (id === 'cameras' || id === 'events') { e.preventDefault(); if (id === 'cameras') openCameras(e.currentTarget); else p.onEarthEvents(); }
              }
            }}
            onClick={() => p.onToggleLayer(id)} className={`${CHIP} ${chipState(on)}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${on ? LAYER_DOT[id] : 'bg-strong'}`} />
            {label}
            {n != null && <span className="text-tertiary">{n.toLocaleString('en-US')}</span>}
          </button>
          {(id === 'cameras' || id === 'events') && <button type="button"
            aria-label={id === 'cameras' ? 'Camera options' : 'Show all Earth events'}
            title={id === 'cameras' ? 'Camera options (also right-click Cameras)' : 'All Earth events (also right-click Earth)'}
            aria-expanded={id === 'cameras' ? !!cameraMenu : undefined}
            aria-haspopup={id === 'cameras' ? 'dialog' : undefined}
            onClick={(e) => { if (id === 'cameras') openCameras(e.currentTarget); else p.onEarthEvents(); }}
            className="flex h-6 w-6 items-center justify-center rounded-[2px] text-tertiary hover:bg-hover hover:text-primary">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true"><path d="m2 4 3 3 3-3" /></svg>
          </button>}
          </div>
        );
      })}
      <span className="mx-1 h-4 w-px shrink-0 bg-strong" aria-hidden />
      <button type="button" aria-pressed={p.layers.dossier} onClick={() => p.onToggleLayer('dossier')}
        title="Click anywhere on the globe for a dossier of that spot" className={`${CHIP} ${chipState(p.layers.dossier)}`}>
        Dossier
      </button>
      <span className="mx-1 h-4 w-px shrink-0 bg-strong" aria-hidden />
      {p.tools.map((t) => (
        <button key={t.id} type="button" aria-pressed={t.on} title={`${t.title} (${t.key})`} onClick={() => p.onTool(t.id)} className={`${CHIP} ${chipState(t.on)}`}>
          {t.label}
          {!!t.count && <span className="text-emergency">{t.count}</span>}
        </button>
      ))}
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
          <SkyMenu sky={p.sky} onChange={p.onSky} />
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
      {cameraMenu && <div ref={menu} role="dialog" aria-label="Camera options" style={cameraMenu}
        className="fixed z-50 w-[280px] rounded-[4px] border border-strong bg-panel p-3 shadow-xl">
        <div className="label mb-2">Cameras</div>
        <button type="button" role="switch" aria-checked={p.snapshots} onClick={p.onToggleSnapshots}
          className="flex min-h-10 w-full items-center gap-3 rounded-[2px] px-2 text-left hover:bg-hover">
          <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-[2px] border ${p.snapshots ? 'border-accent bg-accent' : 'border-strong'}`} />
          <span className="flex-1 text-sm text-primary">Snapshots</span>
          <span className="font-mono text-[11px] text-secondary">{p.snapshotCount.toLocaleString('en-US')}</span>
        </button>
        <p className="mt-1 px-2 text-[11px] leading-4 text-secondary">Include still images from traffic and weather cameras.</p>
      </div>}
    </header>
  );
}

const LAYER_DOT: Record<Layer, string> = { cameras: 'bg-live', flights: 'bg-flight', airports: 'bg-accent', satellites: 'bg-sat', events: 'bg-quake', radio: 'bg-radio', dossier: 'bg-accent' };
