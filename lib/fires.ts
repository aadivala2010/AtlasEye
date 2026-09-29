/** Fire detections on a ~2 km grid: flat [lat, lon, FRP (MW), …]. Kept apart from lib/events (React), so the API route can use it. */
export interface Fires { at: number; f: number[] }

/**
 * NASA FIRMS's 24-hour CSV → fire detections binned on a `step`° grid (FRP summed per cell), low
 * confidence dropped. 114k rows / 9.5 MB become ~47k cells / ~250 KB gzipped at 0.02°.
 */
export function binFires(csv: string, step = 0.02): Fires {
  const lines = csv.split('\n');
  const head = lines[0].split(',');
  const col = (name: string) => head.indexOf(name);
  const [iLat, iLon, iFrp, iConf, iDate, iTime] = ['latitude', 'longitude', 'frp', 'confidence', 'acq_date', 'acq_time'].map(col);
  const cells = new Map<string, number[]>();
  let newest = 0;
  for (let n = 1; n < lines.length; n++) {
    const v = lines[n].split(',');
    if (v.length < head.length || v[iConf] === 'low' || v[iConf] === 'l') continue;
    const lat = Math.round(Number(v[iLat]) / step);
    const lon = Math.round(Number(v[iLon]) / step);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const at = Date.parse(`${v[iDate]}T${v[iTime].padStart(4, '0').replace(/(\d\d)(\d\d)/, '$1:$2')}:00Z`);
    if (at > newest) newest = at;
    const k = `${lat},${lon}`;
    const c = cells.get(k);
    if (c) c[2] += Number(v[iFrp]) || 0;
    else cells.set(k, [lat, lon, Number(v[iFrp]) || 0]);
  }
  const f: number[] = [];
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (const [lat, lon, frp] of cells.values()) f.push(r2(lat * step), r2(lon * step), Math.round(frp * 10) / 10);
  return { at: newest, f };
}
