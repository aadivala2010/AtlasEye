'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SENSES, type SenseId, type Sky } from '@/lib/sky';
import { IconCloud } from './icons';

const TOGGLES: { key: Exclude<keyof Sky, 'sense'>; label: string; note: string }[] = [
  { key: 'live', label: 'Live clouds', note: 'Five geostationary satellites, a new frame every 10–15 min' },
  { key: 'night', label: 'Night side', note: 'City lights wherever the sun is down right now' },
  { key: 'clouds', label: 'Daily pass', note: 'One day’s true-colour composite (NASA VIIRS, yesterday)' },
  { key: 'aurora', label: 'Aurora', note: 'NOAA’s aurora nowcast, updated every few minutes' },
  { key: 'lightning', label: 'Lightning', note: 'Europe, Africa & the Atlantic (Meteosat), every 5 min' },
  { key: 'terrain', label: '3D terrain', note: 'Mountains and buildings once zoomed in; right-drag to tilt' },
];

/** The cloud button: every imagery overlay, and one "sense" at a time. */
export default function SkyMenu({ sky, onChange }: { sky: Sky; onChange(next: Sky): void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const anyOn = sky.live || sky.night || sky.clouds || sky.aurora || sky.lightning || sky.sense !== null;
  const sense = sky.sense ? SENSES[sky.sense] : null;

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Sky layers"
        title="Sky: live clouds, night, aurora, lightning, senses"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 w-8 items-center justify-center rounded-[2px] border transition-colors duration-200 ease-atlas ${
          anyOn ? 'border-strong bg-raised text-primary hover:border-accent-muted' : 'border-subtle text-tertiary hover:text-secondary'}`}
      >
        <IconCloud width={14} height={14} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Sky layers"
          className="absolute right-0 top-10 z-40 max-h-[75dvh] w-72 overflow-y-auto rounded-[4px] border border-strong bg-panel p-3 shadow-[0_12px_32px_rgba(0,0,0,0.6)] max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:w-auto"
        >
          <Heading>Sky</Heading>
          <ul className="flex flex-col">
            {TOGGLES.map(({ key, label, note }) => (
              <Option key={key} on={sky[key]} label={label} note={note} role="switch" onClick={() => onChange({ ...sky, [key]: !sky[key] })} />
            ))}
          </ul>
          <Heading className="mt-3">Senses</Heading>
          <ul className="flex flex-col" role="radiogroup" aria-label="Senses">
            <Option on={sky.sense === null} label="Off" role="radio" onClick={() => onChange({ ...sky, sense: null })} />
            {(Object.keys(SENSES) as SenseId[]).map((id) => (
              <Option key={id} on={sky.sense === id} label={SENSES[id].label} role="radio" onClick={() => onChange({ ...sky, sense: id })} />
            ))}
          </ul>
          {sense && (
            <div className="mt-2 border-t border-subtle pt-2">
              <p className="text-[11px] leading-4 text-secondary">{sense.note}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- NASA's own legend SVG */}
              {sense.legend && <img src={sense.legend} alt={`${sense.label} legend`} className="mt-2 w-full rounded-[2px] bg-white/90 p-1" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Heading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`label mb-1 ${className}`}>{children}</div>;
}

function Option({ on, label, note, role, onClick }: { on: boolean; label: string; note?: string; role: 'switch' | 'radio'; onClick(): void }) {
  return (
    <li>
      <button
        type="button"
        role={role}
        aria-checked={on}
        onClick={onClick}
        className="flex w-full items-start gap-2 rounded-[2px] px-1.5 py-1 text-left transition-colors duration-200 ease-atlas hover:bg-hover"
      >
        <span className={`mt-[3px] h-2 w-2 shrink-0 border ${role === 'radio' ? 'rounded-full' : 'rounded-[1px]'} ${on ? 'border-accent bg-accent' : 'border-strong'}`} />
        <span className="min-w-0">
          <span className={`block font-mono text-[11px] ${on ? 'text-primary' : 'text-secondary'}`}>{label}</span>
          {note && <span className="block text-[10px] leading-[14px] text-tertiary">{note}</span>}
        </span>
      </button>
    </li>
  );
}
