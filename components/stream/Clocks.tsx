'use client';

import { useEffect, useState } from 'react';
import type { Stream } from '@/lib/stream';
import { localZone, zonedClock } from '@/lib/time';
import { subsolarPoint, sunAltitude } from '@/lib/solar';
import { IconMoon, IconSun } from '@/components/chrome/icons';

/** LOCAL (at the stream) and YOU, ticking every second. */
export default function Clocks({ stream }: { stream: Stream }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const there = zonedClock(now, stream.timezone);
  const here = zonedClock(now, localZone());
  const day = sunAltitude(stream.latitude, stream.longitude, subsolarPoint(now)) > -0.833;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2px] border border-subtle bg-subtle">
      <Clock label="Local" time={there.time} offset={there.offset}>
        {day
          ? <IconSun width={13} height={13} className="text-live" aria-label="Daytime there" />
          : <IconMoon width={13} height={13} className="text-night" aria-label="Night-time there" />}
      </Clock>
      <Clock label="You" time={here.time} offset={here.offset} />
    </div>
  );
}

function Clock({ label, time, offset, children }: { label: string; time: string; offset: string; children?: React.ReactNode }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {children}
      </div>
      <div className="mt-1 font-mono text-[26px] leading-8 tracking-tight text-primary" suppressHydrationWarning>{time}</div>
      <div className="font-mono text-[10px] text-tertiary">{offset}</div>
    </div>
  );
}
