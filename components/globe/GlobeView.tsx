'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type {
  ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MLMap, Marker,
  StyleSpecification, VectorSourceSpecification,
} from 'maplibre-gl';
import type { Stream } from '@/lib/stream';
import { distanceKm } from '@/lib/geo';
import { nightBands, subsolarPoint, sunAltitude } from '@/lib/solar';
import { readout } from '@/lib/readout';

export interface Camera { lon: number; lat: number; zoom: number }
export interface GlobeHandle {
  /** `travel` arcs out and back in across the planet (random, search); `near` is a short glide. */
  flyToStream(stream: Stream, mode: 'near' | 'travel'): void;
  stopRotation(): void;
}

interface Props {
  ref?: Ref<GlobeHandle>;
  streams: Stream[] | null;
  selected: Stream | null;
  initialCamera: Camera | null;
  reducedMotion: boolean;
  /** Auto-rotate until first touch (off for shared links and reduced motion). */
  rotate: boolean;
  /** Play the once-per-session pin sweep. */
  intro: boolean;
  /** Pixels hidden under the mobile bottom sheet, so fly-to targets stay visible. */
  bottomInset: number;
  onSelect(id: string): void;
  onCamera(camera: Camera): void;
}

const BASE_STYLES = [
  'https://tiles.openfreemap.org/styles/dark',
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
];

const C = {
  void: '#040508', ocean: '#0A1A2E', raised: '#12161E', subtle: '#181D27', strong: '#29313F',
  tertiary: '#565E70', primary: '#E6EAF2', accent: '#4DE1FF', accentMuted: '#1B5567', accentGlow: 'rgba(77,225,255,0.15)',
  live: '#2BE88A', night: '#6C7BA8',
};

/** cubic-bezier(0.16, 1, 0.3, 1) — the --ease token, for MapLibre camera animations. */
function ease(t: number): number {
  const bez = (u: number, a: number, b: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = bez(u, 0.16, 0.3) - t;
    const dx = 3 * 0.16 * (1 - u) ** 2 + 6 * (0.3 - 0.16) * u * (1 - u) + 3 * (1 - 0.3) * u * u;
    if (Math.abs(x) < 1e-5 || dx === 0) break;
    u = Math.min(1, Math.max(0, u - x / dx));
  }
  return bez(u, 1, 1);
}

/** Zoom at which the whole globe fits the viewport with some space around it. */
function fitZoom(el: HTMLElement): number {
  const min = Math.min(el.clientWidth, el.clientHeight || 600);
  return Math.max(0.6, Math.log2((0.36 * min * 2 * Math.PI) / 512));
}

interface Base { source: VectorSourceSpecification; glyphs: string; font: string[] }

async function loadBase(): Promise<Base | null> {
  for (const url of BASE_STYLES) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const style = (await res.json()) as StyleSpecification;
      const source = Object.values(style.sources).find((s): s is VectorSourceSpecification => s.type === 'vector');
      const font = style.layers.map((l) => (l.type === 'symbol' ? l.layout?.['text-font'] : undefined))
        .find((f): f is string[] => Array.isArray(f) && f.every((x) => typeof x === 'string'));
      if (source && style.glyphs && font) return { source, glyphs: style.glyphs, font: [font[0]] };
    } catch { /* try the next style */ }
  }
  return null;
}

/** Our own quiet layer stack over the OpenMapTiles schema both base styles share. */
/** Sentinel-2 cloudless 2016 by EOX (CC BY 4.0): a real, cloud-free view of the planet, no key needed. */
const SATELLITE = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';

