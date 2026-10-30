'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatAlt, useFlights, type Flight } from '@/lib/flights';
import { airportTraffic, TRAFFIC_RANGE_NM, type Airport, type Movement } from '@/lib/airport-traffic';

const COLORS: Record<Movement, string> = {
  'Ground nearby': '#2BE88A', 'Toward airport': '#4DE1FF',
  'Away from airport': '#FFB547', 'Passing nearby': '#8B94A7',
};

export default function AirportTraffic({ airport, onTraffic, onTrack }: {
  airport: Airport; onTraffic(flights: Flight[]): void; onTrack(flight: Flight): void;
}) {
  const { flights, error } = useFlights(true, () => airport, TRAFFIC_RANGE_NM);
  const [now, setNow] = useState(Date.now);
  const [filter, setFilter] = useState<Movement | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const traffic = useMemo(() => airportTraffic(airport, flights ?? [], now), [airport, flights, now]);
  useEffect(() => { onTraffic(traffic.map((t) => t.flight)); }, [traffic, onTraffic]);
  const visible = filter ? traffic.filter((t) => t.movement === filter) : traffic;
  const loading = flights === null && !error;

  return <section className="mt-3 border-t border-subtle pt-3" aria-label="Airport traffic">
    <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wide">
      <h3 className="text-primary">Traffic radar · {TRAFFIC_RANGE_NM} nm</h3>
      <span role="status" className={error ? 'text-flight' : 'text-live'}>{loading ? 'Connecting' : error ? 'Feed unavailable' : 'Live · 10s'}</span>
    </div>
    <div className="mt-2 flex items-center gap-3">
      <svg viewBox="-110 -110 220 220" className="h-28 w-28 shrink-0 rounded-full bg-void" role="img" aria-label={`${traffic.length} aircraft near ${airport.name}`}>
        <circle r="94" fill="none" stroke="#29313F" /><circle r="47" fill="none" stroke="#29313F" strokeDasharray="3 4" />
        <path d="M-94 0H94M0-94V94" stroke="#181D27" />
        <text y="-98" fill="#8B94A7" textAnchor="middle" fontSize="11">N</text>
        <circle r="5" fill="#4DE1FF" />
        {traffic.map(({ flight, x, y, movement }) => <path key={flight.hex}
          d="M0-6 4 5 0 3-4 5Z" fill={COLORS[movement]}
          transform={`translate(${Math.max(-94, Math.min(94, x * 94))} ${Math.max(-94, Math.min(94, y * 94))}) rotate(${flight.track})`} />)}
      </svg>
      <div className="flex-1 text-xs text-secondary">
        <div className="font-mono text-2xl text-primary" aria-live="polite">{traffic.length}</div>
        <p>aircraft nearby</p>
        <p className="mt-2 text-[10px] leading-4">Direction relative to this airport. Flight destinations are unknown.</p>
      </div>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-1" role="group" aria-label="Filter airport traffic">
      {([null, 'Toward airport', 'Away from airport', 'Ground nearby'] as const).map((value) => <button
        key={value ?? 'all'} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
        className={`min-h-9 rounded-[2px] border px-2 text-left text-[10px] ${filter === value ? 'border-accent-muted bg-accent-glow text-accent' : 'border-subtle text-secondary hover:bg-hover'}`}>
        {value ?? 'All traffic'} <span className="float-right font-mono">{value ? traffic.filter((t) => t.movement === value).length : traffic.length}</span>
      </button>)}
    </div>
    <div className="mt-2 max-h-40 overflow-y-auto overscroll-contain">
      {visible.map(({ flight, nm, movement }) => <button key={flight.hex} type="button"
        onClick={() => onTrack(flight)} aria-label={`Track ${flight.callsign}`}
        className="flex min-h-12 w-full items-center gap-2 border-b border-subtle px-1 text-left hover:bg-hover">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: COLORS[movement] }} />
        <span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs text-primary">{flight.callsign} <span className="text-[10px] text-tertiary">{flight.type}</span></span>
          <span className="block text-[10px] text-secondary">{movement} · {nm.toFixed(1)} nm</span></span>
        <span className="text-right font-mono text-[10px] text-secondary">{formatAlt(flight)}<br />{Math.round(flight.gs)} kt</span>
      </button>)}
      {!visible.length && <p className="py-3 text-xs leading-5 text-secondary">{loading ? 'Looking for live aircraft…' : error ? 'The live feed is unavailable. Retrying automatically.' : 'No recent aircraft signals in this view.'}</p>}
    </div>
    <p className="mt-2 text-[10px] text-tertiary">Select a flight to open its cockpit. Signals older than 90s are hidden.</p>
  </section>;
}
