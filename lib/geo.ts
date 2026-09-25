import type { Stream } from './stream';

const RAD = Math.PI / 180;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const h = Math.sin(((bLat - aLat) * RAD) / 2) ** 2
    + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(((bLon - aLon) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Streams ordered by distance from `origin`, origin first. */
export function byDistanceFrom(origin: Stream, streams: Stream[]): Stream[] {
  return streams
    .map((s) => ({ s, d: s.id === origin.id ? -1 : distanceKm(origin.latitude, origin.longitude, s.latitude, s.longitude) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s);
}

export function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`;
}

export function formatCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}
