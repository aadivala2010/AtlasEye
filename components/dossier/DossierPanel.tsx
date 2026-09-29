'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Stream } from '@/lib/stream';
import { distanceKm, formatCoord, formatDistance } from '@/lib/geo';
import { formatAlt, project, useFlights, type Flight } from '@/lib/flights';
import { moonPhase, subsolarPoint, sunAltitude } from '@/lib/solar';
import { ISS, elevation, nextPass, positions, type Sat } from '@/lib/satellites';
import { nearestStations, type Station } from '@/lib/radio';
import { parseQuakes, type Quake } from '@/lib/events';
import Clocks from '@/components/stream/Clocks';
import { IconButton, Row } from '@/components/stream/StreamPanel';
import { IconClose } from '@/components/chrome/icons';

interface Props {
  lat: number;
  lon: number;
  streams: Stream[];
  /** Everything in orbit, for "overhead now" (null while loading). */
  sats: Sat[] | null;
  /** Radio stations, for the local ones (null while loading). */
  stations: Station[] | null;
  onPickStream(s: Stream): void;
  onPickFlight(f: Flight): void;
  onPickSat(id: number): void;
  onPlay(s: Station): void;
  onClose(): void;
}

interface Weather {
  elevation: number;
  timezone: string;
  current: { temperature_2m: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number; cloud_cover: number; visibility: number };
  daily?: { sunrise: string[]; sunset: string[] };
}
interface Air { current: { us_aqi: number | null; pm2_5: number | null; pm10: number | null; ozone: number | null } }
interface Sea { current: { wave_height: number | null; wave_direction: number | null; wave_period: number | null; sea_surface_temperature: number | null } }
interface Wiki { query?: { pages: Record<string, { pageid: number; title: string; index: number; description?: string; thumbnail?: { source: string }; coordinates?: { lat: number; lon: number }[] }> } }
interface Pano { features: { id: string; assets: { thumb?: { href: string }; hd?: { href: string } }; properties: { datetime?: string } }[] }

/** WMO weather interpretation codes, coarsened. */
const sky = (c: number) =>
  c === 0 ? 'clear' : c <= 3 ? 'partly cloudy' : c <= 48 ? 'fog' : c <= 57 ? 'drizzle' : c <= 67 ? 'rain'
    : c <= 77 ? 'snow' : c <= 82 ? 'showers' : c <= 86 ? 'snow showers' : 'thunderstorm';

/** US AQI bands. */
const aqi = (v: number) => (v <= 50 ? 'good' : v <= 100 ? 'moderate' : v <= 150 ? 'unhealthy for some' : v <= 200 ? 'unhealthy' : v <= 300 ? 'very unhealthy' : 'hazardous');

const RADIUS_NM = 40;

/** GET some JSON once; null until it arrives, `error` if it didn't. */
function useJson<T>(url: string | null): { data: T | null; error: boolean } {
  const [state, setState] = useState<{ data: T | null; error: boolean }>({ data: null, error: false });
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => setState({ data, error: false }))
      .catch(() => { if (!ctrl.signal.aborted) setState({ data: null, error: true }); });
    return () => ctrl.abort();
  }, [url]);
  return state;
}

/**
 * Everything knowable about one point on Earth: time, sun and moon, weather, air and sea, what's
 * there (Wikipedia, street-level photos, cameras, radio), what's above it (aircraft, satellites)
 * and what's shaken it lately.
 */
