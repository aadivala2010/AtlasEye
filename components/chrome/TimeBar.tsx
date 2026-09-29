'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** The moment on screen. */
  time: number;
  onChange(t: number): void;
  /** Back to now: closes the time machine. */
  onLive(): void;
  /** Whether the globe has finished loading the current frame, so play doesn't outrun the tiles. */
  isLoaded(): boolean;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** MODIS Terra's first day: the oldest true-colour composite there is. */
export const TIME_MIN = Date.UTC(2000, 1, 24);
const STEP = 10 * MIN;

const pad = (n: number) => String(n).padStart(2, '0');
/** For <input type="datetime-local">, which speaks local wall time. */
const localInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The time machine: scrub, step or play the planet through time; LIVE returns to now. */
export default function TimeBar({ time, onChange, onLive, isLoaded }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const clamp = (t: number) => Math.min(now, Math.max(TIME_MIN, t));
  const go = (t: number) => onChange(Math.floor(clamp(t) / STEP) * STEP);

  // Play: 10 minutes a step, each step only once the globe has drawn the last one (and at most every 0.7 s).
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(time);
  timeRef.current = time;
  useEffect(() => {
    if (!playing) return;
    let last = 0;
    const t = window.setInterval(() => {
      if (performance.now() - last < 700 || !isLoaded()) return;
      last = performance.now();
      const next = timeRef.current + STEP;
      if (next > Date.now() - STEP) { setPlaying(false); return; }
      onChange(next);
    }, 150);
    return () => clearInterval(t);
  }, [playing, onChange, isLoaded]);

  const iso = new Date(time).toISOString();
  const recent = now - time < 2 * DAY;
  const btn = 'h-7 shrink-0 rounded-[2px] border border-subtle bg-raised px-2 font-mono text-[10px] uppercase tracking-[0.06em] text-secondary transition-colors duration-200 ease-atlas hover:bg-hover hover:text-accent';

  return (
    <div className="pointer-events-auto mx-auto max-w-3xl rounded-[4px] border border-strong bg-panel/95 p-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Time
        </span>
        <button type="button" className={btn} onClick={() => go(time - DAY)} title="Back a day">−1d</button>
        <button type="button" className={btn} onClick={() => go(time - HOUR)} title="Back an hour">−1h</button>
        <button type="button" className={btn} onClick={() => go(time - STEP)} title="Back 10 minutes">−10m</button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
          className={`${btn} ${playing ? 'border-accent-muted text-accent' : ''}`}
          title="Play forward, 10 minutes a step"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className={btn} onClick={() => go(time + STEP)} title="Forward 10 minutes">+10m</button>
        <button type="button" className={btn} onClick={() => go(time + HOUR)} title="Forward an hour">+1h</button>
        <button type="button" className={btn} onClick={() => go(time + DAY)} title="Forward a day">+1d</button>
        <input
          type="datetime-local"
          aria-label="Go to a moment (your local time)"
          value={localInput(time)}
          min={localInput(TIME_MIN)}
          max={localInput(now)}
          onChange={(e) => { const t = new Date(e.target.value).getTime(); if (Number.isFinite(t)) go(t); }}
          className="h-7 min-w-0 rounded-[2px] border border-subtle bg-raised px-1.5 font-mono text-[11px] text-primary [color-scheme:dark]"
        />
        <span className="font-mono text-[11px] text-primary" title="The moment on the globe, UTC">{iso.slice(0, 10)} {iso.slice(11, 16)} UTC</span>
        <button
          type="button"
          onClick={onLive}
          className="ml-auto h-7 shrink-0 rounded-[2px] border border-accent-muted bg-accent-glow px-2.5 font-mono text-[10px] tracking-[0.08em] text-accent transition-colors duration-200 ease-atlas hover:bg-accent/20"
          title="Back to now (T)"
        >
          LIVE
        </button>
      </div>
      <input
        type="range"
        aria-label="Scrub the last two days"
        min={now - 2 * DAY}
        max={now}
        step={STEP}
        value={recent ? time : now - 2 * DAY}
        onChange={(e) => go(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--accent)]"
      />
      <p className="mt-1 font-mono text-[10px] leading-4 text-tertiary">
        Clouds every 10 min for recent weeks · the daily pass back to 2000 · quakes and events from the USGS and NASA archives ·
        flights, fires and launches are live only
      </p>
    </div>
  );
}
