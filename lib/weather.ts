import { useFeed } from './sources';

export interface Radar { host: string; radar: { past: { time: number; path: string }[] } }
export const NHC = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
// NHC/CPHC storm wallets: Atlantic, eastern and central Pacific; not worldwide coverage.
const wallets = Array.from({ length: 15 }, (_, i) => 7 + i * 26).flatMap((i) => [i, i + 1]);
export const CYCLONE_TILES = `${NHC}/export?f=image&format=png32&transparent=true&bboxSR=3857&imageSR=3857&size=256,256&layers=show:${wallets.join(',')}&bbox={bbox-epsg-3857}`;
export function useWarnings(on: boolean, point?: { lat: number; lon: number }) {
  return useFeed('NWS weather alerts', on ? `/api/weather${point ? `?lat=${point.lat.toFixed(3)}&lon=${point.lon.toFixed(3)}` : ''}` : null, 120_000,
    (j: GeoJSON.FeatureCollection) => { if (!Array.isArray(j.features)) throw new Error('Invalid alerts'); return j; });
}
export function useRadar(on: boolean) {
  return useFeed('RainViewer radar frames', on ? 'https://api.rainviewer.com/public/weather-maps.json' : null, 600_000, (j: Radar) => {
    if (!/^https:\/\/(?:[\w-]+\.)*rainviewer\.com$/.test(j.host) || !Array.isArray(j.radar?.past) || !j.radar.past.every((p) => Number.isFinite(p.time) && /^\/v2\/radar\/[a-zA-Z0-9_-]+$/.test(p.path))) throw new Error('Invalid radar');
    return j;
  });
}
