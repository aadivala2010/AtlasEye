'use client';

import { useEffect, useState } from 'react';
import { downloadJson, KINDS, matchesAlert, measurement, parseCoordinates, type AlertFilter, type MeasureMode, type Place, type WeatherLayers } from '@/lib/explore';
import { firstPoint, importData, MAX_FILE_BYTES } from '@/lib/import-data';
import type { PulseItem } from '@/lib/events';
import { useSources } from '@/lib/sources';
import type { Radar } from '@/lib/weather';
import ImageryHistory from '@/components/dossier/ImageryHistory';

export interface ImportedLayer { id: string; name: string; data: GeoJSON.FeatureCollection; visible: boolean }
export interface ExplorePoint { lat: number; lon: number; name: string; event?: PulseItem }
export type ExploreTab = 'places' | 'alerts' | 'weather' | 'imagery' | 'tools' | 'sources';
interface Props {
  point: ExplorePoint;
  initialTab?: ExploreTab;
  places: Place[]; onPlaces(places: Place[]): void; storageError: boolean;
  filter: AlertFilter; onFilter(filter: AlertFilter): void;
  events: PulseItem[]; notify: boolean; onNotify(on: boolean): void;
  weather: WeatherLayers; onWeather(w: WeatherLayers): void; warnings: GeoJSON.FeatureCollection | null; radar: Radar | null;
  imports: ImportedLayer[]; onImports(layers: ImportedLayer[]): void;
  measureMode: MeasureMode; points: [number, number][]; onMeasure(mode: MeasureMode): void; onPoints(points: [number, number][]): void;
  onGo(lat: number, lon: number): void; onShare(): Promise<boolean>; onClose(): void;
}
const TAB_LABELS = { places: 'Places', alerts: 'Alerts', weather: 'Weather', imagery: 'Imagery', tools: 'Tools', sources: 'Sources' };

