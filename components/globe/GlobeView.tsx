'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type {
  AddProtocolAction, ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MLMap, Marker,
  RasterTileSource, StyleSpecification, VectorSourceSpecification,
} from 'maplibre-gl';
import type { Stream } from '@/lib/stream';
import { distanceKm } from '@/lib/geo';
import { subsolarPoint, sunAltitude } from '@/lib/solar';
import {
  OVERLAYS, OVERLAY_IDS, SKY_BLEND, SKY_DAY, SKY_NIGHT, SKY_OFF, TERRAIN, registerSky, skyTiles, useAurora, useClock, useGeoFrames, useRadar, type Sky,
} from '@/lib/sky';
import { readout } from '@/lib/readout';
import { formatAlt, project, type Flight } from '@/lib/flights';
import { EVENT_COLORS, EVENT_LABELS, type Planet } from '@/lib/events';
import type { Station } from '@/lib/radio';
import { GROUP_LABEL, footprint, groundTrack, periodMin, positions, subpoint, type Sat } from '@/lib/satellites';

export interface Camera { lon: number; lat: number; zoom: number }
export interface GlobeHandle {
  /** `travel` arcs out and back in across the planet (random, search); `near` is a short glide. */
  flyToStream(stream: Stream, mode: 'near' | 'travel'): void;
  flyTo(lon: number, lat: number, mode: 'near' | 'travel'): void;
  /** Centre of the view, for fetching what's around it. */
  center(): { lat: number; lon: number } | null;
  stopRotation(): void;
  /** Whether every tile in view has arrived (the time machine waits on it before stepping). */
  loaded(): boolean;
  /** The streams on screen: on the facing hemisphere and, once zoomed in, inside the viewport. */
  visible(list: Stream[]): Stream[];
}

interface Props {
  ref?: Ref<GlobeHandle>;
  streams: Stream[] | null;
  /** Where the pulse sits: the open stream or dossier target. */
  focus: { lat: number; lon: number } | null;
  flights: Flight[] | null;
  flightId: string | null;
  /** Dossier mode: a click on empty globe opens a dossier there. */
  dossier: boolean;
  initialCamera: Camera | null;
  reducedMotion: boolean;
  /** Auto-rotate until first touch (off for shared links and reduced motion). */
  rotate: boolean;
  /** Play the once-per-session pin sweep. */
  intro: boolean;
  /** Pixels hidden under the mobile bottom sheet, so fly-to targets stay visible. */
  bottomInset: number;
  /** Imagery overlays: live clouds, night lights, senses, aurora, lightning. */
  sky: Sky;
  /** The time machine's moment; null = now. */
  time: number | null;
  /** Earthquakes, fires, storms, ice (null = the Earth layer is off). */
  planet: Planet | null;
  /** Everything in orbit (null = the layer is off and nothing in orbit is open). */
  sats: Sat[] | null;
  satId: number | null;
  /** Keep the camera under the open satellite as it moves. */
  follow: boolean;
  onSatellite(id: number): void;
  onUnfollow(): void;
  /** A hand on the globe (drag, pinch, wheel): ends following and the autopilot. */
  onTouch(): void;
  /** Radio stations (null = the radio layer is off); the one on air is ringed. */
  stations: Station[] | null;
  radioId: string | null;
  onRadio(id: string): void;
  onSelect(id: string): void;
  onFlight(hex: string): void;
  onDossier(lat: number, lon: number): void;
  onCamera(camera: Camera): void;
}

const BASE_STYLES = [
  'https://tiles.openfreemap.org/styles/dark',
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
];

const C = {
  void: '#040508', ocean: '#0A1A2E', raised: '#12161E', subtle: '#181D27', strong: '#29313F',
  tertiary: '#565E70', primary: '#E6EAF2', accent: '#4DE1FF', accentMuted: '#1B5567', accentGlow: 'rgba(77,225,255,0.15)',
  live: '#2BE88A', night: '#6C7BA8', plane: '#FFB547',
  // Kept in step with --flight-mil / --flight-emer / --quake / --sat / --radio in globals.css (MapLibre can't read CSS vars).
  mil: '#7CFC4B', emergency: '#FF3B4E', quake: '#FF7A45', sat: '#B48CFF', radio: '#FF5CC8',
  fireLow: '#FFC23D', fire: '#FF7A1A', fireHot: '#FF3B1F', starlink: '#8B94A7', gnss: '#FFD27A', geo: '#7CE3C4',
};

