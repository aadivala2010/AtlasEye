'use client';

import { useState } from 'react';
import { wrapLon } from '@/lib/explore';

export default function ImageryHistory({ lat, lon }: { lat: number; lon: number }) {
  const day = (offset: number) => new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);
  const [before, setBefore] = useState(day(8));
  const [after, setAfter] = useState(day(1));
  const [mix, setMix] = useState(50);
  const [span, setSpan] = useState(2);
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  // A fixed geographic box for both dates keeps the comparison aligned, including near the poles.
  const y = Math.max(-90 + span / 2, Math.min(90 - span / 2, lat));
  const x = Math.max(-180 + span / 2, Math.min(180 - span / 2, wrapLon(lon)));
  const bbox = [x - span / 2, y - span / 2, x + span / 2, y + span / 2].join(',');
  const image = (date: string) => `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: 'MODIS_Terra_CorrectedReflectance_TrueColor', STYLES: '', FORMAT: 'image/png', TRANSPARENT: 'false', SRS: 'EPSG:4326', BBOX: bbox, WIDTH: '640', HEIGHT: '640', TIME: date })}`;
  const valid = (d: string) => /^\d{4}-\d\d-\d\d$/.test(d) && d >= '2000-02-24' && d <= day(0);
  const urls = [before, after].map(image);
  return <section className="explore-section">
    <h3>Satellite imagery history</h3>
    <p>Daily NASA MODIS Terra imagery, not live cameras. Clouds and missing swaths may hide the ground; today’s pass may be incomplete. The view covers approximately {Math.round(span * 111)} km north to south.</p>
    <div className="grid grid-cols-2 gap-3">
      <label>Before<input type="date" min="2000-02-24" max={day(0)} value={before} onChange={(e) => setBefore(e.target.value)} /></label>
      <label>After<input type="date" min="2000-02-24" max={day(0)} value={after} onChange={(e) => setAfter(e.target.value)} /></label>
    </div>
    <div className="flex flex-wrap gap-2">{[1, 7, 30].map((d) => <button key={d} type="button" onClick={() => { setBefore(day(d + 1)); setAfter(day(1)); }}>Compare {d === 1 ? 'yesterday' : `${d} days`}</button>)}</div>
    <label>Area size<select value={span} onChange={(e) => setSpan(Number(e.target.value))}><option value={.5}>Local — 55 km</option><option value={2}>Region — 220 km</option><option value={8}>Wide — 890 km</option></select></label>
    {valid(before) && valid(after) ? <>
      <div className="relative aspect-square overflow-hidden rounded border border-strong bg-void">
        {urls.map((url, i) => <img key={`${i}:${url}`} src={url} alt={`NASA satellite imagery for ${i ? after : before}`} className="absolute inset-0 h-full w-full object-contain" style={i ? { clipPath: `inset(0 0 0 ${mix}%)` } : undefined}
          onLoad={() => setLoaded((v) => [...v.filter((x) => urls.includes(x)), url])} onError={() => setFailed((v) => [...v.filter((x) => urls.includes(x)), url])} />)}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: `${mix}%` }} />
        <div className="absolute top-2 left-2 bg-void/90 p-1 text-xs">{before}</div><div className="absolute top-2 right-2 bg-void/90 p-1 text-xs">{after}</div>
      </div>
      <label>Comparison divider<input type="range" min="0" max="100" value={mix} onChange={(e) => setMix(Number(e.target.value))} /></label>
      <p role="status">{urls.some((u) => failed.includes(u)) ? 'Imagery could not be loaded. Try another date.' : urls.every((u) => loaded.includes(u)) ? 'Left: before · Right: after. Black areas may mean no observation.' : 'Loading both daily images…'}</p>
    </> : <p role="alert">Choose dates from February 24, 2000 through today.</p>}
    <a href={`https://worldview.earthdata.nasa.gov/?v=${bbox}&t=${after}`} target="_blank" rel="noopener noreferrer">Explore this area in NASA Worldview ↗</a>
  </section>;
}