export default function ExplorePanel(p: Props) {
  const [tab, setTab] = useState<ExploreTab>(p.initialTab ?? 'places');
  const [name, setName] = useState(p.point.name), [radius, setRadius] = useState(100), [message, setMessage] = useState('');
  const [coords, setCoords] = useState(''), [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sources = useSources();
  const [permission, setPermission] = useState('default');
  useEffect(() => { setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const toggleAlerts = async () => {
    if (p.notify) { p.onNotify(false); return; }
    try { const value = await Notification.requestPermission(); setPermission(value); p.onNotify(value === 'granted'); }
    catch { setMessage('This browser cannot display desktop notifications.'); }
  };
  const distance = measurement(p.points);
  const savePlace = () => {
    if (!name.trim()) { setMessage('Give this place a name.'); return; }
    if (p.places.length >= 50) { setMessage('You can save up to 50 places.'); return; }
    p.onPlaces([...p.places, { id: crypto.randomUUID(), name: name.trim().slice(0, 80), lat: p.point.lat, lon: p.point.lon, radius }]); setMessage('Place saved on this device.');
  };
  const exportPoint = () => downloadJson('atlas-eye-location.geojson', { type: 'FeatureCollection', features: [{ type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.point.lon, p.point.lat] }, properties: { name: p.point.name, ...p.point.event, exportedAt: new Date().toISOString(), source: window.location.href } }] });
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setMessage('Choose a file smaller than 5 MB.'); return; }
    if (p.imports.length >= 5) { setMessage('Remove an overlay before adding another (maximum five).'); return; }
    setBusy(true);
    try {
      const data = importData(await file.text(), file.name);
      p.onImports([...p.imports, { id: crypto.randomUUID(), name: file.name, data, visible: true }]);
      const first = firstPoint(data); if (first) p.onGo(first[1], first[0]);
      setMessage(`Loaded ${data.features.length} features locally.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to read that file.'); }
    finally { setBusy(false); }
  };
  return <div className="explore flex h-full flex-col">
    <div className="flex shrink-0 items-center justify-between border-b border-subtle px-4 py-2"><h2 className="text-sm">Explore</h2><button type="button" onClick={p.onClose} aria-label="Close Explore">×</button></div>
    <nav aria-label="Explore sections" className="grid shrink-0 grid-cols-3 gap-1 border-b border-subtle p-2">{(Object.keys(TAB_LABELS) as ExploreTab[]).map((t) => <button type="button" key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setMessage(''); }}>{TAB_LABELS[t]}</button>)}</nav>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <div className="mb-4"><div className="truncate text-sm text-primary">{p.point.name}</div><div className="text-xs text-secondary">{p.point.lat.toFixed(5)}, {p.point.lon.toFixed(5)}</div></div>
      {tab === 'places' && <>
        <section className="explore-section"><h3>Save this place</h3><label>Name<input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Watch radius<select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{[10, 25, 50, 100, 250, 500, 1000, 2000].map((n) => <option key={n} value={n}>{n} km</option>)}</select></label>
          <button type="button" onClick={savePlace}>Save place</button><p>Saved only in this browser. Watch circles and nearby events appear on the globe. Up to 50 places.</p>
          {p.storageError && <p role="alert">Browser storage is unavailable. Changes will last only for this visit.</p>}
        </section>
        <section className="explore-section"><h3>Your places</h3>{!p.places.length && <p>Search for a place or open a Dossier, then save it here.</p>}
          {p.places.map((place) => <div key={place.id} className="rounded border border-strong p-3">
            <button type="button" className="w-full text-left" onClick={() => p.onGo(place.lat, place.lon)}>{place.name}</button>
            <p>{place.radius} km watch zone · {p.events.filter((e) => matchesAlert(e, { level: 0, kinds: [...KINDS], placeId: place.id }, [place])).length} reported events</p>
            <label>Radius<select value={place.radius} onChange={(e) => p.onPlaces(p.places.map((x) => x.id === place.id ? { ...x, radius: Number(e.target.value) } : x))}>{[10, 25, 50, 100, 250, 500, 1000, 2000].map((n) => <option key={n} value={n}>{n} km</option>)}</select></label>
            <div className="flex gap-2"><button type="button" onClick={() => { p.onFilter({ ...p.filter, placeId: place.id }); setTab('alerts'); }}>Watch events</button><button type="button" aria-label={`Remove ${place.name}`} onClick={() => { p.onPlaces(p.places.filter((x) => x.id !== place.id)); if (p.filter.placeId === place.id) p.onFilter({ ...p.filter, placeId: '' }); }}>Remove</button></div>
          </div>)}
        </section>
      </>}
      {tab === 'alerts' && <section className="explore-section"><h3>Personal alerts</h3><p>New matching events can notify you while this tab stays open in the background. Delivery may pause if your browser sleeps. Existing events do not trigger a burst when enabled.</p>
        <label>Minimum severity<select value={p.filter.level} onChange={(e) => p.onFilter({ ...p.filter, level: Number(e.target.value) })}><option value={0}>All reported events</option><option value={1}>Notable and critical</option><option value={2}>Critical only</option></select></label>
        <label>Area<select value={p.filter.placeId} onChange={(e) => p.onFilter({ ...p.filter, placeId: e.target.value })}><option value="">Worldwide</option>{p.places.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.radius} km</option>)}</select></label>
        <fieldset><legend className="mb-2 text-secondary">Event types</legend><div className="grid grid-cols-2 gap-2">{KINDS.map((k) => <label key={k} className="flex min-h-11 items-center gap-2 capitalize"><input type="checkbox" checked={p.filter.kinds.includes(k)} onChange={(e) => p.onFilter({ ...p.filter, kinds: e.target.checked ? [...p.filter.kinds, k] : p.filter.kinds.filter((x) => x !== k) })} />{({ quake: 'Earthquakes', event: 'Natural events', emergency: 'Aircraft alerts', launch: 'Launches', aurora: 'Aurora' })[k]}</label>)}</div></fieldset>
        <button type="button" disabled={['denied', 'unsupported'].includes(permission)} aria-pressed={p.notify} onClick={toggleAlerts}>{p.notify ? 'Turn alerts off' : permission === 'denied' ? 'Notifications blocked in browser settings' : permission === 'unsupported' ? 'Notifications unavailable in this browser' : 'Enable browser alerts'}</button>
        <p>{p.events.filter((e) => matchesAlert(e, p.filter, p.places)).length} current events match these settings.</p>
      </section>}
      {tab === 'weather' && <section className="explore-section"><h3>Weather risks</h3>
        {(['alerts', 'cyclones', 'radar'] as const).map((key) => <label key={key} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={p.weather[key]} onChange={(e) => p.onWeather({ ...p.weather, [key]: e.target.checked })} />{({ alerts: 'Official U.S. weather alerts', cyclones: 'Cyclone forecast tracks and cones', radar: 'Latest weather radar' })[key]}</label>)}
        <p>NWS warnings: U.S. and territories. Some alerts have no polygon; they remain in the list. NHC/CPHC forecasts: Atlantic, eastern and central Pacific. Cones show uncertainty in the storm’s center, not its full impact area.</p>
        <p>Radar: RainViewer coverage varies; an empty area does not mean clear weather. {p.radar?.radar.past.at(-1) && `Latest composite frame: ${new Date(p.radar.radar.past.at(-1)!.time * 1000).toUTCString()}.`}</p>
        <p>Lightning is available in Sky for Europe, Africa and the Atlantic via EUMETSAT.</p>
        <div className="flex flex-wrap gap-3"><a href="https://www.weather.gov/" target="_blank" rel="noopener noreferrer">NWS advisories ↗</a><a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener noreferrer">NHC forecasts ↗</a><a href="https://www.rainviewer.com/coverage.html" target="_blank" rel="noopener noreferrer">Radar coverage ↗</a></div>
        {p.weather.alerts && <><h3>Reported warnings</h3>{!p.warnings ? <p>{sources.find((s) => s.id === 'NWS weather alerts')?.error ? 'Warnings are temporarily unavailable. Retrying automatically.' : 'Loading warnings…'}</p> : !p.warnings.features.length ? <p>No active warnings returned by NWS.</p> : p.warnings.features.map((f, i) => <details key={String(f.id ?? i)} className="border-b border-subtle py-2"><summary>{String(f.properties?.event)} · {String(f.properties?.severity)}</summary><p>{String(f.properties?.headline ?? f.properties?.areaDesc)}</p><p className="whitespace-pre-line">{String(f.properties?.instruction ?? f.properties?.description ?? '')}</p><p>Expires {String(f.properties?.expires ?? 'not specified')}</p>{f.geometry && <button type="button" onClick={() => { const pt = firstPoint({ type: 'FeatureCollection', features: [f] }); if (pt) p.onGo(pt[1], pt[0]); }}>Show warning area</button>}</details>)}</>}
      </section>}
      {tab === 'imagery' && <ImageryHistory lat={p.point.lat} lon={p.point.lon} />}
      {tab === 'tools' && <>
        <section className="explore-section"><h3>Share and export</h3><div className="flex flex-wrap gap-2"><button type="button" onClick={async () => setMessage(await p.onShare() ? 'View link copied. Saved places and local overlays are private and excluded.' : 'Copy the view link from your address bar.')}>Copy view link</button><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${p.point.lat.toFixed(5)}, ${p.point.lon.toFixed(5)}`); setMessage('Coordinates copied.'); } catch { setMessage('Copy the coordinates shown above.'); } }}>Copy coordinates</button><button type="button" onClick={exportPoint}>Export location / event</button></div></section>
        <section className="explore-section"><h3>Measure on the globe</h3><p>Choose a mode, then tap the globe to add vertices. You can also add latitude, longitude below. Measurements are approximate on a spherical Earth.</p><div className="flex gap-2">{(['off', 'distance', 'area'] as const).map((m) => <button type="button" key={m} aria-pressed={p.measureMode === m} onClick={() => p.onMeasure(m)}>{m === 'off' ? 'Stop' : m === 'area' ? 'Area' : 'Distance'}</button>)}</div>
          <p aria-live="polite">{p.points.length} points · {distance.km.toFixed(2)} km{p.points.length >= 3 ? ` · ${distance.km2.toFixed(2)} km² enclosed` : ''}</p>
          <form onSubmit={(e) => { e.preventDefault(); const pt = parseCoordinates(coords); if (pt && p.points.length < 100) { p.onPoints([...p.points, [pt.lon, pt.lat]]); setCoords(''); } else setMessage('Enter latitude, longitude (maximum 100 points).'); }}><label>Add a vertex<input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="40.7, -74.0" /></label><button type="submit">Add point</button></form>
          <div className="flex gap-2"><button type="button" disabled={!p.points.length} onClick={() => p.onPoints(p.points.slice(0, -1))}>Undo point</button><button type="button" disabled={!p.points.length} onClick={() => p.onPoints([])}>Clear</button></div>
        </section>
        <section className="explore-section"><h3>Import a map overlay</h3><p>GeoJSON, KML or CSV with latitude/longitude columns. Files stay on this device for this visit. Up to 5 MB, 5,000 features and 50,000 coordinates per file.</p>
          <label>Choose overlay<input type="file" accept=".geojson,.json,.kml,.csv" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {p.imports.map((layer) => <div key={layer.id} className="flex items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={layer.visible} onChange={(e) => p.onImports(p.imports.map((x) => x.id === layer.id ? { ...x, visible: e.target.checked } : x))} /><span className="truncate">{layer.name}</span></label><button type="button" aria-label={`Remove ${layer.name}`} onClick={() => p.onImports(p.imports.filter((x) => x.id !== layer.id))}>Remove</button></div>)}
        </section>
      </>}
      {tab === 'sources' && <section className="explore-section"><h3>Source health this visit</h3><p>Last successful response is when this browser fetched the source, not when observations were made. Disabled layers stop refreshing. Cached feeds may contain older observations; satellite elements show their age in the satellite panel.</p>
        {[...sources].sort((a, b) => a.id.localeCompare(b.id)).map((s) => <div key={s.id} className="border-b border-subtle py-2"><div className="flex justify-between gap-3"><span>{s.id}</span><span className={s.error ? 'text-dead' : 'text-secondary'}>{s.error ? s.at ? 'Delayed · last data kept' : 'Unavailable' : s.loading ? 'Loading' : s.interval && s.at && now - s.at > s.interval * 3 ? 'Old / paused' : s.at ? 'Received' : 'Not loaded'}</span></div><p>{s.at ? `Last response ${new Date(s.at).toLocaleTimeString()}` : 'No successful response yet'} · {s.interval ? `Refresh ${s.interval < 60000 ? `${s.interval / 1000}s` : `${Math.round(s.interval / 60000)}m`}` : 'Loaded on demand'}</p></div>)}
      </section>}
      {message && <p role="status" className="sticky bottom-0 mt-3 rounded border border-accent-muted bg-panel p-3 text-accent">{message}</p>}
    </div>
  </div>;
}
