'use client';

import type { Ship } from '@/lib/ships';
import { shipType } from '@/lib/ships';
import { formatCoord } from '@/lib/geo';
import { IconButton, Row } from '@/components/stream/StreamPanel';
import { IconClose, IconLocate } from '@/components/chrome/icons';

export default function ShipPanel({ ship, trailCount, onClose, onLocate }: {
  ship: Ship; trailCount: number; onClose(): void; onLocate(): void;
}) {
  const age = Math.max(0, Math.round((Date.now() - ship.at) / 60_000));
  return <div className="flex h-full flex-col">
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-subtle px-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-secondary">AIS / Ship tracking</span>
      <IconButton label="Close panel (Esc)" onClick={onClose}><IconClose /></IconButton>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <h2 className="text-lg font-medium text-primary">{ship.name || `MMSI ${ship.mmsi}`}</h2>
      <p className="mt-1 text-xs text-secondary">{shipType(ship.type)} · Last report {age < 1 ? 'just now' : `${age} min ago`}</p>
      <dl className="mt-5 grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 border-t border-subtle pt-4">
        <Row label="MMSI">{ship.mmsi}</Row>
        {ship.imo && <Row label="IMO">{ship.imo}</Row>}
        {ship.flag && <Row label="Flag">{ship.flag}</Row>}
        <Row label="Speed">{ship.speed === undefined ? '—' : `${ship.speed.toFixed(1)} kt`}</Row>
        <Row label="Course">{ship.course === undefined ? '—' : `${Math.round(ship.course)}°`}</Row>
        <Row label="Destination">{ship.destination || 'Not reported'}</Row>
        <Row label="Position">{formatCoord(ship.lat, ship.lon)}</Row>
        <Row label="Track">{trailCount ? `${trailCount} observed segments · last 24 h` : 'No recent track available'}</Row>
        <Row label="Source"><a href="https://openseafeed.com/docs" target="_blank" rel="noopener noreferrer" className="hover:text-accent">OpenSeaFeed AIS</a></Row>
      </dl>
      <p className="mt-4 text-xs leading-5 text-secondary">The line on the map is the vessel’s received track, with gaps left open. Destination is reported by the vessel and may be incomplete.</p>
      <div className="mt-4"><IconButton label="Centre on ship" onClick={onLocate}><IconLocate /></IconButton></div>
    </div>
  </div>;
}
