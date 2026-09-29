'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Stream } from '@/lib/stream';
import { pickWall, sunPhase, type WallMode } from '@/lib/wall';
import { zonedClock } from '@/lib/time';
import Player from '@/components/stream/Player';
import { IconButton } from '@/components/stream/StreamPanel';
import { IconClose, IconRandom } from '@/components/chrome/icons';

interface Props {
  streams: Stream[];
  builtAt: string;
  /** Streams on screen right now. */
  inView(): Stream[];
  onOpen(s: Stream): void;
  onClose(): void;
}

const MODES: { id: WallMode; label: string; empty: string }[] = [
  { id: 'view', label: 'In view', empty: 'No cameras in view: zoom out or pan somewhere busier.' },
  { id: 'world', label: 'World', empty: 'No cameras loaded.' },
  { id: 'sunrise', label: 'Sunrise', empty: 'No camera has the sun rising right now.' },
  { id: 'sunset', label: 'Sunset', empty: 'No camera has the sun setting right now.' },
];

/** Many places at once: a grid of live feeds, muted; click one to open it. */
export default function Wall({ streams, builtAt, inView, onOpen, onClose }: Props) {
  const [mode, setMode] = useState<WallMode>('view');
  const [shuffle, setShuffle] = useState(0);
  const [cells, setCells] = useState(9);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setCells(mq.matches ? 4 : 9);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const picks = useMemo(() => {
    const now = Date.now();
    const pool = mode === 'view' ? inView()
      : mode === 'world' ? streams
      : streams.filter((s) => sunPhase(s, now) === (mode === 'sunrise' ? 'rise' : 'set'));
    return pickWall(pool, cells, mode !== 'view');
    // `shuffle` re-deals the same mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, shuffle, cells, streams]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-void" role="dialog" aria-label="Camera wall">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-subtle px-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-secondary max-sm:hidden">Wall</span>
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`h-7 shrink-0 rounded-[2px] border px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas ${
                mode === m.id ? 'border-strong bg-raised text-primary' : 'border-subtle text-tertiary hover:text-secondary'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <IconButton label="Deal again" onClick={() => setShuffle((n) => n + 1)}><IconRandom /></IconButton>
        <IconButton label="Close the wall (Esc)" onClick={onClose}><IconClose /></IconButton>
      </div>
      {picks.length === 0 ? (
        <div className="grid flex-1 place-items-center p-6 font-mono text-[11px] tracking-[0.08em] text-tertiary">
          {MODES.find((m) => m.id === mode)!.empty}
        </div>
      ) : (
        <div className={`grid min-h-0 flex-1 auto-rows-fr gap-px overflow-y-auto bg-subtle ${cells === 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'}`}>
          {picks.map((s) => (
            <figure key={s.id} className="relative flex min-h-0 flex-col bg-void">
              <div className="min-h-0 flex-1 [&>div]:h-full [&>div]:aspect-auto">
                <Player stream={s} muted builtAt={builtAt} />
              </div>
              <figcaption>
                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  className="flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left transition-colors duration-200 ease-atlas hover:bg-hover"
                  title="Open this stream"
                >
                  <span className="min-w-0 truncate text-[12px] text-primary">{s.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-tertiary">{s.place.split(',')[0]} · {zonedClock(now, s.timezone).time.slice(0, 5)}</span>
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
