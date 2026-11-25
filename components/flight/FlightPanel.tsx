'use client';

import { useEffect, useRef, useState } from 'react';
import { formatAlt, type Flight } from '@/lib/flights';
import { formatCoord } from '@/lib/geo';
import { IconButton, Row } from '@/components/stream/StreamPanel';
import { IconClose, IconExternal, IconFullscreen, IconLocate } from '@/components/chrome/icons';
import Cockpit, { type CockpitHandle } from './Cockpit';

/** The three worldwide emergency codes. Every other squawk is routine and gets no gloss. */
const SQUAWK_MEANING: Record<string, string> = {
  '7500': 'unlawful interference',
  '7600': 'radio failure',
  '7700': 'general emergency',
};

interface Props {
  flight: Flight;
  /** False once the aircraft has dropped out of the latest poll: we show its last fix. */
  live: boolean;
  onClose(): void;
  onLocate(): void;
  trailCount: number;
}

export default function FlightPanel({ flight: f, live, onClose, onLocate, trailCount }: Props) {
  const cockpit = useRef<CockpitHandle>(null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-subtle px-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-secondary">
          {live ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" /> : <span className="h-1.5 w-1.5 rounded-full bg-dead" />}
          {live ? 'Tracking' : 'Signal lost'}
          <span className="text-tertiary">/ ads-b / cockpit</span>
        </div>
        <IconButton label="Close panel (Esc)" onClick={onClose}><IconClose /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AircraftPhoto hex={f.hex} />
        <div className="p-4 pb-3"><Cockpit key={f.hex} ref={cockpit} flight={f} /></div>

        <div className="px-4">
          <h2 className="font-mono text-[16px] leading-6 font-medium text-primary">{f.callsign}</h2>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary">
            {[f.reg, f.type, f.hex].filter(Boolean).join(' · ')}
          </div>
          {(f.emergency || f.mil) && (
            <div className={`mt-1.5 inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
              f.emergency ? 'border-emergency/40 bg-emergency/10 text-emergency' : 'border-mil/40 bg-mil/10 text-mil'}`}>
              {f.emergency ? 'Emergency' : 'Military'}
            </div>
          )}
        </div>

        <dl className="mx-4 mt-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-t border-subtle pt-3">
          <Row label="Altitude">{formatAlt(f)}</Row>
          <Row label="Speed">{Math.round(f.gs)} kt</Row>
          <Row label="Track">{Math.round(f.track)}°</Row>
          <Row label="Vert. rate">{f.vs > 0 ? '+' : ''}{Math.round(f.vs)} ft/min</Row>
          <Row label="Squawk">
            {f.squawk ?? '—'}
            {SQUAWK_MEANING[f.squawk ?? ''] && <span className="text-emergency"> · {SQUAWK_MEANING[f.squawk!]}</span>}
          </Row>
          <Row label="Coords">{formatCoord(f.lat, f.lon)}</Row>
          <Row label="Last fix">{Math.max(0, Math.round((Date.now() - f.at) / 60_000))} min ago{live ? '' : ' · position may be stale'}</Row>
          <Row label="Trail">{trailCount} received positions · this visit only, up to 30 min. Gaps are not connected.</Row>
          <Row label="Source">
            <a href={{ OpenSky: 'https://opensky-network.org', PocketWorld: 'https://pocketworld.org/api', 'adsb.lol': 'https://adsb.lol' }[f.source]}
              target="_blank" rel="noopener noreferrer" className="hover:text-accent">{f.source}</a>
          </Row>
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5 px-4 pb-4">
          <IconButton label="Centre on aircraft" onClick={onLocate}><IconLocate /></IconButton>
          <IconButton label="Fullscreen cockpit" onClick={() => cockpit.current?.fullscreen()}><IconFullscreen /></IconButton>
          <a
            href={`https://adsb.lol/?icao=${f.hex}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on adsb.lol"
            aria-label="Open on adsb.lol"
            className="grid h-8 w-8 place-items-center rounded-[2px] border border-subtle bg-raised text-secondary transition-colors duration-200 ease-atlas hover:bg-hover hover:text-accent"
          >
            <IconExternal />
          </a>
        </div>
      </div>
    </div>
  );
}

interface Photo { src: string; link: string; photographer: string }

/** A photo of this exact airframe when one is available; the photographer retains the credit. */
function AircraftPhoto({ hex }: { hex: string }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setPhoto(null);
    fetch(`https://api.planespotters.net/pub/photos/hex/${hex}`, { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { photos?: { thumbnail_large?: { src?: string }; link?: string; photographer?: string }[] } | null) => {
        const p = data?.photos?.[0];
        if (p?.thumbnail_large?.src && p.link && new URL(p.thumbnail_large.src).hostname === 't.plnspttrs.net'
          && new URL(p.link).hostname === 'www.planespotters.net') {
          setPhoto({ src: p.thumbnail_large.src, link: p.link, photographer: p.photographer || 'Planespotters.net contributor' });
        }
      }).catch(() => undefined);
    return () => ctrl.abort();
  }, [hex]);
  if (!photo) return null;
  return <figure className="border-b border-subtle bg-void">
    <a href={photo.link} target="_blank" rel="noopener noreferrer" aria-label="View aircraft photo on Planespotters.net">
      {/* eslint-disable-next-line @next/next/no-img-element -- external credited thumbnail */}
      <img src={photo.src} alt={`Aircraft ${hex.toUpperCase()}`} className="max-h-52 w-full object-contain" />
    </a>
    <figcaption className="px-4 py-1 text-[10px] text-secondary">
      © {photo.photographer} / <a href={photo.link} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Planespotters.net</a>
    </figcaption>
  </figure>;
}
