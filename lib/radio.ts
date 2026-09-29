import { useEffect, useState } from 'react';
import { distanceKm } from './geo';

/** One live radio station with a place on the map (Radio Browser, HTTPS streams only). */
export interface Station {
  /** Radio Browser's station UUID. */
  id: string;
  name: string;
  /** The resolved stream URL (https, so it plays on an https page). */
  url: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2. */
  cc: string;
  tags: string;
  codec: string;
  kbps: number;
}

export interface RadioCatalog { builtAt: string; count: number; stations: Station[] }

/** Stations within `maxKm` of a point, nearest first. */
export function nearestStations(stations: Station[], lat: number, lon: number, n: number, maxKm = Infinity): { s: Station; d: number }[] {
  return stations
    .map((s) => ({ s, d: distanceKm(lat, lon, s.lat, s.lon) }))
    .filter((x) => x.d <= maxKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

/** The station catalog, fetched once the first time it's wanted (~10k stations). */
export function useRadio(on: boolean): Station[] | null {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [wanted, setWanted] = useState(false);
  useEffect(() => { if (on) setWanted(true); }, [on]);
  useEffect(() => {
    if (!wanted) return;
    const ctrl = new AbortController();
    fetch('/data/radio.json', { signal: ctrl.signal })
      .then((r) => r.json() as Promise<RadioCatalog>)
      .then((c) => setStations(c.stations))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [wanted]);
  return stations;
}