/** Satellite imagery, with a light OpenMapTiles overlay (borders, places) from whichever base style loaded. */
function buildStyle(base: Base | null): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: 'space-fill', type: 'background', paint: { 'background-color': C.ocean } },
    {
      id: 'satellite', type: 'raster', source: 'satellite',
      paint: { 'raster-fade-duration': 200, 'raster-contrast': 0.08, 'raster-saturation': 0.05 },
    },
  ];
  if (base) {
    const src = { source: 'omt' } as const;
    layers.push(
      {
        id: 'states', type: 'line', ...src, 'source-layer': 'boundary', minzoom: 5,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.18, 'line-width': 0.75, 'line-dasharray': [3, 2] },
      },
      {
        id: 'borders', type: 'line', ...src, 'source-layer': 'boundary', minzoom: 2.5,
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.35, 'line-width': 1 },
      },
      {
        id: 'places', type: 'symbol', ...src, 'source-layer': 'place', minzoom: 4,
        filter: ['match', ['get', 'class'], ['country', 'city', 'town'], true, false],
        layout: {
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': base.font,
          'text-size': ['match', ['get', 'class'], 'country', 10, 11],
          'text-transform': ['match', ['get', 'class'], 'country', 'uppercase', 'none'],
          'text-letter-spacing': ['match', ['get', 'class'], 'country', 0.08, 0],
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        },
        paint: { 'text-color': '#E6EAF2', 'text-opacity': 0.85, 'text-halo-color': 'rgba(4,5,8,0.85)', 'text-halo-width': 1.2 },
      },
    );
  }
  return {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      satellite: {
        type: 'raster', tiles: [SATELLITE], tileSize: 256, maxzoom: 14,
        attribution: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
      },
      ...(base ? { omt: base.source } : {}),
    },
    ...(base ? { glyphs: base.glyphs } : {}),
    layers,
  };
}

type PinFeature = GeoJSON.Feature<GeoJSON.Point, { id: string; night: boolean; snap: boolean; rank: number }>;

function pinData(streams: Stream[], sweepFromLon: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const sun = subsolarPoint(new Date());
  return {
    type: 'FeatureCollection',
    features: streams.map((s): PinFeature => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
      properties: {
        id: s.id,
        night: sunAltitude(s.latitude, s.longitude, sun) < -0.833,
        snap: s.kind === 'snapshot',
        // 0→1 around the globe eastward from the left limb: drives the first-load sweep.
        rank: ((((s.longitude - sweepFromLon) % 360) + 360) % 360) / 360,
      },
    })),
  };
}

/** Opacity for the sweep at progress p (0→1), using each pin's / cluster's earliest rank. */
const reveal = (p: number): ExpressionSpecification =>
  ['min', 1, ['max', 0, ['*', 8, ['-', p, ['coalesce', ['get', 'minRank'], ['get', 'rank'], 0]]]]];

const SWEEP_LAYERS: [string, string[]][] = [
  ['cluster-glow', []],
  ['clusters', ['circle-opacity', 'circle-stroke-opacity']],
  ['cluster-count', ['icon-opacity']],
  ['pins', ['circle-opacity', 'circle-stroke-opacity']],
];

