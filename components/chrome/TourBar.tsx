'use client';

import { useEffect, useState } from 'react';

export type TourMode = 'sunrise' | 'sunset' | 'pulse';

const MODES: { id: TourMode; label: string; title: string }[] = [
  { id: 'sunrise', label: 'Sunrise', title: 'Hop between cameras where the sun is coming up; the dawn moves west, and so do you' },
  { id: 'sunset', label: 'Sunset', title: 'Hop between cameras where the sun is going down' },
  { id: 'pulse', label: 'Pulse', title: 'Visit everything notable happening on Earth, most urgent first' },
];

interface Props {
  mode: TourMode;
  /** When the next hop happens (epoch ms). */
  nextAt: number;
  /** Nothing to visit in this mode right now. */
  idle: boolean;
  onMode(m: TourMode): void;
  onSkip(): void;
  onStop(): void;
}

/** The autopilot: which tour, when it moves on, skip and stop. Any touch on the globe also stops it. */
export default function TourBar({ mode, nextAt, idle, onMode, onSkip, onStop }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const btn = 'h-6 shrink-0 rounded-[2px] border px-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas';

  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-1 rounded-[4px] border border-strong bg-panel/95 px-2 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-sm">
      <span className="mr-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" /> Tour
      </span>
      {MODES.map((m) => (
        <button key={m.id} type="button" title={m.title} aria-pressed={mode === m.id} onClick={() => onMode(m.id)}
          className={`${btn} ${mode === m.id ? 'border-strong bg-raised text-primary' : 'border-subtle text-tertiary hover:text-secondary'}`}>
          {m.label}
        </button>
      ))}
      <span className="px-1 font-mono text-[10px] text-tertiary">
        {idle ? 'nothing to visit' : `next ${Math.max(0, Math.ceil((nextAt - now) / 1000))}s`}
      </span>
      <button type="button" onClick={onSkip} className={`${btn} border-subtle text-secondary hover:text-accent`}>Skip</button>
      <button type="button" onClick={onStop} className={`${btn} border-subtle text-secondary hover:text-accent`} title="Stop (A)">Stop</button>
    </div>
  );
}
