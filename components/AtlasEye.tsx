'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Catalog, Stream } from '@/lib/stream';
import { byDistanceFrom } from '@/lib/geo';
import { project, useFlights, type Flight } from '@/lib/flights';
import { useReadout } from '@/lib/readout';
import { SKY_DEFAULT, type Sky } from '@/lib/sky';
import { pulseItems, useNotify, usePlanet, type PulseItem } from '@/lib/events';
import { subpoint, useSatellites } from '@/lib/satellites';
import { nearestStations, useRadio, type Station } from '@/lib/radio';
import GlobeView, { type Camera, type GlobeHandle } from './globe/GlobeView';
import Header, { type Layer, type Layers, type Tool } from './chrome/Header';
import StatusBar from './chrome/StatusBar';
import TimeBar, { TIME_MIN } from './chrome/TimeBar';
import type { SearchHandle } from './chrome/Search';
import StreamPanel from './stream/StreamPanel';
import type { PlayerHandle } from './stream/Player';
import FlightPanel from './flight/FlightPanel';
import DossierPanel from './dossier/DossierPanel';
import PulsePanel from './pulse/PulsePanel';
import SatellitePanel from './satellite/SatellitePanel';
import RadioBar from './radio/RadioBar';
import Wall from './wall/Wall';

/** What the side panel shows when it isn't a stream (streams keep their own id for the URL). */
type Focus =
  | { kind: 'flight'; flight: Flight }
  | { kind: 'dossier'; lat: number; lon: number }
  /** The Pulse list; `at` is the item last flown to. */
  | { kind: 'pulse'; at?: { lat: number; lon: number } }
  | { kind: 'satellite'; id: number };

interface Boot {
  camera: Camera | null;
  selectId: string | null;
  /** A shared moment in the time machine. */
  time: number | null;
  reducedMotion: boolean;
  rotate: boolean;
  intro: boolean;
}

/** Read the shared-link state and motion preferences once, on the client. */
function readBoot(): Boot {
  const params = new URLSearchParams(window.location.search);
  const [lon, lat, zoom] = (params.get('c') ?? '').split(',').map(Number);
  const camera = [lon, lat, zoom].every(Number.isFinite) && Math.abs(lat) <= 90 ? { lon, lat, zoom } : null;
  const selectId = params.get('s');
  const t = Date.parse(params.get('t') ?? '');
  const time = Number.isFinite(t) && t >= TIME_MIN && t < Date.now() ? t : null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let intro = !reducedMotion && !selectId;
  try {
    if (sessionStorage.getItem('atlas-eye:intro')) intro = false;
    sessionStorage.setItem('atlas-eye:intro', '1');
  } catch { /* storage blocked: play it, it's harmless */ }
  return { camera, selectId, time, reducedMotion, rotate: !reducedMotion && !camera && !selectId, intro };
}

const SHEET_PEEK = 0.6;
const SHEET_FULL = 0.92;

