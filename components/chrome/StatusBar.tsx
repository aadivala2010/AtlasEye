'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { utcClock } from '@/lib/time';
import { useReadout } from '@/lib/readout';

interface Props {
  total: number | null;
  builtAt: string | null;
  loading: boolean;
}

export default function StatusBar({ total, builtAt, loading }: Props) {
  const { cursor, zoom, inView } = useReadout();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <footer className="relative z-20 flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t border-subtle bg-panel px-4 max-sm:gap-2 max-sm:px-3 font-mono text-[10px] whitespace-nowrap text-secondary">
      {/* Readouts give way before the attribution does: it must stay visible at every width. */}
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden max-sm:gap-2">
      <span className="max-md:hidden">
        <F k="LAT">{cursor ? cursor.lat.toFixed(4) : '—'}</F>
        <F k="LON">{cursor ? cursor.lon.toFixed(4) : '—'}</F>
      </span>
      <F k="Z" className="max-sm:hidden">{zoom.toFixed(2)}</F>
      {loading ? (
        <span className="ellipsis text-accent">LOADING<span className="max-sm:hidden"> CATALOG</span></span>
      ) : (
        <>
          <F k="IN VIEW" className="max-sm:hidden">{inView ?? '—'}</F>
          <F k="CATALOG" className="max-sm:hidden">{total ?? '—'}</F>
        </>
      )}
      <F k="UTC" className="max-sm:hidden">{now ? utcClock(now) : '--:--:--'}</F>
      {builtAt && <F k="BUILT" className="max-xl:hidden">{builtAt.slice(0, 10)}</F>}
      </div>
      <a href="/about" className="shrink-0 text-tertiary transition-colors duration-200 ease-atlas hover:text-secondary">
        <span className="max-md:hidden">Imagery © Esri, Maxar, Earthstar Geographics · © OpenStreetMap · GeoNames CC BY 4.0 · Famelack · camlisted · Road cams: public agencies · via YouTube · Flights: adsb.lol (ODbL) · Weather: Open-Meteo · Terrain: Mapzen</span>
        <span className="md:hidden">©Esri·OSM·GeoNames·Famelack·camlisted·YouTube·adsb.lol·Open-Meteo</span>
      </a>
    </footer>
  );
}

function F({ k, children, className = '' }: { k: string; children: ReactNode; className?: string }) {
  return (
    <span className={`mr-3 inline-flex gap-1.5 last:mr-0 ${className}`}>
      <span className="text-tertiary">{k}</span>
      <span className="text-primary">{children}</span>
    </span>
  );
}