export default function DossierPanel({ lat, lon, streams, sats, stations, onPickStream, onPickFlight, onPickSat, onPlay, onClose }: Props) {
  const ll = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
  const { data: wx, error: wxError } = useJson<Weather>(
    `https://api.open-meteo.com/v1/forecast?${ll}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,visibility`
      + '&daily=sunrise,sunset&timezone=auto&forecast_days=1',
  );
  const { data: air } = useJson<Air>(`https://air-quality-api.open-meteo.com/v1/air-quality?${ll}&current=us_aqi,pm2_5,pm10,ozone`);
  const { data: sea } = useJson<Sea>(`https://marine-api.open-meteo.com/v1/marine?${ll}&current=wave_height,wave_direction,wave_period,sea_surface_temperature`);
  const { data: wiki } = useJson<Wiki>(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${lat.toFixed(5)}|${lon.toFixed(5)}`
      + '&ggsradius=10000&ggslimit=6&prop=coordinates|pageimages|description&piprop=thumbnail&pithumbsize=96&pilimit=6',
  );
  const d = 0.006; // ~600 m either way
  const { data: pano } = useJson<Pano>(`https://api.panoramax.xyz/api/search?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&limit=4`);
  const [since] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const { data: shaken } = useJson<Parameters<typeof parseQuakes>[0]>(
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&${ll}&maxradiuskm=300&starttime=${since}&minmagnitude=2&orderby=magnitude&limit=5`,
  );
  const quakes: Quake[] = shaken ? parseQuakes(shaken) : [];

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
  const radio = useMemo(() => (stations ? nearestStations(stations, lat, lon, 4, 150) : null), [stations, lat, lon]);

  // Satellites above 10° right now, stations first; re-read every 10 s. And when the ISS next comes over.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  const overhead = useMemo(() => {
    if (!sats) return null;
    const pos = positions(sats, new Date());
    const up: { s: Sat; el: number }[] = [];
    for (let i = 0; i < sats.length; i++) {
      if (Number.isNaN(pos[3 * i])) continue;
      const el = elevation(lat, lon, { lat: pos[3 * i], lon: pos[3 * i + 1], alt: pos[3 * i + 2] });
      if (el >= 10) up.push({ s: sats[i], el });
    }
    return up.sort((a, b) => Number(b.s.group === 'station') - Number(a.s.group === 'station') || b.el - a.el);
    // `tick` re-reads the sky every 10 s.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sats, lat, lon, tick]);
  const issPass = useMemo(() => {
    const iss = sats?.find((s) => s.id === ISS);
    return iss ? nextPass(iss, lat, lon, new Date()) : null;
  }, [sats, lat, lon]);

  const nearest = cameras[0];
  // Timezone: Open-Meteo's for the point; until it answers, the nearest camera's, or the nautical zone.
  const zone = wx?.timezone ?? (nearest && nearest.d < 500 ? nearest.s.timezone : nauticalZone(lon));
  const sunAlt = sunAltitude(lat, lon, subsolarPoint(new Date()));
  const moon = moonPhase(new Date());
  const rise = wx?.daily?.sunrise[0]?.slice(11, 16);
  const set = wx?.daily?.sunset[0]?.slice(11, 16);
  const a = air?.current;
  const s = sea?.current;
  const pages = wiki?.query ? Object.values(wiki.query.pages).sort((x, y) => x.index - y.index) : null;

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
            {pages?.[0] && distanceOf(pages[0], lat, lon) < 2 ? pages[0].title : nearest && nearest.d < 150 ? `Near ${nearest.s.place}` : 'Remote location'}
          </h2>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary">{zone}</div>
        </div>

        <div className="px-4 pt-4"><Clocks stream={{ timezone: zone, latitude: lat, longitude: lon }} /></div>

        <dl className="mx-4 mt-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-t border-subtle pt-3">
          <Row label="Coords">{formatCoord(lat, lon)}</Row>
          <Row label="Sun">
            {sunAlt.toFixed(1)}° {sunAlt > -0.833 ? 'up' : 'down'}
            {rise && set ? ` · rises ${rise} · sets ${set}` : wx && ` · ${sunAlt > 0 ? 'no sunset today' : 'no sunrise today'}`}
          </Row>
          <Row label="Moon">{moon.name} · {Math.round(moon.lit * 100)}% lit</Row>
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
          {a?.us_aqi != null && (
            <Row label="Air">AQI {a.us_aqi} {aqi(a.us_aqi)}{a.pm2_5 != null ? ` · PM2.5 ${Math.round(a.pm2_5)} µg/m³` : ''}</Row>
          )}
          {s?.wave_height != null && (
            <Row label="Sea">
              {s.wave_height.toFixed(1)} m waves{s.wave_period != null ? ` every ${Math.round(s.wave_period)} s` : ''}
              {s.sea_surface_temperature != null ? ` · ${Math.round(s.sea_surface_temperature)}°C water` : ''}
            </Row>
          )}
          <Row label="Sources">Open-Meteo · USGS · Wikipedia · CelesTrak</Row>
        </dl>

        {!!pano?.features.length && (
          <Section title="Street level" count={null}>
            <li className="grid grid-cols-4 gap-1 px-1.5 py-1">
              {pano.features.map((p) => p.assets.thumb && (
                <a key={p.id} href={p.assets.hd?.href ?? p.assets.thumb.href} target="_blank" rel="noopener noreferrer"
                  title={`Panoramax photo${p.properties.datetime ? `, ${p.properties.datetime.slice(0, 10)}` : ''}`}
                  className="block aspect-[4/3] overflow-hidden rounded-[2px] border border-subtle hover:border-accent-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnails from the Panoramax federation */}
                  <img src={p.assets.thumb.href} alt="Street-level photo nearby" loading="lazy" className="h-full w-full object-cover" />
                </a>
              ))}
            </li>
          </Section>
        )}

        {!!pages?.length && (
          <Section title="What's here" count={null}>
            {pages.slice(0, 5).map((p) => (
              <li key={p.pageid}>
                <a
                  href={`https://en.wikipedia.org/?curid=${p.pageid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-[2px] px-1.5 py-1 transition-colors duration-200 ease-atlas hover:bg-hover"
                >
                  {p.thumbnail
                    // eslint-disable-next-line @next/next/no-img-element -- Wikimedia thumbnail
                    ? <img src={p.thumbnail.source} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-[2px] object-cover" />
                    : <span className="h-8 w-8 shrink-0 rounded-[2px] border border-subtle" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-primary">{p.title}</span>
                    <span className="block truncate font-mono text-[10px] text-tertiary">{p.description ?? 'Wikipedia'}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-tertiary">{formatDistance(distanceOf(p, lat, lon))}</span>
                </a>
              </li>
            ))}
          </Section>
        )}

        <Section title="Nearest cameras" count={null}>
          {cameras.length === 0 ? <Empty>camera layer is off</Empty> : cameras.map(({ s: c, d: km }) => (
            <Item key={c.id} onClick={() => onPickStream(c)} right={formatDistance(km)}>
              <span className="text-primary">{c.name}</span>
              <span className="text-tertiary"> · {c.category}</span>
            </Item>
          ))}
        </Section>

        <Section title={`Aircraft within ${Math.round(RADIUS_NM * 1.852)} km`} count={flights ? flights.length : null}>
          {flightError && !flights ? <Empty>flight feed unavailable</Empty>
            : !flights ? <Empty><span className="ellipsis">scanning</span></Empty>
            : aircraft.length === 0 ? <Empty>no aircraft</Empty>
            : aircraft.map(({ f, d: km }) => (
              <Item key={f.hex} onClick={() => onPickFlight(f)} right={formatDistance(km)}>
                <span className="text-primary">{f.callsign}</span>
                <span className="text-tertiary"> · {f.type ?? '—'} · {formatAlt(f)}</span>
              </Item>
            ))}
        </Section>

        <Section title="Overhead now" count={overhead ? overhead.length : null}>
          {!overhead ? <Empty><span className="ellipsis">computing orbits</span></Empty>
            : overhead.length === 0 ? <Empty>nothing above 10°</Empty>
            : overhead.slice(0, 6).map(({ s: sat, el }) => (
              <Item key={sat.id} onClick={() => onPickSat(sat.id)} right={`${Math.round(el)}° up`}>
                <span className="text-primary">{sat.name}</span>
              </Item>
            ))}
          {issPass && (
            <Empty>next ISS pass {issPass.start.toTimeString().slice(0, 5)} your time, up to {Math.round(issPass.maxEl)}°</Empty>
          )}
        </Section>

        {quakes.length > 0 && (
          <Section title="Quakes within 300 km, 30 days" count={null}>
            {quakes.map((q) => (
              <li key={q.id}>
                <a href={q.url} target="_blank" rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 rounded-[2px] px-1.5 py-1 font-mono text-[11px] transition-colors duration-200 ease-atlas hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate"><span className="text-primary">M{q.mag.toFixed(1)}</span><span className="text-tertiary"> · {q.place}</span></span>
                  <span className="shrink-0 text-tertiary">{new Date(q.at).toISOString().slice(5, 10)}</span>
                </a>
              </li>
            ))}
          </Section>
        )}

        <Section title="Local radio" count={null}>
          {!radio ? <Empty><span className="ellipsis">tuning</span></Empty>
            : radio.length === 0 ? <Empty>no station within 150 km</Empty>
            : radio.map(({ s: st, d: km }) => (
              <Item key={st.id} onClick={() => onPlay(st)} right={formatDistance(km)}>
                <span className="text-primary">{st.name}</span>
                {st.tags && <span className="text-tertiary"> · {st.tags}</span>}
              </Item>
            ))}
        </Section>
      </div>
    </div>
  );
}

const distanceOf = (p: { coordinates?: { lat: number; lon: number }[] }, lat: number, lon: number) =>
  p.coordinates?.[0] ? distanceKm(lat, lon, p.coordinates[0].lat, p.coordinates[0].lon) : Infinity;

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