export default function AtlasEye({ starfield }: { starfield: ReactNode }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [layers, setLayers] = useState<Layers>({ cameras: true, flights: false, satellites: false, events: true, radio: false, dossier: false });
  const [other, setOther] = useState<Focus | null>(null);
  const [snapshots, setSnapshots] = useState(true);
  const [sky, setSky] = useState<Sky>(SKY_DEFAULT);
  const [notify, setNotify] = useState(false);
  const [follow, setFollow] = useState(false);
  /** The time machine's moment; null = live. */
  const [time, setTime] = useState<number | null>(null);
  const [wall, setWall] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [sheet, setSheet] = useState(SHEET_PEEK);
  const [viewportH, setViewportH] = useState(800);

  const globe = useRef<GlobeHandle>(null);
  const search = useRef<SearchHandle>(null);
  const player = useRef<PlayerHandle>(null);
  const camera = useRef<Camera | null>(null);
  /** ←/→ walk outward from an anchor stream through its nearest neighbours. */
  const walk = useRef<{ list: Stream[]; i: number } | null>(null);

  useEffect(() => {
    const b = readBoot();
    camera.current = b.camera; // so the first URL write keeps a shared link's camera
    setBoot(b);
    setTime(b.time);
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => { setIsMobile(mq.matches); setViewportH(window.innerHeight); };
    sync();
    mq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => { mq.removeEventListener('change', sync); window.removeEventListener('resize', sync); };
  }, []);

  // ── catalog ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetch('/data/streams.json', { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching /data/streams.json`);
        return r.json() as Promise<Catalog>;
      })
      .then((c) => {
        if (!Array.isArray(c.streams) || c.streams.length === 0) throw new Error('Catalog is empty or malformed');
        setCatalog(c);
      })
      .catch((e: unknown) => { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e)); });
    return () => ctrl.abort();
  }, [attempt]);

  const streams = useMemo(
    () => catalog ? (layers.cameras ? catalog.streams.filter((s) => snapshots || s.kind !== 'snapshot') : []) : null,
    [catalog, layers.cameras, snapshots],
  );
  const selected = useMemo(() => catalog?.streams.find((s) => s.id === selectedId) ?? null, [catalog, selectedId]);

  // ── flights: airliners worldwide; plus a 5 nm live poll around the aircraft in the cockpit, so it
  // updates every 10 s. (A wide live circle around the view would draw a visible disc of extra aircraft.)
  const tracked = other?.kind === 'flight' ? other.flight : null;
  const { flights, error: flightError } = useFlights(layers.flights || !!tracked, () =>
    tracked ? project(tracked, Date.now()) : null, 5, true);
  const liveTracked = tracked ? flights?.find((f) => f.hex === tracked.hex) : undefined;
  // Remember the latest fix, so the panel keeps the aircraft if it drops out of a poll.
  useEffect(() => {
    if (liveTracked) setOther((o) => (o?.kind === 'flight' && o.flight.hex === liveTracked.hex ? { kind: 'flight', flight: liveTracked } : o));
  }, [liveTracked]);

  // ── the planet: events on the globe, and the Pulse built from them ─────────
  const pulseOpen = other?.kind === 'pulse';
  const planet = usePlanet(layers.events || pulseOpen || notify, time);
  const pulse = useMemo(() => pulseItems(planet, time ?? Date.now()), [planet, time]);
  useNotify(pulse, notify);

  // ── orbit: loaded for the layer, an open satellite, or a dossier's "overhead now" ──
  const satId = other?.kind === 'satellite' ? other.id : null;
  const sats = useSatellites(layers.satellites || satId !== null || other?.kind === 'dossier');
  const openSat = sats && satId !== null ? sats.find((x) => x.id === satId) ?? null : null;

  // ── radio: the layer, a camera's local station, the dossier's list ─────────
  const [station, setStation] = useState<Station | null>(null);
  const [radioWanted, setRadioWanted] = useState(false);
  const stations = useRadio(layers.radio || radioWanted || other?.kind === 'dossier');
  const pendingTune = useRef<{ lat: number; lon: number } | null>(null);
  /** The nearest station to a point (within 400 km if there is one); `skip` moves on from the one playing. */
  const tune = useCallback((lat: number, lon: number, skip?: string) => {
    if (!stations) { pendingTune.current = { lat, lon }; setRadioWanted(true); return; }
    const near = nearestStations(stations, lat, lon, 8, 400).filter((x) => x.s.id !== skip);
    const pick = skip ? near[Math.floor(Math.random() * near.length)] : near[0];
    setStation((pick ?? nearestStations(stations, lat, lon, 2).find((x) => x.s.id !== skip))?.s ?? null);
  }, [stations]);
  useEffect(() => {
    const p = pendingTune.current;
    if (stations && p) { pendingTune.current = null; tune(p.lat, p.lon); }
  }, [stations, tune]);

  // ── selection ──────────────────────────────────────────────────────────────
  const select = useCallback((s: Stream, mode: 'near' | 'travel', keepWalk = false) => {
    if (!keepWalk) walk.current = null;
    setOther(null);
    setSelectedId(s.id);
    globe.current?.flyToStream(s, mode);
  }, []);

  const random = useCallback(() => {
    if (!streams?.length) return;
    // Weighted toward hand-placed and confidently placed YouTube streams (the most interesting and
    // best named), then live agency video; snapshots only occasionally. With ~60k cameras this lands
    // roughly 2/3 YouTube, 1/4 live road video, <1/10 stills.
    const pool = streams.filter((s) => s.id !== selectedId);
    const kindWeight = { youtube: 1, hls: 0.05, mjpeg: 0.05, snapshot: 0.006 } as const;
    const weights = pool.map((s) => kindWeight[s.kind] * s.confidence ** 2 * (s.geocode === 'override' ? 3 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    const pick = pool.find((_, i) => (r -= weights[i]) <= 0) ?? pool[pool.length - 1];
    if (pick) select(pick, 'travel');
  }, [streams, selectedId, select]);

  const step = useCallback((dir: 1 | -1) => {
    if (!selected || !streams?.length) return;
    if (!walk.current || walk.current.list[walk.current.i]?.id !== selected.id) {
      walk.current = { list: byDistanceFrom(selected, streams.some((s) => s.id === selected.id) ? streams : [selected, ...streams]), i: 0 };
    }
    const w = walk.current;
    const i = Math.max(0, Math.min(w.list.length - 1, w.i + dir));
    if (i === w.i) return;
    w.i = i;
    select(w.list[i], 'near', true);
  }, [selected, streams, select]);

  const close = useCallback(() => { setSelectedId(null); setOther(null); walk.current = null; setSheet(SHEET_PEEK); }, []);

  const openFlight = useCallback((f: Flight) => {
    setSelectedId(null);
    walk.current = null;
    setOther({ kind: 'flight', flight: f });
    const p = project(f, Date.now());
    globe.current?.flyTo(p.lon, p.lat, 'near');
  }, []);
  const openDossier = useCallback((lat: number, lon: number) => {
    setSelectedId(null);
    walk.current = null;
    setOther({ kind: 'dossier', lat, lon });
  }, []);
  const openSatellite = useCallback((id: number) => {
    setSelectedId(null);
    walk.current = null;
    setOther({ kind: 'satellite', id });
    setFollow(true);
  }, []);
  const toggleTime = useCallback(() => {
    // Opening lands three hours back: press play and the weather replays up to now.
    setTime((t) => (t === null ? Math.floor((Date.now() - 3 * 3600_000) / 600_000) * 600_000 : null));
  }, []);
  const togglePulse = useCallback(() => {
    setSelectedId(null);
    walk.current = null;
    setOther((o) => (o?.kind === 'pulse' ? null : { kind: 'pulse' }));
  }, []);
  const pickPulse = useCallback((it: PulseItem) => {
    setOther({ kind: 'pulse', at: { lat: it.lat, lon: it.lon } });
    globe.current?.flyTo(it.lon, it.lat, 'travel');
  }, []);
  const openPulse = useCallback((it: PulseItem) => {
    const f = it.hex ? planet.emergencies?.find((x) => x.hex === it.hex) : undefined;
    if (f) { openFlight(f); return; }
    globe.current?.flyTo(it.lon, it.lat, 'travel');
    openDossier(it.lat, it.lon);
  }, [planet, openFlight, openDossier]);

  // Shared link: once the catalog arrives, open the stream it names.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !catalog || !boot) return;
    restored.current = true;
    const s = boot.selectId ? catalog.streams.find((x) => x.id === boot.selectId) : undefined;
    if (!s) return;
    setSelectedId(s.id);
    if (!boot.camera) globe.current?.flyToStream(s, 'near');
  }, [catalog, boot]);

  // ── URL always reflects the selected stream and camera ─────────────────────
  const writeUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedId) params.set('s', selectedId);
    if (time !== null) params.set('t', new Date(time).toISOString().slice(0, 16) + 'Z');
    const c = camera.current;
    if (c) params.set('c', `${c.lon.toFixed(4)},${c.lat.toFixed(4)},${c.zoom.toFixed(2)}`);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [selectedId, time]);
  useEffect(() => { if (restored.current) writeUrl(); }, [writeUrl]);
  const onCamera = useCallback((c: Camera) => { camera.current = c; writeUrl(); }, [writeUrl]);

  // ── keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const actions: Record<string, () => void> = {
        '/': () => search.current?.focus(),
        r: random,
        ArrowRight: () => step(1),
        ArrowLeft: () => step(-1),
        Escape: () => (wall ? setWall(false) : close()),
        f: () => player.current?.fullscreen(),
        m: () => setMuted((m) => !m),
        p: togglePulse,
        t: toggleTime,
        w: () => setWall((v) => !v),
      };
      const action = actions[key];
      if (!action) return;
      e.preventDefault();
      globe.current?.stopRotation();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [random, step, close, togglePulse, toggleTime, wall]);

  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => setUserPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => undefined,
    { maximumAge: 600_000, timeout: 15_000 },
  );

  // ── mobile bottom sheet drag ──────────────────────────────────────────────
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const sheetHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, h: sheet };
      setDragging(true);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) return;
      setSheet(Math.min(SHEET_FULL, Math.max(0.2, drag.current.h - (e.clientY - drag.current.y) / viewportH)));
    },
    onPointerUp: () => {
      if (!drag.current) return;
      const moved = Math.abs(sheet - drag.current.h) > 0.02;
      drag.current = null;
      setDragging(false);
      if (!moved) setSheet((h) => (h < SHEET_FULL ? SHEET_FULL : SHEET_PEEK)); // tap toggles
      else if (sheet < 0.38) close();
      else setSheet(sheet > 0.76 ? SHEET_FULL : SHEET_PEEK);
    },
  };

  const panelOpen = !!(selected && catalog) || !!other;
  const isLoaded = useCallback(() => globe.current?.loaded() ?? true, []);

  const tools: Tool[] = [
    { id: 'pulse', label: 'Pulse', key: 'P', title: 'What is happening on Earth right now', on: pulseOpen, count: pulse.filter((i) => i.level > 0).length },
    { id: 'time', label: 'Time', key: 'T', title: 'Time machine: scrub the planet back through time', on: time !== null },
    { id: 'wall', label: 'Wall', key: 'W', title: 'A wall of live cameras: in view, around the world, at sunrise or sunset', on: wall },
  ];
  const onTool = (id: string) => {
    globe.current?.stopRotation();
    if (id === 'pulse') togglePulse();
    if (id === 'time') toggleTime();
    if (id === 'wall') setWall((v) => !v);
  };
  const bottomInset = panelOpen && isMobile ? Math.round(sheet * viewportH) : 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <Header
        streams={streams ?? []}
        searchRef={search}
        layers={layers}
        counts={{
          cameras: streams?.length ?? null,
          flights: layers.flights ? (flightError && !flights ? null : flights?.length ?? null) : null,
          satellites: layers.satellites ? sats?.length ?? null : null,
          events: layers.events && planet.quakes ? planet.quakes.length + (planet.events?.length ?? 0) : null,
          radio: layers.radio ? stations?.length ?? null : null,
        }}
        onToggleLayer={(l: Layer) => setLayers((prev) => ({ ...prev, [l]: !prev[l] }))}
        snapshots={snapshots}
        snapshotCount={catalog?.streams.filter((s) => s.kind === 'snapshot').length ?? 0}
        onToggleSnapshots={() => setSnapshots((v) => !v)}
        sky={sky}
        onSky={setSky}
        tools={tools}
        onTool={onTool}
        onPick={(s) => select(s, 'travel')}
        onRandom={random}
      />

      <main className="relative flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 overflow-hidden" aria-label="Globe">
          {starfield}
          {boot && (
            <GlobeView
              ref={globe}
              streams={streams}
              focus={selected ? { lat: selected.latitude, lon: selected.longitude } : other?.kind === 'dossier' ? other : other?.kind === 'pulse' ? other.at ?? null : null}
              flights={(layers.flights || tracked) && time === null ? flights : null}
              flightId={tracked?.hex ?? null}
              dossier={layers.dossier}
              initialCamera={boot.camera}
              reducedMotion={boot.reducedMotion}
              rotate={boot.rotate}
              intro={boot.intro}
              bottomInset={bottomInset}
              sky={sky}
              time={time}
              planet={layers.events ? planet : null}
              sats={layers.satellites || satId !== null ? sats : null}
              satId={satId}
              follow={follow}
              onSatellite={openSatellite}
              onUnfollow={() => setFollow(false)}
              stations={layers.radio ? stations : null}
              radioId={station?.id ?? null}
              onRadio={(id) => setStation(stations?.find((s) => s.id === id) ?? null)}
              onSelect={(id) => {
                const s = catalog?.streams.find((x) => x.id === id);
                if (s) select(s, 'near');
              }}
              onFlight={(hex) => {
                const f = flights?.find((x) => x.hex === hex);
                if (f) openFlight(f);
              }}
              onDossier={openDossier}
              onCamera={onCamera}
            />
          )}
          {catalog && !error && <EmptyNotice />}
          {station && (
            <div className="pointer-events-none absolute top-3 left-3 z-20">
              <RadioBar station={station} onNext={() => tune(station.lat, station.lon, station.id)} onStop={() => setStation(null)} />
            </div>
          )}
          {layers.flights && <FlightNotice error={flightError} count={flights?.length ?? null} past={time !== null} />}
          {time !== null && (
            <div className="pointer-events-none absolute inset-x-3 z-20" style={{ bottom: 12 + bottomInset }}>
              <TimeBar time={time} onChange={setTime} onLive={() => setTime(null)} isLoaded={isLoaded} />
            </div>
          )}
          {error && <CatalogError message={error} onRetry={() => setAttempt((a) => a + 1)} />}
        </section>

        {panelOpen && (
          <aside
            aria-label={other ? { flight: 'Flight', dossier: 'Dossier', pulse: 'Pulse', satellite: 'Satellite' }[other.kind] : 'Stream'}
            style={isMobile ? { height: `${sheet * 100}dvh` } : undefined}
            className={`z-20 flex flex-col border-subtle bg-panel transition-[translate,opacity] duration-400 ease-atlas starting:opacity-0
              max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:rounded-t-[4px] max-lg:border-t max-lg:shadow-[0_-16px_40px_rgba(0,0,0,0.55)] max-lg:starting:translate-y-8
              lg:w-[440px] lg:shrink-0 lg:border-l lg:starting:translate-x-6 ${dragging ? '' : 'max-lg:transition-[height,translate,opacity]'}`}
          >
            <div
              {...sheetHandlers}
              className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center lg:hidden"
              aria-label="Drag to resize"
            >
              <span className="h-1 w-9 rounded-full bg-strong" />
            </div>
            <div className="min-h-0 flex-1">
              {other?.kind === 'flight' ? (
                <FlightPanel
                  flight={other.flight}
                  live={!!liveTracked}
                  onClose={close}
                  onLocate={() => { const p = project(other.flight, Date.now()); globe.current?.flyTo(p.lon, p.lat, 'near'); }}
                />
              ) : other?.kind === 'satellite' ? (
                openSat ? (
                  <SatellitePanel
                    sat={openSat}
                    time={time}
                    follow={follow}
                    muted={muted}
                    onFollow={setFollow}
                    onLocate={() => { const p = subpoint(openSat, new Date()); if (p) globe.current?.flyTo(p.lon, p.lat, 'near'); }}
                    onToggleMute={() => setMuted((m) => !m)}
                    onClose={close}
                  />
                ) : <div className="grid h-full place-items-center font-mono text-[11px] text-tertiary"><span className="ellipsis">loading orbits</span></div>
              ) : other?.kind === 'pulse' ? (
                <PulsePanel
                  items={pulse}
                  loading={!planet.quakes}
                  notify={notify}
                  onNotify={setNotify}
                  onPick={pickPulse}
                  onOpen={openPulse}
                  onClose={close}
                />
              ) : other?.kind === 'dossier' ? (
                <DossierPanel
                  key={`${other.lat},${other.lon}`}
                  lat={other.lat}
                  lon={other.lon}
                  streams={streams ?? []}
                  sats={sats}
                  stations={stations}
                  onPickStream={(s) => select(s, 'near')}
                  onPickFlight={openFlight}
                  onPickSat={openSatellite}
                  onPlay={setStation}
                  onClose={close}
                />
              ) : selected && catalog && (
              <StreamPanel
                stream={selected}
                builtAt={catalog.builtAt}
                muted={muted}
                userPos={userPos}
                playerRef={player}
                onClose={close}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                onRandom={random}
                onToggleMute={() => setMuted((m) => !m)}
                onFullscreen={() => player.current?.fullscreen()}
                onLocate={locate}
                onRadio={() => tune(selected.latitude, selected.longitude)}
              />
              )}
            </div>
          </aside>
        )}
      </main>

      {wall && catalog && (
        <Wall
          streams={streams ?? []}
          builtAt={catalog.builtAt}
          inView={() => globe.current?.visible(streams ?? []) ?? []}
          onOpen={(s) => { setWall(false); select(s, 'travel'); }}
          onClose={() => setWall(false)}
        />
      )}

      <StatusBar total={catalog?.count ?? null} builtAt={catalog?.builtAt ?? null} loading={!catalog && !error} />
    </div>
  );
}

