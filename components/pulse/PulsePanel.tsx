'use client';

import { useEffect, useState } from 'react';
import type { PulseItem } from '@/lib/events';
import { IconButton } from '@/components/stream/StreamPanel';
import { IconClose } from '@/components/chrome/icons';

interface Props {
  items: PulseItem[];
  loading: boolean;
  notify: boolean;
  onNotify(on: boolean): void;
  /** Fly to it (and keep the list open). */
  onPick(item: PulseItem): void;
  /** Open what it's about: the aircraft, or a dossier on the spot. */
  onOpen(item: PulseItem): void;
  onClose(): void;
}

const KIND: Record<PulseItem['kind'], string> = { quake: 'Quake', emergency: 'Squawk', event: 'Event', launch: 'Launch', aurora: 'Aurora' };
const LEVEL = ['bg-strong', 'bg-quake', 'bg-emergency'] as const;

/** "12 min ago", "in 2 h 5 min". */
export function relTime(at: number, now: number): string {
  const d = at - now;
  const m = Math.round(Math.abs(d) / 60_000);
  if (m < 1) return 'now';
  const s = m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(m / 1440)} d`;
  return d > 0 ? `in ${s}` : `${s} ago`;
}

/** Everything notable happening on Earth right now, most urgent first. */
export default function PulsePanel({ items, loading, notify, onNotify, onPick, onOpen, onClose }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  useEffect(() => setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission), []);

  const toggleNotify = async () => {
    if (notify) { onNotify(false); return; }
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermission(p);
    onNotify(p === 'granted');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-subtle px-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-secondary">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-emergency" />
          Pulse
          <span className="text-tertiary">/ live on Earth</span>
        </div>
        <IconButton label="Close panel (Esc)" onClick={onClose}><IconClose /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <p className="text-[12px] leading-5 text-secondary">Earthquakes, emergencies, storms, eruptions, launches and space weather, as they happen.</p>
        </div>
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={toggleNotify}
            disabled={permission === 'unsupported' || permission === 'denied'}
            aria-pressed={notify}
            className={`h-7 rounded-[2px] border px-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200 ease-atlas disabled:opacity-50 ${
              notify ? 'border-accent-muted bg-accent-glow text-accent' : 'border-subtle text-secondary hover:text-primary'}`}
            title="A browser notification for each new critical event while this tab is in the background"
          >
            {permission === 'unsupported' ? 'Alerts unsupported' : permission === 'denied' ? 'Alerts blocked' : notify ? 'Alerting in background' : 'Alert me in background'}
          </button>
        </div>

        <ul className="mt-3 flex flex-col border-t border-subtle px-2 py-2">
          {items.length === 0 && (
            <li className="px-2 py-2 font-mono text-[11px] text-tertiary">
              {loading ? <span className="ellipsis">listening</span> : 'Quiet on Earth: nothing notable in the last day'}
            </li>
          )}
          {items.map((it) => (
            <li key={it.id} className="group flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => onPick(it)}
                className="flex min-w-0 flex-1 items-start gap-2.5 rounded-[2px] px-2 py-1.5 text-left transition-colors duration-200 ease-atlas hover:bg-hover"
              >
                <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL[it.level]}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-primary">{it.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-tertiary">{relTime(it.at, now)}</span>
                  </span>
                  <span className="block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-tertiary">
                    {KIND[it.kind]} · {it.detail}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onOpen(it)}
                title={it.hex ? 'Track the aircraft' : 'Dossier on the spot'}
                className="shrink-0 rounded-[2px] px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary opacity-60 transition-[opacity,color] duration-200 ease-atlas hover:text-accent group-hover:opacity-100"
              >
                {it.hex ? 'Track' : 'Open'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <footer className="shrink-0 border-t border-subtle px-4 py-2 font-mono text-[10px] text-tertiary">
        USGS · NASA EONET · adsb.lol · The Space Devs · NOAA SWPC
      </footer>
    </div>
  );
}
