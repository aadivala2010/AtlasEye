'use client';

import { useRef, useState, type ReactNode, type Ref } from 'react';
import { SOURCE_CREDIT, type Stream } from '@/lib/stream';
import { distanceKm, formatCoord, formatDistance } from '@/lib/geo';
import Player, { type PlayerHandle } from './Player';
import Clocks from './Clocks';
import {
  IconCheck, IconClose, IconExternal, IconFullscreen, IconLink, IconLocate, IconMuted, IconNext, IconPrev, IconRandom, IconSound,
} from '@/components/chrome/icons';

const countryNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export const countryName = (cc: string) => {
  try { return countryNames?.of(cc) ?? cc; } catch { return cc; }
};

interface Props {
  stream: Stream;
  builtAt: string;
  muted: boolean;
  userPos: { lat: number; lon: number } | null;
  playerRef: Ref<PlayerHandle>;
  onClose(): void;
  onPrev(): void;
  onNext(): void;
  onRandom(): void;
  onToggleMute(): void;
  onFullscreen(): void;
  onLocate(): void;
}

export default function StreamPanel(p: Props) {
  const { stream: s } = p;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: nothing sensible to do */ }
  };

  return (
    <div className="flex h-full flex-col">
      {/* status strip */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-subtle px-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-secondary">
          {s.kind === 'snapshot'
            ? <span className="h-1.5 w-1.5 rounded-full border border-night" />
            : <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />}
          {s.kind === 'snapshot' ? 'Snapshot' : 'Live'}
          <span className="text-tertiary">/ {s.kind === 'youtube' ? 'youtube' : s.kind === 'snapshot' ? 'still' : 'video'} / {s.category}</span>
        </div>
        <IconButton label="Close panel (Esc)" onClick={p.onClose}><IconClose /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="p-4 pb-3">
          <Player key={s.id} ref={p.playerRef} stream={s} muted={p.muted} builtAt={p.builtAt} />
        </div>

        <div className="px-4">
          <h2 className="text-[16px] leading-6 font-medium text-primary">{s.name}</h2>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary">
            {s.place} · {countryName(s.country)} · {s.country}
          </div>
        </div>

        <div className="px-4 pt-4"><Clocks stream={s} /></div>

        <dl className="mx-4 mt-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-t border-subtle pt-3">
          <Row label="Coords">{formatCoord(s.latitude, s.longitude)}</Row>
          <Row label="Category">{s.category}</Row>
          <Row label="Timezone">{s.timezone}</Row>
          <Row label="Located by">
            {LOCATED[s.geocode](s)}
          </Row>
          <Row label="Source">
            <a href={SOURCE_CREDIT[s.source].href} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
              {SOURCE_CREDIT[s.source].label}
            </a>
          </Row>
          <Row label="Distance">
            {p.userPos ? (
              formatDistance(distanceKm(p.userPos.lat, p.userPos.lon, s.latitude, s.longitude))
            ) : (
              <button
                onClick={p.onLocate}
                className="inline-flex items-center gap-1 text-secondary transition-colors duration-200 ease-atlas hover:text-accent"
              >
                <IconLocate width={12} height={12} /> distance from me
              </button>
            )}
          </Row>
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5 px-4 pb-4">
          <IconButton label="Previous nearest (←)" onClick={p.onPrev}><IconPrev /></IconButton>
          <IconButton label="Next nearest (→)" onClick={p.onNext}><IconNext /></IconButton>
          <IconButton label="Random stream (R)" onClick={p.onRandom}><IconRandom /></IconButton>
          {(s.kind === 'youtube' || s.kind === 'hls') && (
            <IconButton label={p.muted ? 'Unmute (M)' : 'Mute (M)'} onClick={p.onToggleMute} active={!p.muted}>
              {p.muted ? <IconMuted /> : <IconSound />}
            </IconButton>
          )}
          <IconButton label="Fullscreen (F)" onClick={p.onFullscreen}><IconFullscreen /></IconButton>
          <IconButton label={copied ? 'Link copied' : 'Copy link'} onClick={copyLink} active={copied}>
            {copied ? <IconCheck /> : <IconLink />}
          </IconButton>
          <a
            href={s.kind === 'youtube' ? `https://www.youtube.com/watch?v=${s.id}` : s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.kind === 'youtube' ? 'Open on YouTube' : 'Open source feed'}
            aria-label={s.kind === 'youtube' ? 'Open on YouTube' : 'Open source feed'}
            className={ICON_BUTTON}
          >
            <IconExternal />
          </a>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-subtle px-4 py-2 max-lg:hidden">
        <Key k="R">random</Key>
        <Key k="← →">nearest</Key>
        <Key k="/">search</Key>
        <Key k="F">full</Key>
        <Key k="M">mute</Key>
        <Key k="Esc">close</Key>
      </footer>
    </div>
  );
}

const LOCATED: Record<Stream['geocode'], (s: Stream) => string> = {
  override: () => 'hand-placed',
  gazetteer: (s) => `gazetteer · ${s.confidence.toFixed(2)}`,
  gps: () => 'broadcaster GPS',
  operator: () => 'camera operator',
};

const ICON_BUTTON =
  'grid h-8 w-8 place-items-center rounded-[2px] border border-subtle bg-raised text-secondary transition-colors duration-200 ease-atlas hover:bg-hover hover:text-accent';

export function IconButton({ label, onClick, active, children }: { label: string; onClick(): void; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`${ICON_BUTTON} ${active ? 'text-accent' : ''}`}>
      {children}
    </button>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="label self-center">{label}</dt>
      <dd className="truncate font-mono text-[11px] text-primary">{children}</dd>
    </>
  );
}

function Key({ k, children }: { k: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] text-tertiary">
      <span className="kbd">{k}</span>{children}
    </span>
  );
}
