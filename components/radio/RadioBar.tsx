'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/lib/radio';
import { countryName, IconButton } from '@/components/stream/StreamPanel';
import { IconClose, IconNext } from '@/components/chrome/icons';

/** What's on air: the station playing, another nearby, or off. */
export default function RadioBar({ station, onNext, onStop }: { station: Station; onNext(): void; onStop(): void }) {
  const [status, setStatus] = useState<'tuning' | 'on' | 'off'>('tuning');
  useEffect(() => setStatus('tuning'), [station.id]);

  return (
    <div className="pointer-events-auto flex w-[min(360px,calc(100vw-24px))] items-center gap-2 rounded-[4px] border border-strong bg-panel/95 py-1.5 pr-1.5 pl-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-sm">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'on' ? 'live-dot bg-radio' : status === 'off' ? 'bg-dead' : 'bg-strong'}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-primary">{station.name}</div>
        <div className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-tertiary">
          {status === 'off' ? 'Station offline' : status === 'tuning' ? 'Tuning' : 'On air'} · {countryName(station.cc)}
          {station.tags && ` · ${station.tags}`}
        </div>
      </div>
      <IconButton label="Another station nearby" onClick={onNext}><IconNext /></IconButton>
      <IconButton label="Stop the radio" onClick={onStop}><IconClose /></IconButton>
      {/* Keyed so a new station is a new element: the old stream's connection closes with it. */}
      <audio key={station.id} src={station.url} autoPlay onPlaying={() => setStatus('on')} onError={() => setStatus('off')} />
    </div>
  );
}
