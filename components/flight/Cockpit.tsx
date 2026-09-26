'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { project, type Flight } from '@/lib/flights';
import { subsolarPoint, sunAltitude } from '@/lib/solar';
import { SATELLITE } from '@/components/globe/GlobeView';

export interface CockpitHandle { fullscreen(): void }

/** Mapzen/AWS Terrarium elevation tiles: open, no key, CORS-enabled. */
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
/** Degrees below the horizon the eye looks, like sitting behind a nose. Calibration knob. */
const LOOK_DOWN = 4;
/** ADS-B roll → camera roll. Flip to -1 if banks tilt the wrong way. */
const ROLL_SIGN = 1;

const SKY_DAY = { 'sky-color': '#4F86C9', 'horizon-color': '#CFE0F2', 'fog-color': '#C4D6EA' };
const SKY_NIGHT = { 'sky-color': '#03060F', 'horizon-color': '#1A2440', 'fog-color': '#0D1426' };

/**
 * Synthetic out-of-the-window view: a second MapLibre map whose camera is placed at the
 * aircraft's (dead-reckoned) position and altitude, looking along its track, then framed by
 * cockpit windows. Satellite imagery + terrain, not a real camera on the aircraft.
 */
export default function Cockpit({ flight, ref }: { flight: Flight; ref?: Ref<CockpitHandle> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const flightRef = useRef(flight);
  flightRef.current = flight;

  useImperativeHandle(ref, () => ({
    fullscreen() {
      const el = wrap.current;
      if (!el) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen?.();
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let map: MLMap | null = null;
    (async () => {
      const ml = await import('maplibre-gl');
      if (cancelled || !container.current) return;
      map = new ml.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            sat: { type: 'raster', tiles: [SATELLITE], tileSize: 256, maxzoom: 14 },
            dem: { type: 'raster-dem', tiles: [TERRAIN], tileSize: 256, maxzoom: 13, encoding: 'terrarium' },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#0A1A2E' } },
            { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 0 } },
          ],
          terrain: { source: 'dem', exaggeration: 1 },
          sky: { ...SKY_DAY, 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.4, 'atmosphere-blend': 0 },
        },
        interactive: false,
        attributionControl: false,
        maxPitch: 95,
        fadeDuration: 0,
      });
      map.on('error', () => undefined); // ocean tiles 404; expected
      mapRef.current = map;

      const frame = () => {
        if (!map) return;
        const f = flightRef.current;
        const p = project(f, Date.now());
        const ground = (map.queryTerrainElevation([p.lon, p.lat]) ?? 0) + 4;
        const alt = Math.max(ground, f.alt * 0.3048);
        try {
          map.jumpTo(map.calculateCameraOptionsFromCameraLngLatAltRotation(
            [p.lon, p.lat], alt, f.track, f.ground ? 90 : 90 - LOOK_DOWN, f.roll * ROLL_SIGN,
          ));
        } catch { /* degenerate camera for one frame; try again next */ }
        raf = requestAnimationFrame(frame);
      };
      map.once('style.load', () => { raf = requestAnimationFrame(frame); });
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); map?.remove(); mapRef.current = null; };
  }, []);

  // Night outside the window when the sun is down at the aircraft.
  const night = sunAltitude(flight.lat, flight.lon, subsolarPoint(new Date())) < -6;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setSky({ ...(night ? SKY_NIGHT : SKY_DAY), 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.4, 'atmosphere-blend': 0 });
      map.setPaintProperty('sat', 'raster-brightness-max', night ? 0.25 : 1);
    };
    if (map.isStyleLoaded()) apply(); else map.once('style.load', apply);
  }, [night]);

  const hdg = String(Math.round(flight.track) % 360).padStart(3, '0');
  const vs = `${flight.vs > 0 ? '+' : ''}${Math.round(flight.vs)}`;

  return (
    <div ref={wrap} className="relative aspect-video w-full overflow-hidden rounded-[2px] border border-subtle bg-void">
      <div ref={container} className="absolute inset-0 h-full w-full" />
      {/* Cockpit frame: everything but the window panes is solid. */}
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#141922" />
            <stop offset="1" stopColor="#07090D" />
          </linearGradient>
        </defs>
        <path
          fillRule="evenodd"
          fill="url(#panel)"
          stroke="#29313F"
          strokeWidth="3"
          d="M0 0H1600V900H0Z
             M170 250 L765 205 L772 585 L215 640 Z
             M1430 250 L835 205 L828 585 L1385 640 Z
             M20 330 L120 280 L170 625 L40 690 Z
             M1580 330 L1480 280 L1430 625 L1560 690 Z"
        />
        {/* glare shield lip */}
        <path d="M150 700 Q800 610 1450 700" fill="none" stroke="#29313F" strokeWidth="4" />
        <g fontFamily="var(--font-geist-mono), monospace" fontSize="30" fill="#4DE1FF" letterSpacing="2">
          <text x="340" y="780">HDG {hdg}</text>
          <text x="610" y="780">ALT {flight.ground ? 'GND' : Math.round(flight.alt).toLocaleString('en-US')}</text>
          <text x="950" y="780">GS {Math.round(flight.gs)}</text>
          <text x="1170" y="780">V/S {vs}</text>
        </g>
        <text x="800" y="850" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="22" fill="#565E70" letterSpacing="3">
          SYNTHETIC VIEW · SATELLITE IMAGERY FROM REPORTED POSITION
        </text>
      </svg>
    </div>
  );
}
