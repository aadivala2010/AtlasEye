'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Stream } from '@/lib/stream';
import { distanceKm, formatCoord, formatDistance } from '@/lib/geo';
import { formatAlt, project, useFlights, type Flight } from '@/lib/flights';
import { subsolarPoint, sunAltitude } from '@/lib/solar';
import Clocks from '@/components/stream/Clocks';
import { IconButton, Row } from '@/components/stream/StreamPanel';
import { IconClose } from '@/components/chrome/icons';

interface Props {
  lat: number;
  lon: number;
  streams: Stream[];
  onPickStream(s: Stream): void;
  onPickFlight(f: Flight): void;
  onClose(): void;
}

interface Weather {
  elevation: number;
  current: { temperature_2m: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number; cloud_cover: number; visibility: number };
}

/** WMO weather interpretation codes, coarsened. */
const sky = (c: number) =>
  c === 0 ? 'clear' : c <= 3 ? 'partly cloudy' : c <= 48 ? 'fog' : c <= 57 ? 'drizzle' : c <= 67 ? 'rain'
    : c <= 77 ? 'snow' : c <= 82 ? 'showers' : c <= 86 ? 'snow showers' : 'thunderstorm';

const RADIUS_NM = 40;

/** Everything we know about one point on Earth: time, sun, weather, aircraft overhead, nearby cameras. */
export default function DossierPanel({ lat, lon, streams, onPickStream, onPickFlight, onClose }: Props) {
  const [wx, setWx] = useState<Weather | null>(null);
  const [wxError, setWxError] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
        + '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,visibility',
      { signal: ctrl.signal },
    )
      .then((r) => (r.ok ? (r.json() as Promise<Weather>) : Promise.reject(new Error(String(r.status)))))
      .then(setWx)
      .catch(() => { if (!ctrl.signal.aborted) setWxError(true); });
    return () => ctrl.abort();
  }, [lat, lon]);

  const { flights, error: flightError } = useFlights(true, () => ({ lat, lon }), RADIUS_NM);
  const aircraft = useMemo(() => {
    const now = Date.now();
    return (flights ?? [])
      .map((f) => { const p = project(f, now); return { f, d: distanceKm(lat, lon, p.lat, p.lon) }; })
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
  }, [flights, lat, lon]);

  const cameras = useMemo(
    () => streams.map((s) => ({ s, d: distanceKm(lat, lon, s.latitude, s.longitude) })).sort((a, b) => a.d - b.d).slice(0, 6),
    [streams, lat, lon],
  );
  const nearest = cameras[0];
  // Timezone from the nearest catalogued place; out in the ocean, the nautical zone from longitude.
  const zone = nearest && nearest.d < 500 ? nearest.s.timezone : nauticalZone(lon);
  const sunAlt = sunAltitude(lat, lon, subsolarPoint(new Date()));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-subtle px-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Dossier
          <span className="text-tertiary">/ {formatCoord(lat, lon)}</span>
        </div>
        <IconButton label="Close panel (Esc)" onClick={onClose}><IconClose /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pt-4">
          <h2 className="text-[16px] leading-6 font-medium text-primary">
            {nearest && nearest.d < 150 ? `Near ${nearest.s.place}` : 'Remote location'}
          </h2>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary">{zone}</div>
        </div>

        <div className="px-4 pt-4"><Clocks stream={{ timezone: zone, latitude: lat, longitude: lon }} /></div>

        <dl className="mx-4 mt-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-t border-subtle pt-3">
          <Row label="Coords">{formatCoord(lat, lon)}</Row>
          <Row label="Sun">{sunAlt.toFixed(1)}° {sunAlt > -0.833 ? 'above' : 'below'} horizon</Row>
          {wx ? (
            <>
              <Row label="Elevation">{Math.round(wx.elevation).toLocaleString('en-US')} m</Row>
              <Row label="Weather">{Math.round(wx.current.temperature_2m)}°C · {sky(wx.current.weather_code)}</Row>
              <Row label="Wind">{Math.round(wx.current.wind_speed_10m)} km/h from {Math.round(wx.current.wind_direction_10m)}°</Row>
              <Row label="Cloud / vis">{wx.current.cloud_cover}% · {formatDistance(wx.current.visibility / 1000)}</Row>
            </>
          ) : (
            <Row label="Weather">{wxError ? 'unavailable' : <span className="ellipsis">loading</span>}</Row>
          )}
          <Row label="Sources">Open-Meteo · adsb.lol · catalog</Row>
        </dl>

        <Section title={`Aircraft within ${Math.round(RADIUS_NM * 1.852)} km`} count={flights ? flights.length : null}>
          {flightError && !flights ? <Empty>flight feed unavailable</Empty>
            : !flights ? <Empty><span className="ellipsis">scanning</span></Empty>
            : aircraft.length === 0 ? <Empty>no aircraft</Empty>
            : aircraft.map(({ f, d }) => (
              <Item key={f.hex} onClick={() => onPickFlight(f)} right={formatDistance(d)}>
                <span className="text-primary">{f.callsign}</span>
                <span className="text-tertiary"> · {f.type ?? '—'} · {formatAlt(f)}</span>
              </Item>
            ))}
        </Section>

        <Section title="Nearest cameras" count={null}>
          {cameras.length === 0 ? <Empty>camera layer is off</Empty> : cameras.map(({ s, d }) => (
            <Item key={s.id} onClick={() => onPickStream(s)} right={formatDistance(d)}>
              <span className="text-primary">{s.name}</span>
              <span className="text-tertiary"> · {s.category}</span>
            </Item>
          ))}
        </Section>
      </div>
    </div>
  );
}

/** Etc/GMT zones are sign-inverted: 30°E → UTC+2 → "Etc/GMT-2". */
function nauticalZone(lon: number): string {
  const n = Math.max(-12, Math.min(12, Math.round(lon / 15)));
  return n === 0 ? 'Etc/GMT' : `Etc/GMT${n > 0 ? '-' : '+'}${Math.abs(n)}`;
}

function Section({ title, count, children }: { title: string; count: number | null; children: ReactNode }) {
  return (
    <section className="mx-4 mt-4 border-t border-subtle pt-3 last:pb-4">
      <h3 className="label mb-1.5 flex justify-between"><span>{title}</span>{count !== null && <span>{count}</span>}</h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function Item({ onClick, right, children }: { onClick(): void; right: string; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-[2px] px-1.5 py-1 text-left font-mono text-[11px] transition-colors duration-200 ease-atlas hover:bg-hover"
      >
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <span className="shrink-0 text-tertiary">{right}</span>
      </button>
    </li>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <li className="px-1.5 py-1 font-mono text-[11px] text-tertiary">{children}</li>;
