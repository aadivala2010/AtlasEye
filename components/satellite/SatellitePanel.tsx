'use client';

import { useEffect, useState } from 'react';
import type { Stream } from '@/lib/stream';
import { formatCoord } from '@/lib/geo';
import {
  GROUP_LABEL, ISS, epochAgeDays, footprintKm, periodMin, satUrl, subpoint, type Sat,
} from '@/lib/satellites';
import Player from '@/components/stream/Player';
import { IconButton, Row } from '@/components/stream/StreamPanel';
import { IconClose, IconExternal, IconLocate, IconMuted, IconNext, IconSound } from '@/components/chrome/icons';

interface Feed { id: string; name: string; source: 'famelack' | 'camlisted' }

interface Props {
  sat: Sat;
  /** The time machine's moment; null = now. */
  time: number | null;
  follow: boolean;
  muted: boolean;
  onFollow(on: boolean): void;
  onLocate(): void;
  onToggleMute(): void;
  onClose(): void;
}

/** One satellite, live: where it is, how fast, how high — and for the ISS, the view out of its windows. */
export default function SatellitePanel({ sat, time, follow, muted, onFollow, onLocate, onToggleMute, onClose }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const at = new Date(time ?? now);
  const p = subpoint(sat, at);

  const [feeds, setFeeds] = useState<{ builtAt: string; feeds: Feed[] } | null>(null);
  const [feed, setFeed] = useState(0);
  useEffect(() => {
    if (sat.id !== ISS) return;
    const ctrl = new AbortController();
    fetch('/data/iss.json', { signal: ctrl.signal }).then((r) => r.json()).then(setFeeds).catch(() => undefined);
    return () => ctrl.abort();
  }, [sat.id]);
  const current = feeds?.feeds[feed % Math.max(1, feeds.feeds.length)];
  const stream: Stream | null = current && p ? {
    id: current.id, kind: 'youtube', name: current.name, latitude: p.lat, longitude: p.lon, place: 'Low Earth orbit', country: '',
    timezone: 'UTC', category: 'space', source: current.source, geocode: 'operator', confidence: 1, addedAt: '',
  } : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-subtle px-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-secondary">
          <span className={`h-1.5 w-1.5 rounded-full ${p ? 'live-dot bg-sat' : 'bg-dead'}`} />
          {p ? 'In orbit' : 'No fix'}
          <span className="text-tertiary">/ norad {sat.id}</span>
        </div>
        <IconButton label="Close panel (Esc)" onClick={onClose}><IconClose /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {stream && feeds && (
          <div className="p-4 pb-0">
            <Player key={stream.id} stream={stream} muted={muted} builtAt={feeds.builtAt} />
            <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px] text-tertiary">
              <span className="truncate">{stream.name}</span>
              {feeds.feeds.length > 1 && (
                <button type="button" onClick={() => setFeed((i) => i + 1)} className="flex shrink-0 items-center gap-1 uppercase tracking-[0.08em] hover:text-accent">
                  Feed {(feed % feeds.feeds.length) + 1}/{feeds.feeds.length} <IconNext width={12} height={12} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="px-4 pt-4">
          <h2 className="text-[16px] leading-6 font-medium text-primary">{sat.name}</h2>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary">
            {GROUP_LABEL[sat.group]} · {sat.intl || '—'}
          </div>
        </div>

        <dl className="mx-4 mt-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-t border-subtle pt-3">
          <Row label="Over">{p ? formatCoord(p.lat, p.lon) : '—'}</Row>
          <Row label="Altitude">{p ? `${Math.round(p.alt).toLocaleString('en-US')} km` : '—'}</Row>
          <Row label="Speed">{p ? `${p.speed.toFixed(2)} km/s · ${Math.round(p.speed * 3600).toLocaleString('en-US')} km/h` : '—'}</Row>
          <Row label="Orbit">{periodMin(sat).toFixed(1)} min · {(sat.rec.inclo * 180 / Math.PI).toFixed(1)}° incl.</Row>
          <Row label="Sees">{p ? `${Math.round(footprintKm(p.alt)).toLocaleString('en-US')} km around` : '—'}</Row>
          <Row label="Elements">{epochAgeDays(sat, at.getTime()).toFixed(1)} days old · CelesTrak</Row>
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5 px-4 pb-4">
          <IconButton label="Centre on it" onClick={onLocate}><IconLocate /></IconButton>
          <button
            type="button"
            onClick={() => onFollow(!follow)}
            aria-pressed={follow}
            className={`h-8 rounded-[2px] border px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas ${
              follow ? 'border-accent-muted bg-accent-glow text-accent' : 'border-subtle bg-raised text-secondary hover:bg-hover hover:text-accent'}`}
            title="Keep the globe centred under it as it moves"
          >
            {follow ? 'Following' : 'Follow'}
          </button>
          {stream && (
            <IconButton label={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={onToggleMute} active={!muted}>
              {muted ? <IconMuted /> : <IconSound />}
            </IconButton>
          )}
          <a
            href={satUrl(sat.id)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on N2YO"
            aria-label="Open on N2YO"
            className="grid h-8 w-8 place-items-center rounded-[2px] border border-subtle bg-raised text-secondary transition-colors duration-200 ease-atlas hover:bg-hover hover:text-accent"
          >
            <IconExternal />
          </a>
        </div>
      </div>
    </div>
  );
}