/** Satellites by kind; the open one ringed in accent. A zoom curve must be the top-level expression. */
const satRadius = (id: number): ExpressionSpecification => {
  const sel: ExpressionSpecification = ['==', ['get', 'id'], id];
  return ['interpolate', ['linear'], ['zoom'],
    1, ['case', sel, 4.5, ['match', ['get', 'g'], 'station', 4, 'starlink', 0.9, 1.4]],
    6, ['case', sel, 7, ['match', ['get', 'g'], 'station', 6, 'starlink', 2, 3]]];
};
const satStroke = (id: number): ExpressionSpecification =>
  ['case', ['==', ['get', 'id'], id], 2, ['match', ['get', 'g'], 'station', 1.5, 0]];
const satStrokeColor = (id: number): ExpressionSpecification => ['case', ['==', ['get', 'id'], id], C.accent, C.void];

/** "12 min ago" from an age in hours. */
const ago = (hours: number) => (hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min ago` : `${Math.round(hours)} h ago`);

/** Top-down airliner silhouette, drawn white so the SDF icon can be tinted per aircraft. */
function planeIcon(dpr: number): ImageData | null {
  const s = 24 * dpr;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D('M12 1.5c.9 0 1.4 1 1.4 2.2v5.6l8.1 4.6v2.2l-8.1-2.4v4.6l2.2 1.7v1.8L12 21l-3.6.8V20l2.2-1.7v-4.6l-8.1 2.4v-2.2l8.1-4.6V3.7c0-1.2.5-2.2 1.4-2.2Z'));
  return ctx.getImageData(0, 0, s, s);
}

function planeData(flights: Flight[], now: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: flights.map((f) => {
      const p = project(f, now);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { hex: f.hex, track: f.track, ground: f.ground, mil: f.mil, emergency: f.emergency },
      };
    }),
  };
}

// A zoom curve must be the top-level expression, so the selected-aircraft case goes inside each stop.
// An emergency is drawn selected-size at every zoom: it should be findable on a globe full of traffic.
const planeSize = (hex: string): ExpressionSpecification => {
  const big: ExpressionSpecification = ['any', ['==', ['get', 'hex'], hex], ['get', 'emergency']];
  return ['interpolate', ['linear'], ['zoom'], 2, ['case', big, 1.1, 0.55], 8, ['case', big, 1.5, 1]];
};
/** Emergency outranks selection — losing the red would hide the one aircraft that matters. */
const planeColor = (hex: string): ExpressionSpecification => [
  'case',
  ['get', 'emergency'], C.emergency,
  ['==', ['get', 'hex'], hex], C.accent,
  ['get', 'mil'], C.mil,
  ['get', 'ground'], C.tertiary,
  C.plane,
];

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

/**
 * Esri World Imagery (no key) at every zoom: seamless mosaic far out, sub-metre close in.
 * (Sentinel-2 cloudless 2016 showed its orbit-swath seams as stripes across the continents.)
 */
export const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_MAXZOOM = 19;
/** Deepest level Esri still has real imagery for in the polar tile rows; at z4 they are flat filler. */
const POLAR_Z = 3;

/** Satellite imagery, with a light OpenMapTiles overlay (borders, places) from whichever base style loaded. */
function buildStyle(base: Base | null): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: 'space-fill', type: 'background', paint: { 'background-color': C.ocean } },
    {
      id: 'satellite', type: 'raster', source: 'satellite',
      paint: { 'raster-fade-duration': 200, 'raster-contrast': 0.08, 'raster-saturation': 0.05 },
    },
    // Every sky overlay, hidden until switched on: a hidden layer's tiles are never fetched.
    ...OVERLAYS.map((o): LayerSpecification => ({
      id: o.id, type: 'raster', source: o.id, layout: { visibility: 'none' },
      paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 300 },
    })),
  ];
  if (base) {
    const src = { source: 'omt' } as const;
    layers.push(
      {
        // Shown with 3D terrain (the Sky menu), from street level up.
        id: 'buildings', type: 'fill-extrusion', ...src, 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#A9B3C6',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.72,
        },
      },
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
        type: 'raster', tiles: [SATELLITE], tileSize: 256, maxzoom: SATELLITE_MAXZOOM,
        attribution: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
      // Real tiles are set when an overlay is first shown (skyTiles); this one is never requested.
      ...Object.fromEntries(OVERLAYS.map((o) => [o.id, {
        type: 'raster' as const, tiles: ['placeholder://{z}/{x}/{y}'], tileSize: 256, maxzoom: o.maxzoom, attribution: o.attribution,
      }])),
      ...(base ? { omt: base.source } : {}),
      dem: { type: 'raster-dem', tiles: [TERRAIN], tileSize: 256, maxzoom: 14, encoding: 'terrarium' },
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

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const pt = (lon: number, lat: number, properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

/** The Earth layer's sources, as of `now` (quake age drives colour and fade). */
function planetData(p: Planet | null, now: number) {
  const fires: GeoJSON.Feature[] = [];
  const f = p?.fires?.f ?? [];
  for (let i = 0; i + 2 < f.length; i += 3) fires.push(pt(f[i + 1], f[i], { frp: f[i + 2] }));
  return {
    fires: { type: 'FeatureCollection', features: fires } as GeoJSON.FeatureCollection,
    quakes: {
      type: 'FeatureCollection',
      features: (p?.quakes ?? []).filter((q) => q.at <= now).map((q) => pt(q.lon, q.lat, {
        id: q.id, mag: q.mag, place: q.place, age: (now - q.at) / 3600_000, depth: q.depth,
      })),
    } as GeoJSON.FeatureCollection,
    events: {
      type: 'FeatureCollection',
      features: (p?.events ?? []).map((e) => pt(e.lon, e.lat, {
        id: e.id, title: e.title, category: EVENT_LABELS[e.category] ?? e.category, color: EVENT_COLORS[e.category] ?? C.tertiary,
      })),
    } as GeoJSON.FeatureCollection,
    tracks: {
      type: 'FeatureCollection',
      features: (p?.events ?? []).filter((e) => e.track.length > 1).map((e) => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: e.track }, properties: { color: EVENT_COLORS[e.category] ?? C.tertiary },
      })),
    } as GeoJSON.FeatureCollection,
  };
}

/** Layers a click or hover can land on, topmost first. */
const HIT_LAYERS = ['planes', 'pins', 'clusters', 'radio', 'sats', 'quakes', 'events'];

/** Satellites are placed at the moment on screen, while their elements still mean something there. */
const satTime = (time: number | null) => (time === null ? Date.now() : Math.abs(time - Date.now()) < 7 * 86400_000 ? time : null);

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
  const { ref, streams, focus, flights, flightId, initialCamera, reducedMotion, rotate, intro, bottomInset, sky, time, planet, sats, satId, follow } = props;
  const container = useRef<HTMLDivElement>(null);
  const hoverLabel = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);

  /**
   * MapLibre scales the globe up by 1/cos(centre latitude) but leaves `zoom` — and so the tile
   * level — where it was, so a pole-centred globe comes back several levels coarser than the same
   * globe seen from the equator: at 85° it drops to a single z0 tile for the whole planet.
   * Shrinking the declared tile size buys those levels back, and `tileSize` is re-read on every
   * tile-cover pass, so the change lands on the next frame.
   *
   * It is pinned to exactly POLAR_Z rather than left to run free: Esri stops carrying real imagery
   * in the top and bottom tile rows past z3 and serves flat filler there, which paints the cap as a
   * plain disc. `maxzoom` is clamped to match so nothing can overshoot into the filler.
   */
  const sharpenPoles = (map: MLMap) => {
    const src = map.getSource<RasterTileSource>('satellite');
    if (!src) return;
    const zoom = map.getZoom();
    const natural = Math.floor(zoom + 1); // the level MapLibre would pick for a 256px source
    const polar = Math.abs(map.getCenter().lat) >= 60 && natural < POLAR_Z;
    // floor(zoom + log2(512 / tileSize)) then lands on POLAR_Z exactly.
    const size = polar ? 256 >> Math.min(5, POLAR_Z - natural) : 256;
    const maxzoom = polar ? POLAR_Z : SATELLITE_MAXZOOM;
    if (src.tileSize === size && src.maxzoom === maxzoom) return;
    src.tileSize = size;
    src.maxzoom = maxzoom;
    map.triggerRepaint();
  };

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
  /**
   * The descent into 3D: tilt and rotation unlock as the globe gives way to a landscape (pitch up to
   * 70° by z8.5), real terrain from z8 (off again below 7.5, so it doesn't flicker at the threshold),
   * buildings from z14, and a sky at the horizon. Zooming back out past z4 turns north up again.
   */
  const apply3d = (map: MLMap) => {
    if (!styled.current) return; // terrain and sky can't be set before the style is in
    const on = cb.current.sky.terrain;
    const z = map.getZoom();
    const cap = on ? Math.round(Math.max(0, Math.min(70, (z - 5) * 20))) : 0;
    if (map.getMaxPitch() !== cap) map.setMaxPitch(cap);
    const rotate = on && z >= 5;
    if (rotate !== map.dragRotate.isEnabled()) {
      if (rotate) { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); }
      else { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); }
    }
    const has = !!map.getTerrain();
    const want = on && z >= (has ? 7.5 : 8);
    if (want !== has) {
      map.setTerrain(want ? { source: 'dem', exaggeration: 1.4 } : null);
      const c = map.getCenter();
      map.setSky(want ? { ...(sunAltitude(c.lat, c.lng, subsolarPoint(new Date())) < -6 ? SKY_NIGHT : SKY_DAY), ...SKY_BLEND } : SKY_OFF);
    }
    if (map.getLayer('buildings')) map.setLayoutProperty('buildings', 'visibility', on ? 'visible' : 'none');
    if (z < 4 && map.getBearing() !== 0 && !map.isMoving()) map.easeTo({ bearing: 0, duration: 400 });
  };
  const mapRef = useRef<MLMap | null>(null);
  const styled = useRef(false);
  const markerRef = useRef<Marker | null>(null);
  const rotating = useRef(false);
  const streamsRef = useRef<Stream[]>([]);
  const flightsRef = useRef<Flight[]>([]);
  const sweepFrom = useRef(0);
  const cb = useRef(props);
  cb.current = props;
  const satsRef = useRef<Sat[]>([]);

  /** Every satellite where it is now; the open one with its ground track and footprint (and the camera, when following). */
  const drawSats = (map: MLMap) => {
    const src = map.getSource<GeoJSONSource>('sats');
    if (!src) return;
    const list = satsRef.current;
    const at = satTime(cb.current.time);
    const clear = (ids: string[]) => { for (const id of ids) map.getSource<GeoJSONSource>(id)?.setData(EMPTY); };
    if (!list.length || at === null) { clear(['sats', 'sat-track', 'sat-foot']); return; }
    const date = new Date(at);
    const pos = positions(list, date);
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < list.length; i++) {
      if (Number.isNaN(pos[3 * i])) continue;
      features.push(pt(pos[3 * i + 1], pos[3 * i], { id: list[i].id, name: list[i].name, g: list[i].group, alt: Math.round(pos[3 * i + 2]) }));
    }
    src.setData({ type: 'FeatureCollection', features });
    const sel = list.find((x) => x.id === cb.current.satId);
    const p = sel && subpoint(sel, date);
    if (!sel || !p) { clear(['sat-track', 'sat-foot']); return; }
    const per = periodMin(sel);
    map.getSource<GeoJSONSource>('sat-track')?.setData({
      type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: groundTrack(sel, date, per * 0.4, per, per / 180) },
    });
    map.getSource<GeoJSONSource>('sat-foot')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: footprint(p) } });
    if (cb.current.follow && cb.current.time === null && !map.isMoving()) {
      map.easeTo({ center: [p.lon, p.lat], duration: 1900, easing: (x) => x });
    }
  };
  const [ready, setReady] = useState(false);
  /** A fly requested before the map existed (e.g. a shared link that resolves before the map loads). */
  const pendingFly = useRef<[number, number, 'near' | 'travel'] | null>(null);
  const flyOpts = useRef({ bottomInset, reducedMotion });
  flyOpts.current = { bottomInset, reducedMotion };

  const fly = (map: MLMap, lon: number, lat: number, mode: 'near' | 'travel') => {
    rotating.current = false;
    const center: [number, number] = [lon, lat];
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
    let planeTimer = 0;
    let satTimer = 0;
    let map: MLMap | null = null;

    (async () => {
      const [ml, base] = await Promise.all([import('maplibre-gl'), loadBase()]);
      const el = container.current;
      if (cancelled || !el) return;
      setMlLib(ml);

      const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-geist-mono').trim() || 'monospace';
      await document.fonts.load(`500 10px ${mono}`).catch(() => undefined);

      const zoom = initialCamera?.zoom ?? fitZoom(el);
      registerSky(ml);
      map = new ml.Map({
        container: el,
        style: buildStyle(base),
        center: initialCamera ? [initialCamera.lon, initialCamera.lat] : [-30, 20],
        zoom,
        minZoom: 0.5,
        maxZoom: 18,
        maxPitch: 0, // raised with zoom by apply3d
        attributionControl: false,
        dragRotate: false, // enabled once zoomed in, by apply3d
        fadeDuration: 0,
      });
      map.touchZoomRotate.disableRotation();
      // Imagery tiles over open ocean, outside a satellite's disk or past a layer's newest date fail;
      // that's expected, not an error.
      map.on('error', (e) => {
        const id = (e as { sourceId?: string }).sourceId;
        if (id === 'satellite' || (id && OVERLAY_IDS.has(id))) return;
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
      // off the globe for seconds on a slow connection.
      map.once('style.load', () => {
        if (!map) return;
        // The Earth layer sits beneath every pin: fires glow, storms trail their tracks, quakes ring by age.
        for (const id of ['fires', 'quakes', 'events', 'tracks']) map.addSource(id, { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'fires', type: 'circle', source: 'fires',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              1, ['interpolate', ['linear'], ['get', 'frp'], 0, 0.9, 100, 2.2, 1000, 3.6],
              9, ['interpolate', ['linear'], ['get', 'frp'], 0, 3, 100, 6, 1000, 10]],
            'circle-color': ['interpolate', ['linear'], ['get', 'frp'], 0, C.fireLow, 30, C.fire, 300, C.fireHot],
            'circle-blur': 0.6, 'circle-opacity': 0.85,
          },
        });
        map.addLayer({
          id: 'tracks', type: 'line', source: 'tracks',
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] },
        });
        map.addLayer({
          id: 'quakes', type: 'circle', source: 'quakes',
          paint: {
            'circle-radius': ['interpolate', ['exponential', 1.6], ['get', 'mag'], 2.5, 2.5, 5, 7, 7, 16, 9, 30],
            // Red under an hour old, orange under six, amber for the rest of the day.
            'circle-color': ['step', ['get', 'age'], C.emergency, 1, C.quake, 6, C.plane],
            'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.7, 24, 0.25],
            'circle-stroke-width': 1, 'circle-stroke-color': ['step', ['get', 'age'], C.emergency, 1, C.quake, 6, C.plane],
          },
        });
        map.addLayer({
          id: 'events', type: 'circle', source: 'events',
          paint: { 'circle-radius': 5.5, 'circle-color': ['get', 'color'], 'circle-stroke-width': 1.5, 'circle-stroke-color': C.void },
        });

        // Everything in orbit, beneath the pins: ~16,600 dots, the stations ringed.
        for (const id of ['sats', 'sat-track', 'sat-foot']) map.addSource(id, { type: 'geojson', data: EMPTY });
        map.addLayer({ id: 'sat-foot', type: 'line', source: 'sat-foot', paint: { 'line-color': C.sat, 'line-width': 1, 'line-opacity': 0.55, 'line-dasharray': [3, 3] } });
        map.addLayer({ id: 'sat-track', type: 'line', source: 'sat-track', paint: { 'line-color': C.sat, 'line-width': 1.2, 'line-opacity': 0.75 } });
        map.addLayer({
          id: 'sats', type: 'circle', source: 'sats',
          paint: {
            'circle-radius': satRadius(-1),
            'circle-color': ['match', ['get', 'g'], 'station', C.accent, 'starlink', C.starlink, 'gnss', C.gnss, 'geo', C.geo, C.sat],
            'circle-opacity': ['match', ['get', 'g'], 'starlink', 0.55, 0.9],
            'circle-stroke-width': satStroke(-1), 'circle-stroke-color': satStrokeColor(-1),
          },
        });

        map.addSource('radio', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'radio', type: 'circle', source: 'radio',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 8, 4.5],
            'circle-color': C.radio, 'circle-opacity': 0.85,
            'circle-stroke-width': 0.5, 'circle-stroke-color': C.void,
          },
        });

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

        const planeImg = planeIcon(2);
        if (planeImg) map.addImage('plane', planeImg, { pixelRatio: 2, sdf: true });
        map.addSource('planes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'planes', type: 'symbol', source: 'planes',
          layout: {
            'icon-image': 'plane', 'icon-rotate': ['get', 'track'], 'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': planeSize(''),
          },
          paint: { 'icon-color': planeColor(''), 'icon-halo-color': C.void, 'icon-halo-width': 1 },
        });
        styled.current = true;
        setReady(true);
      });

      // Night-side pins follow the sun, once a minute.
      minuteTimer = window.setInterval(() => {
        if (!map?.getSource('streams')) return;
        map.getSource<GeoJSONSource>('streams')?.setData(pinData(streamsRef.current, sweepFrom.current));
      }, 60_000);

      // Aircraft glide between 10 s polls: dead-reckoned once a second.
      planeTimer = window.setInterval(() => {
        if (flightsRef.current.length) map?.getSource<GeoJSONSource>('planes')?.setData(planeData(flightsRef.current, Date.now()));
      }, 1000);
      // Satellites by SGP4 every 2 s (~30 ms for all of them); Starlink moves ~15 km in that time.
      satTimer = window.setInterval(() => { if (map && satsRef.current.length) drawSats(map); }, 2000);

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
        const hit = map.getLayer('planes') ? map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS })[0] : undefined;
        map.getCanvas().style.cursor = hit ? 'pointer' : cb.current.dossier ? 'crosshair' : '';
        setClusterHover(hit?.layer.id === 'clusters' ? hit.id : undefined);
        const label = hoverLabel.current;
        if (!label) return;
        const s = hit?.layer.id === 'pins' ? streamsRef.current.find((x) => x.id === hit.properties.id) : undefined;
        const f = hit?.layer.id === 'planes' ? flightsRef.current.find((x) => x.hex === hit.properties.hex) : undefined;
        const q = hit?.layer.id === 'quakes' ? hit.properties : undefined;
        const ev = hit?.layer.id === 'events' ? hit.properties : undefined;
        const sat = hit?.layer.id === 'sats' ? hit.properties : undefined;
        const fm = hit?.layer.id === 'radio' ? hit.properties : undefined;
        const text = s ? [s.name, `${s.place} · ${s.country}`]
          : f ? [f.callsign, `${f.type ?? '—'} · ${formatAlt(f)} · ${Math.round(f.gs)} kt`]
          : q ? [`M${Number(q.mag).toFixed(1)} earthquake`, `${q.place} · ${ago(Number(q.age))}`]
          : ev ? [String(ev.title), String(ev.category)]
          : fm ? [String(fm.name), [fm.cc, fm.tags].filter(Boolean).join(' · ') || 'Radio']
          : sat ? [String(sat.name), `${GROUP_LABEL[sat.g as Sat['group']]} · ${Number(sat.alt).toLocaleString('en-US')} km up`]
          : null;
        if (text) {
          label.firstElementChild!.textContent = text[0];
          label.lastElementChild!.textContent = text[1];
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
      map.on('click', 'planes', (e) => {
        const hex = e.features?.[0]?.properties.hex;
        if (typeof hex === 'string') cb.current.onFlight(hex);
      });
      map.on('click', 'radio', (e) => {
        const id = e.features?.[0]?.properties.id;
        if (map?.queryRenderedFeatures(e.point, { layers: ['planes', 'pins', 'clusters'] }).length) return;
        if (typeof id === 'string') cb.current.onRadio(id);
      });
      map.on('click', 'sats', (e) => {
        const id = e.features?.[0]?.properties.id;
        if (map?.queryRenderedFeatures(e.point, { layers: ['planes', 'pins', 'clusters'] }).length) return;
        if (id !== undefined) cb.current.onSatellite(Number(id));
      });
      // Any hand on the globe ends following, and the tour.
      for (const ev of ['mousedown', 'touchstart', 'wheel'] as const) {
        map.on(ev, () => { cb.current.onTouch(); if (cb.current.follow) cb.current.onUnfollow(); });
      }
      // A quake or event opens the dossier on the spot: weather, nearby cameras, aircraft, history.
      for (const layer of ['quakes', 'events']) {
        map.on('click', layer, (e) => {
          const g = e.features?.[0]?.geometry;
          if (g?.type === 'Point' && !map?.queryRenderedFeatures(e.point, { layers: ['planes', 'pins', 'clusters'] }).length) {
            cb.current.onDossier(g.coordinates[1], g.coordinates[0]);
          }
        });
      }
      map.on('click', (e) => {
        if (!map || !cb.current.dossier) return;
        if (map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS }).length) return;
        cb.current.onDossier(e.lngLat.lat, e.lngLat.lng);
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
        sharpenPoles(map);
        apply3d(map);
        const c = map.getCenter();
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        let n = 0;
        for (const s of streamsRef.current) {
          // On a globe, "in view" = on the visible hemisphere and inside the viewport bounds
          // (bounds first: it's the cheap test, and rejects almost everything once zoomed in).
          if (zoom > 3 && !bounds.contains([s.longitude, s.latitude])) continue;
          if (distanceKm(c.lat, c.lng, s.latitude, s.longitude) > 9000) continue;
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
      if (pendingFly.current) { const [lon, lat, m] = pendingFly.current; pendingFly.current = null; fly(map, lon, lat, m); }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearInterval(minuteTimer);
      clearInterval(planeTimer);
      clearInterval(satTimer);
      markerRef.current?.remove();
      map?.remove();
      mapRef.current = null;
      styled.current = false;
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

  // ── sky: each overlay's tiles for this moment; hidden layers fetch nothing ─
  const now = useClock(5 * 60_000);
  const frames = useGeoFrames(ready && (sky.live || sky.sense === 'ir'));
  const radar = useRadar(ready && sky.sense === 'radar');
  const aurora = useAurora(ready && sky.aurora);
  const applied = useRef<Record<string, string>>({});
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const want = skyTiles(sky, { t: time, now, frames, radar, aurora });
    for (const { id } of OVERLAYS) {
      const tiles = want[id];
      // Tiles first: a layer made visible with its placeholder URL would request it.
      if (tiles && applied.current[id] !== tiles[0]) {
        map.getSource<RasterTileSource>(id)?.setTiles(tiles);
        applied.current[id] = tiles[0];
      }
      map.setLayoutProperty(id, 'visibility', tiles ? 'visible' : 'none');
    }
  }, [ready, sky, time, now, frames, radar, aurora]);

  // ── aircraft ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    flightsRef.current = flights ?? [];
    map.getSource<GeoJSONSource>('planes')?.setData(planeData(flightsRef.current, Date.now()));
  }, [ready, flights]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty('planes', 'icon-size', planeSize(flightId ?? ''));
    map.setPaintProperty('planes', 'icon-color', planeColor(flightId ?? ''));
  }, [ready, flightId]);

  // ── 3D: re-applied on every move; this catches the Sky menu's toggle ──────
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) apply3d(map);
    // apply3d reads the toggle through cb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sky.terrain]);

  // ── radio ──────────────────────────────────────────────────────────────────
  const { stations, radioId } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource<GeoJSONSource>('radio')?.setData({
      type: 'FeatureCollection',
      features: (stations ?? []).map((s) => pt(s.lon, s.lat, { id: s.id, name: s.name, cc: s.cc, tags: s.tags })),
    });
  }, [ready, stations]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const on: ExpressionSpecification = ['==', ['get', 'id'], radioId ?? ''];
    map.setPaintProperty('radio', 'circle-stroke-width', ['case', on, 2, 0.5]);
    map.setPaintProperty('radio', 'circle-stroke-color', ['case', on, C.primary, C.void]);
  }, [ready, radioId]);

  // ── satellites ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    satsRef.current = sats ?? [];
    map.setPaintProperty('sats', 'circle-radius', satRadius(satId ?? -1));
    map.setPaintProperty('sats', 'circle-stroke-width', satStroke(satId ?? -1));
    map.setPaintProperty('sats', 'circle-stroke-color', satStrokeColor(satId ?? -1));
    drawSats(map);
    // drawSats reads time and follow through cb; they're listed so a change redraws at once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sats, satId, time, follow]);

  // ── the Earth layer; quakes under an hour old ring like the selected pin ───
  const quakeMarks = useRef(new Map<string, Marker>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !mlLib) return;
    const at = time ?? Date.now();
    const d = planetData(planet, at);
    for (const id of ['fires', 'quakes', 'events', 'tracks'] as const) map.getSource<GeoJSONSource>(id)?.setData(d[id]);
    const fresh = new Map((planet?.quakes ?? []).filter((q) => q.at <= at && at - q.at < 3600_000).map((q) => [q.id, q]));
    for (const [id, m] of quakeMarks.current) if (!fresh.has(id)) { m.remove(); quakeMarks.current.delete(id); }
    for (const [id, q] of fresh) {
      if (quakeMarks.current.has(id)) continue;
      const el = document.createElement('div');
      el.className = 'quake-ring';
      el.style.setProperty('--size', `${Math.round(6 + q.mag * 4)}px`);
      quakeMarks.current.set(id, new mlLib.Marker({ element: el }).setLngLat([q.lon, q.lat]).addTo(map));
    }
  }, [ready, mlLib, planet, time]);

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

  // ── the one pulse, on the open stream or dossier ─────────────────────────
  const focusLat = focus?.lat;
  const focusLon = focus?.lon;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mlLib) return;
    if (focusLat === undefined || focusLon === undefined) { markerRef.current?.remove(); markerRef.current = null; return; }
    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = 'pulse';
      markerRef.current = new mlLib.Marker({ element: el }).setLngLat([focusLon, focusLat]).addTo(map);
    } else {
      markerRef.current.setLngLat([focusLon, focusLat]);
    }
  }, [focusLat, focusLon, mlLib]);

  // ── imperative camera ──────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    stopRotation() { rotating.current = false; },
    flyToStream(s, mode) { this.flyTo(s.longitude, s.latitude, mode); },
    flyTo(lon, lat, mode) {
      const map = mapRef.current;
      if (map) fly(map, lon, lat, mode);
      else pendingFly.current = [lon, lat, mode];
    },
    center() {
      const c = mapRef.current?.getCenter();
      return c ? { lat: c.lat, lon: c.lng } : null;
    },
    loaded() { return mapRef.current?.areTilesLoaded() ?? true; },
    visible(list) {
      const map = mapRef.current;
      if (!map) return [];
      const c = map.getCenter();
      const b = map.getBounds();
      const zoom = map.getZoom();
      return list.filter((s) => (zoom <= 3 || b.contains([s.longitude, s.latitude]))
        && distanceKm(c.lat, c.lng, s.latitude, s.longitude) <= 9000);
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
