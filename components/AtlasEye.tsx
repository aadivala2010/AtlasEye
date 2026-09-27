'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Catalog, Stream } from '@/lib/stream';
import { byDistanceFrom } from '@/lib/geo';
import { project, useFlights, type Flight } from '@/lib/flights';
import { useReadout } from '@/lib/readout';
import GlobeView, { type Camera, type GlobeHandle } from './globe/GlobeView';
import Header, { type Layer, type Layers } from './chrome/Header';
import StatusBar from './chrome/StatusBar';
import type { SearchHandle } from './chrome/Search';
import StreamPanel from './stream/StreamPanel';
import type { PlayerHandle } from './stream/Player';
import FlightPanel from './flight/FlightPanel';
import DossierPanel from './dossier/DossierPanel';

/** What the side panel shows when it isn't a stream (streams keep their own id for the URL). */
type Focus = { kind: 'flight'; flight: Flight } | { kind: 'dossier'; lat: number; lon: number };

interface Boot {
  camera: Camera | null;
  selectId: string | null;
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
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let intro = !reducedMotion && !selectId;
  try {
    if (sessionStorage.getItem('atlas-eye:intro')) intro = false;
    sessionStorage.setItem('atlas-eye:intro', '1');
  } catch { /* storage blocked: play it, it's harmless */ }
  return { camera, selectId, reducedMotion, rotate: !reducedMotion && !camera && !selectId, intro };
}

const SHEET_PEEK = 0.6;
const SHEET_FULL = 0.92;

export default function AtlasEye({ starfield }: { starfield: ReactNode }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [layers, setLayers] = useState<Layers>({ cameras: true, flights: false, dossier: false, clouds: false });
  const [other, setOther] = useState<Focus | null>(null);
  const [snapshots, setSnapshots] = useState(true);
  const [terminator, setTerminator] = useState(true);
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
    const c = camera.current;
    if (c) params.set('c', `${c.lon.toFixed(4)},${c.lat.toFixed(4)},${c.zoom.toFixed(2)}`);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [selectedId]);
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
        Escape: close,
        f: () => player.current?.fullscreen(),
        m: () => setMuted((m) => !m),
      };
      const action = actions[key];
      if (!action) return;
      e.preventDefault();
      globe.current?.stopRotation();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [random, step, close]);

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
  const bottomInset = panelOpen && isMobile ? Math.round(sheet * viewportH) : 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <Header
        streams={streams ?? []}
        searchRef={search}
        layers={layers}
        counts={{ cameras: streams?.length ?? null, flights: layers.flights ? (flightError && !flights ? null : flights?.length ?? null) : null }}
        onToggleLayer={(l: Layer) => setLayers((prev) => ({ ...prev, [l]: !prev[l] }))}
        snapshots={snapshots}
        snapshotCount={catalog?.streams.filter((s) => s.kind === 'snapshot').length ?? 0}
        onToggleSnapshots={() => setSnapshots((v) => !v)}
        terminator={terminator}
        onToggleTerminator={() => setTerminator((v) => !v)}
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
              focus={selected ? { lat: selected.latitude, lon: selected.longitude } : other?.kind === 'dossier' ? other : null}
              flights={layers.flights || tracked ? flights : null}
              flightId={tracked?.hex ?? null}
              dossier={layers.dossier}
              initialCamera={boot.camera}
              reducedMotion={boot.reducedMotion}
              rotate={boot.rotate}
              intro={boot.intro}
              bottomInset={bottomInset}
              terminator={terminator}
              clouds={layers.clouds}
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
          {layers.flights && <FlightNotice error={flightError} count={flights?.length ?? null} />}
          {error && <CatalogError message={error} onRetry={() => setAttempt((a) => a + 1)} />}
        </section>

        {panelOpen && (
          <aside
            aria-label={other?.kind === 'flight' ? 'Flight' : other?.kind === 'dossier' ? 'Dossier' : 'Stream'}
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
              ) : other?.kind === 'dossier' ? (
                <DossierPanel
                  key={`${other.lat},${other.lon}`}
                  lat={other.lat}
                  lon={other.lon}
                  streams={streams ?? []}
                  onPickStream={(s) => select(s, 'near')}
                  onPickFlight={openFlight}
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
              />
              )}
            </div>
          </aside>
        )}
      </main>

      <StatusBar total={catalog?.count ?? null} builtAt={catalog?.builtAt ?? null} loading={!catalog && !error} />
    </div>
  );
}

/** What the flights layer is showing, and when it's failing. */
function FlightNotice({ error, count }: { error: boolean; count: number | null }) {
  const { zoom } = useReadout();
  const text = error ? 'FLIGHT FEED BUSY — RETRYING'
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
