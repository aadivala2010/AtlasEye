'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CATEGORIES, type Catalog, type Category, type Stream } from '@/lib/stream';
import { byDistanceFrom } from '@/lib/geo';
import { useReadout } from '@/lib/readout';
import GlobeView, { type Camera, type GlobeHandle } from './globe/GlobeView';
import Header from './chrome/Header';
import StatusBar from './chrome/StatusBar';
import type { SearchHandle } from './chrome/Search';
import StreamPanel from './stream/StreamPanel';
import type { PlayerHandle } from './stream/Player';

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
  const [enabled, setEnabled] = useState<Set<Category>>(() => new Set(CATEGORIES));
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

  const streams = useMemo(() => catalog?.streams.filter((s) => enabled.has(s.category)) ?? null, [catalog, enabled]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(CATEGORIES.map((k) => [k, 0])) as Record<Category, number>;
    for (const s of catalog?.streams ?? []) c[s.category]++;
    return c;
  }, [catalog]);
  const selected = useMemo(() => catalog?.streams.find((s) => s.id === selectedId) ?? null, [catalog, selectedId]);

  // ── selection ──────────────────────────────────────────────────────────────
  const select = useCallback((s: Stream, mode: 'near' | 'travel', keepWalk = false) => {
    if (!keepWalk) walk.current = null;
    setSelectedId(s.id);
    globe.current?.flyToStream(s, mode);
  }, []);

  const random = useCallback(() => {
    if (!streams?.length) return;
    // Weighted toward confident and hand-placed entries — those are the best-located, best-named streams.
    const pool = streams.filter((s) => s.id !== selectedId);
    const weights = pool.map((s) => s.confidence ** 2 * (s.geocode === 'override' ? 3 : 1));
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

  const close = useCallback(() => { setSelectedId(null); walk.current = null; setSheet(SHEET_PEEK); }, []);

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

  const bottomInset = selected && isMobile ? Math.round(sheet * viewportH) : 0;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      <Header
        streams={streams ?? []}
        counts={counts}
        enabled={enabled}
        searchRef={search}
        onToggle={(c) => setEnabled((prev) => {
          const next = new Set(prev);
          if (next.has(c)) next.delete(c); else next.add(c);
          return next;
        })}
        onReset={() => setEnabled(new Set(CATEGORIES))}
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
              selected={selected}
              initialCamera={boot.camera}
              reducedMotion={boot.reducedMotion}
              rotate={boot.rotate}
              intro={boot.intro}
              bottomInset={bottomInset}
              onSelect={(id) => {
                const s = catalog?.streams.find((x) => x.id === id);
                if (s) select(s, 'near');
              }}
              onCamera={onCamera}
            />
          )}
          {catalog && !error && <EmptyNotice />}
          {error && <CatalogError message={error} onRetry={() => setAttempt((a) => a + 1)} />}
        </section>

        {selected && catalog && (
          <aside
            aria-label="Stream"
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
            </div>
          </aside>
        )}
      </main>

      <StatusBar total={catalog?.count ?? null} builtAt={catalog?.builtAt ?? null} loading={!catalog && !error} />
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