/** What the flights layer is showing, and when it's failing. */
function FlightNotice({ error, count, past }: { error: boolean; count: number | null; past: boolean }) {
  const { zoom } = useReadout();
  const text = past ? 'FLIGHTS ARE LIVE ONLY — PRESS LIVE TO SEE THEM'
    : error ? 'FLIGHT FEED BUSY — RETRYING'
    : count === 0 ? 'NO AIRCRAFT REPORTED'
    : zoom < 4.5 ? 'AIRLINERS WORLDWIDE · UPDATED EACH MINUTE'
    : null;
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 text-center font-mono text-[10px] tracking-[0.08em] text-flight">
      {text}
    </div>
  );
}

function EmptyNotice() {
  const { inView } = useReadout();
  if (inView !== 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center font-mono text-[11px] tracking-[0.08em] text-tertiary">
      NO STREAMS IN VIEW — ZOOM OUT OR HIT RANDOM
    </div>
  );
}

function CatalogError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center p-4">
      <div role="alert" className="w-full max-w-sm rounded-[4px] border border-strong bg-panel p-4 font-mono">
        <div className="flex items-center gap-2 text-[11px] tracking-[0.08em] text-dead">
          <span className="h-1.5 w-1.5 rounded-full bg-dead" /> CATALOG FAILED TO LOAD
        </div>
        <p className="mt-3 text-[11px] leading-5 text-secondary">
          The globe is running, but the stream list could not be fetched.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-[2px] border border-subtle bg-void px-2 py-1.5 text-[10px] text-tertiary">{message}</pre>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-8 rounded-[2px] border border-accent-muted bg-accent-glow px-3 text-[11px] tracking-[0.08em] text-accent transition-colors duration-200 ease-atlas hover:bg-accent/20"
        >
          RETRY
        </button>
      </div>
    </div>
  );
}