export default function GlobeView(props: Props) {
  const { ref, streams, selected, initialCamera, reducedMotion, rotate, intro, bottomInset } = props;
  const container = useRef<HTMLDivElement>(null);
  const hoverLabel = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);

  /**
   * Rim light at the limb. MapLibre's built-in atmosphere can't be tinted, so we find the
   * silhouette by projecting points outward from the view centre and ring it in CSS.
   */
  const placeHalo = (map: MLMap) => {
    const el = halo.current;
    if (!el) return;
    const c = map.getCenter();
    const mid = map.project(c);
    const bearing = c.lat > 0 ? Math.PI : 0; // walk toward the equator side, away from pole clipping
    let r = 0;
    for (let deg = 50; deg <= 90; deg += 1) {
      const d = (deg * Math.PI) / 180;
      const lat1 = (c.lat * Math.PI) / 180;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
      const p = map.project([c.lng, (lat2 * 180) / Math.PI]);
      r = Math.max(r, Math.hypot(p.x - mid.x, p.y - mid.y));
    }
    const visible = map.getZoom() < 5 && r > 20;
    el.style.opacity = visible ? '1' : '0';
    if (!visible) return;
    const size = 2 * r + 80;
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translate(${mid.x - size / 2}px, ${mid.y - size / 2}px)`;
    el.style.background = `radial-gradient(circle closest-side, transparent ${r - 1}px, rgba(120,180,255,0.55) ${r}px, rgba(90,150,255,0.2) ${r + 7}px, transparent ${r + 36}px)`;
  };
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const rotating = useRef(false);
  const streamsRef = useRef<Stream[]>([]);
  const sweepFrom = useRef(0);
  const cb = useRef(props);
  cb.current = props;
  const [ready, setReady] = useState(false);
  /** A fly requested before the map existed (e.g. a shared link that resolves before the map loads). */
  const pendingFly = useRef<[Stream, 'near' | 'travel'] | null>(null);
  const flyOpts = useRef({ bottomInset, reducedMotion });
  flyOpts.current = { bottomInset, reducedMotion };

  const fly = (map: MLMap, s: Stream, mode: 'near' | 'travel') => {
    rotating.current = false;
    const center: [number, number] = [s.longitude, s.latitude];
    const padding = { top: 0, left: 0, right: 0, bottom: flyOpts.current.bottomInset };
    const zoom = mode === 'travel' ? 5 : Math.max(map.getZoom(), 3.5);
    if (flyOpts.current.reducedMotion) map.jumpTo({ center, zoom, padding });
    else if (mode === 'travel') map.flyTo({ center, zoom, padding, duration: 1400, curve: 1.6, easing: ease, essential: true });
    else map.easeTo({ center, zoom, padding, duration: 600, easing: ease });
  };
  const [mlLib, setMlLib] = useState<typeof import('maplibre-gl') | null>(null);

  // ── map lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let minuteTimer = 0;
    let map: MLMap | null = null;

    (async () => {
      const [ml, base] = await Promise.all([import('maplibre-gl'), loadBase()]);
      const el = container.current;
      if (cancelled || !el) return;
      setMlLib(ml);

      const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-geist-mono').trim() || 'monospace';
      await document.fonts.load(`500 10px ${mono}`).catch(() => undefined);

      const zoom = initialCamera?.zoom ?? fitZoom(el);
      map = new ml.Map({
        container: el,
        style: buildStyle(base),
        center: initialCamera ? [initialCamera.lon, initialCamera.lat] : [-30, 20],
        zoom,
        minZoom: 0.5,
        maxZoom: 16,
        maxPitch: 0,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 0,
      });
      map.touchZoomRotate.disableRotation();
      // Imagery tiles over open ocean or outside coverage fail to decode; that's expected, not an error.
      map.on('error', (e) => {
        if ((e as { sourceId?: string }).sourceId === 'satellite') return;
        console.error(e.error);
      });
      mapRef.current = map;
      sweepFrom.current = (initialCamera?.lon ?? -30) - 90;

      // Cluster counts are drawn in Geist Mono via canvas, since map glyph servers only carry sans fonts.
      map.on('styleimagemissing', (e) => {
        if (!map || !e.id.startsWith('n:')) return;
        const text = e.id.slice(2);
        const dpr = Math.min(3, Math.ceil(window.devicePixelRatio || 1));
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const font = `500 ${10 * dpr}px ${mono}`;
        ctx.font = font;
        canvas.width = Math.ceil(ctx.measureText(text).width) + 2 * dpr;
        canvas.height = 14 * dpr;
        ctx.font = font;
        ctx.fillStyle = C.primary;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, dpr, canvas.height / 2 + dpr * 0.5);
        map.addImage(e.id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: dpr });
      });

      // 'style.load', not 'load': 'load' waits for every initial satellite tile, which can keep pins
      // and the terminator off the globe for seconds on a slow connection.
      map.once('style.load', () => {
        if (!map) return;
        map.addSource('night', { type: 'geojson', data: nightBands(new Date()) });
        map.addLayer({ id: 'night', type: 'fill', source: 'night', paint: { 'fill-color': '#01020A', 'fill-opacity': 0.13, 'fill-antialias': false } });

        map.addSource('streams', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 45,
          clusterMaxZoom: 8,
          clusterProperties: { minRank: ['min', ['get', 'rank']] },
        });
        const op = intro ? reveal(0) : 1;
        const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
        const radius: ExpressionSpecification = ['step', ['get', 'point_count'], 14, 10, 18, 100, 23];
        map.addLayer({
          id: 'cluster-glow', type: 'circle', source: 'streams', filter: ['has', 'point_count'],
          paint: { 'circle-radius': ['+', radius, 5], 'circle-color': C.accent, 'circle-blur': 0.6, 'circle-opacity': ['case', hovered, 0.18, 0] },
        });
        map.addLayer({
          id: 'clusters', type: 'circle', source: 'streams', filter: ['has', 'point_count'],
          paint: {
            'circle-radius': radius, 'circle-color': C.raised, 'circle-stroke-width': 1,
            'circle-stroke-color': ['case', hovered, C.accent, C.accentMuted],
            'circle-opacity': op, 'circle-stroke-opacity': op,
          },
        });
        map.addLayer({
          id: 'cluster-count', type: 'symbol', source: 'streams', filter: ['has', 'point_count'],
          layout: { 'icon-image': ['concat', 'n:', ['get', 'point_count_abbreviated']], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
          paint: { 'icon-opacity': op },
        });
        map.addLayer({
          id: 'pins', type: 'circle', source: 'streams', filter: ['!', ['has', 'point_count']],
          paint: {
            // Snapshot cameras are smaller: present, but visually secondary to live video.
            'circle-radius': ['case', ['get', 'snap'], 3, 4.5],
            'circle-color': ['case', ['get', 'night'], C.night, C.live],
            'circle-stroke-width': 1, 'circle-stroke-color': C.void,
            'circle-opacity': op, 'circle-stroke-opacity': op,
          },
        });
        setReady(true);
      });

      // Terminator and night-side pins follow the sun, once a minute.
      minuteTimer = window.setInterval(() => {
        if (!map?.getSource('night')) return;
        map.getSource<GeoJSONSource>('night')?.setData(nightBands(new Date()));
        map.getSource<GeoJSONSource>('streams')?.setData(pinData(streamsRef.current, sweepFrom.current));
      }, 60_000);

      // ── interaction ──
      let hoverCluster: number | string | undefined;
      const setClusterHover = (id: number | string | undefined) => {
        if (!map || id === hoverCluster) return;
        if (hoverCluster !== undefined) map.setFeatureState({ source: 'streams', id: hoverCluster }, { hover: false });
        if (id !== undefined) map.setFeatureState({ source: 'streams', id }, { hover: true });
        hoverCluster = id;
      };

      map.on('mousemove', (e) => {
        if (!map) return;
        readout.set({ cursor: { lat: e.lngLat.lat, lon: e.lngLat.lng } });
        const hit = map.getLayer('pins') ? map.queryRenderedFeatures(e.point, { layers: ['pins', 'clusters'] })[0] : undefined;
        map.getCanvas().style.cursor = hit ? 'pointer' : '';
        setClusterHover(hit?.layer.id === 'clusters' ? hit.id : undefined);
        const label = hoverLabel.current;
        if (!label) return;
        const s = hit?.layer.id === 'pins' ? streamsRef.current.find((x) => x.id === hit.properties.id) : undefined;
        if (s) {
          label.firstElementChild!.textContent = s.name;
          label.lastElementChild!.textContent = `${s.place} · ${s.country}`;
          label.style.transform = `translate(${e.point.x + 12}px, ${e.point.y - 10}px)`;
          label.style.opacity = '1';
        } else {
          label.style.opacity = '0';
        }
      });
      map.on('mouseout', () => {
        readout.set({ cursor: null });
        setClusterHover(undefined);
        if (hoverLabel.current) hoverLabel.current.style.opacity = '0';
      });

      map.on('click', 'pins', (e) => {
        const id = e.features?.[0]?.properties.id;
        if (typeof id === 'string') cb.current.onSelect(id);
      });
      map.on('click', 'clusters', async (e) => {
        const f = e.features?.[0];
        if (!map || !f || f.geometry.type !== 'Point') return;
        const zoom = await map.getSource<GeoJSONSource>('streams')!.getClusterExpansionZoom(f.properties.cluster_id);
        const center = f.geometry.coordinates as [number, number];
        if (reducedMotion) map.jumpTo({ center, zoom });
        else map.flyTo({ center, zoom, duration: 600, easing: ease });
      });

      // ── auto-rotation: until the first touch, never again ──
      const stop = () => { rotating.current = false; cancelAnimationFrame(raf); };
      if (rotate) {
        rotating.current = true;
        let last = performance.now();
        const spin = (t: number) => {
          if (!rotating.current || !map) return;
          const c = map.getCenter();
          map.setCenter([c.lng - (t - last) * 0.0025, c.lat]);
          last = t;
          raf = requestAnimationFrame(spin);
        };
        raf = requestAnimationFrame(spin);
      }
      for (const ev of ['mousedown', 'touchstart', 'wheel'] as const) map.on(ev, stop);

      // ── readouts ──
      let pending = 0;
      const countInView = () => {
        pending = 0;
        if (!map) return;
        placeHalo(map);
        const c = map.getCenter();
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        let n = 0;
        for (const s of streamsRef.current) {
          // On a globe, "in view" = on the visible hemisphere and inside the viewport bounds.
          if (distanceKm(c.lat, c.lng, s.latitude, s.longitude) > 9000) continue;
          if (zoom > 3 && !bounds.contains([s.longitude, s.latitude])) continue;
          n++;
        }
        readout.set({ inView: n, zoom });
      };
      map.on('move', () => { if (!pending) pending = requestAnimationFrame(countInView); });
      map.on('moveend', () => {
        if (!map || rotating.current) return;
        const c = map.getCenter();
        cb.current.onCamera({ lon: c.lng, lat: c.lat, zoom: map.getZoom() });
      });
      map.once('idle', countInView);
      map.once('style.load', countInView);
      if (pendingFly.current) { const [s, m] = pendingFly.current; pendingFly.current = null; fly(map, s, m); }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearInterval(minuteTimer);
      markerRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; later prop changes are applied by the effects below.
  }, []);

  // ── pins ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !streams) return;
    streamsRef.current = streams;
    map.getSource<GeoJSONSource>('streams')?.setData(pinData(streams, sweepFrom.current));
    map.once('idle', () => map.fire('move'));
  }, [ready, streams]);

  // ── first-load sweep: pins come online around the globe over ~900ms ──────
  const swept = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !streams || swept.current || !intro) return;
    swept.current = true;
    let raf = 0;
    const set = (value: ExpressionSpecification | number) => {
      if (mapRef.current !== map) return; // map already torn down
      for (const [layer, props] of SWEEP_LAYERS) for (const p of props) map.setPaintProperty(layer, p, value);
    };
    const delay = window.setTimeout(() => {
      const start = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / 900) * 1.15; // overshoot so the last pins finish fading
        if (p >= 1.15) { set(1); return; }
        set(reveal(p));
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, 500);
    return () => { clearTimeout(delay); cancelAnimationFrame(raf); set(1); };
  }, [ready, streams, intro]);

  // ── the one pulse, on the selected stream ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mlLib) return;
    if (!selected) { markerRef.current?.remove(); markerRef.current = null; return; }
    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = 'pulse';
      markerRef.current = new mlLib.Marker({ element: el }).setLngLat([selected.longitude, selected.latitude]).addTo(map);
    } else {
      markerRef.current.setLngLat([selected.longitude, selected.latitude]);
    }
  }, [selected, mlLib]);

  // ── imperative camera ──────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    stopRotation() { rotating.current = false; },
    flyToStream(s, mode) {
      const map = mapRef.current;
      if (map) fly(map, s, mode);
      else pendingFly.current = [s, mode];
    },
  }), []);

  return (
    <div className="absolute inset-0">
      {/* maplibre forces position:relative on its container, so size it with h/w, not inset. */}
      <div ref={halo} className="pointer-events-none absolute left-0 top-0 rounded-full opacity-0" aria-hidden />
      <div ref={container} className="relative h-full w-full" />
      <div
        ref={hoverLabel}
        className="pointer-events-none absolute left-0 top-0 z-10 max-w-64 rounded-[2px] border border-strong bg-panel/95 px-2 py-1 opacity-0 transition-opacity duration-200"
        aria-hidden
      >
        <div className="truncate text-[12px] text-primary" />
        <div className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary" />
      </div>
    </div>
  );
}
