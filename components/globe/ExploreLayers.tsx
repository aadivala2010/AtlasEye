'use client';

import { useEffect, useRef } from 'react';
import type { GeoJSONSource, Map as MLMap, RasterTileSource } from 'maplibre-gl';
import { trailGeometry, wrapLon, type Fix, type MeasureMode, type Place, type WeatherLayers } from '@/lib/explore';
import { CYCLONE_TILES, type Radar } from '@/lib/weather';
import { sourceStatus } from '@/lib/sources';
import type { ImportedLayer } from '@/components/explore/ExplorePanel';

export interface ExploreMapProps {
  places: Place[]; imports: ImportedLayer[]; trail: Fix[];
  measureMode: MeasureMode; points: [number, number][]; onMeasurePoint(lon: number, lat: number): void;
  weather: WeatherLayers; warnings: GeoJSON.FeatureCollection | null; radar: Radar | null;
}
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const feature = (geometry: GeoJSON.Geometry, properties: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: 'Feature', geometry, properties });
function raster(map: MLMap, id: string, url: string, maxzoom: number) {
  const source = map.getSource<RasterTileSource>(id);
  if (source) source.setTiles([url]);
  else {
    map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, maxzoom });
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': .65, 'raster-fade-duration': 200 } }, 'fires');
  }
  map.setLayoutProperty(id, 'visibility', 'visible');
}

function circle(place: Place): GeoJSON.Feature {
  const lat = place.lat * Math.PI / 180, lon = place.lon * Math.PI / 180, distance = place.radius / 6371;
  const coordinates = Array.from({ length: 65 }, (_, i) => {
    const bearing = i / 64 * 2 * Math.PI;
    const y = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
    const x = lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(y));
    // Keep the ring continuous across the dateline.
    return [place.lon + wrapLon(x * 180 / Math.PI - place.lon), y * 180 / Math.PI];
  });
  return feature({ type: 'LineString', coordinates }, { name: place.name });
}

export default function ExploreLayers({ map, ...p }: ExploreMapProps & { map: MLMap | null }) {
  const measureShape = useRef<MeasureMode>('distance');
  const lastOk = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!map) return;
    for (const id of ['watch-zones', 'user-overlays', 'measure', 'flight-trail', 'weather-warnings']) map.addSource(id, { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'watch-zones', type: 'line', source: 'watch-zones', paint: { 'line-color': '#4DE1FF', 'line-width': 1, 'line-dasharray': [3, 3], 'line-opacity': .6 } });
    for (const [id, color] of [['user-overlays', '#7CE3C4'], ['measure', '#4DE1FF'], ['weather-warnings', '#FFB547']]) {
      map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': color, 'fill-opacity': .17 } });
      map.addLayer({ id: `${id}-line`, type: 'line', source: id, filter: ['!=', '$type', 'Point'], paint: { 'line-color': color, 'line-width': 2 } });
      map.addLayer({ id: `${id}-point`, type: 'circle', source: id, filter: ['==', '$type', 'Point'], paint: { 'circle-color': color, 'circle-radius': 5, 'circle-stroke-color': '#040508', 'circle-stroke-width': 1 } });
    }
    map.addLayer({ id: 'flight-trail', type: 'line', source: 'flight-trail', paint: { 'line-color': '#FFB547', 'line-width': 2, 'line-opacity': .8 } });
    const health = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      const id = e.sourceId;
      if ((id === 'weather-cyclones' || id === 'weather-radar') && e.isSourceLoaded && Date.now() - (lastOk.current[id] ?? 0) > 30_000) {
        lastOk.current[id] = Date.now(); sourceStatus(id === 'weather-cyclones' ? 'NHC forecast map' : 'RainViewer radar tiles', 600_000, 'ok');
      }
    };
    const error = (e: { sourceId?: string }) => { if (e.sourceId?.startsWith('weather-')) sourceStatus(e.sourceId === 'weather-cyclones' ? 'NHC forecast map' : 'RainViewer radar tiles', 600_000, 'error'); };
    map.on('sourcedata', health); map.on('error', error);
    return () => {
      map.off('sourcedata', health); map.off('error', error);
      if (!map.getStyle()) return;
      for (const id of ['watch-zones', 'user-overlays', 'measure', 'flight-trail', 'weather-warnings', 'weather-radar', 'weather-cyclones']) {
        for (const layer of [id, `${id}-fill`, `${id}-line`, `${id}-point`]) if (map.getLayer(layer)) map.removeLayer(layer);
        if (map.getSource(id)) map.removeSource(id);
      }
    };
  }, [map]);
  useEffect(() => {
    if (!map) return;
    map.getSource<GeoJSONSource>('watch-zones')?.setData({ type: 'FeatureCollection', features: p.places.map(circle) });
  }, [map, p.places]);
  useEffect(() => { map?.getSource<GeoJSONSource>('user-overlays')?.setData({ type: 'FeatureCollection', features: p.imports.filter((l) => l.visible).flatMap((l) => l.data.features) }); }, [map, p.imports]);
  useEffect(() => { map?.getSource<GeoJSONSource>('flight-trail')?.setData(feature(trailGeometry(p.trail))); }, [map, p.trail]);
  useEffect(() => {
    if (!map) return;
    if (p.measureMode !== 'off') measureShape.current = p.measureMode;
    const features = p.points.map((pt) => feature({ type: 'Point', coordinates: pt }));
    const points: number[][] = [];
    for (const [x, y] of p.points) points.push([points.length ? points.at(-1)![0] + wrapLon(x - points.at(-1)![0]) : x, y]);
    if (points.length > 1) features.push(feature({ type: 'LineString', coordinates: points }));
    if (points.length > 2 && measureShape.current === 'area') features.push(feature({ type: 'Polygon', coordinates: [[...points, points[0]]] }));
    map.getSource<GeoJSONSource>('measure')?.setData({ type: 'FeatureCollection', features });
    if (p.measureMode !== 'off') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  }, [map, p.points, p.measureMode]);
  useEffect(() => { map?.getSource<GeoJSONSource>('weather-warnings')?.setData(p.weather.alerts ? p.warnings ?? EMPTY : EMPTY); }, [map, p.weather.alerts, p.warnings]);
  useEffect(() => {
    if (!map) return;
    const frame = p.radar?.radar.past.at(-1);
    if (frame && p.weather.radar) {
      lastOk.current['weather-radar'] = 0;
      sourceStatus('RainViewer radar tiles', 600_000, 'loading');
      raster(map, 'weather-radar', `${p.radar!.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, 7);
    } else if (map.getLayer('weather-radar')) map.setLayoutProperty('weather-radar', 'visibility', 'none');
  }, [map, p.weather.radar, p.radar]);
  useEffect(() => {
    if (!map) return;
    if (p.weather.cyclones) {
      const update = () => { lastOk.current['weather-cyclones'] = 0; sourceStatus('NHC forecast map', 600_000, 'loading'); raster(map, 'weather-cyclones', `${CYCLONE_TILES}&_=${Math.floor(Date.now() / 600_000)}`, 8); };
      update();
      const timer = setInterval(update, 600_000); return () => clearInterval(timer);
    }
    if (map.getLayer('weather-cyclones')) map.setLayoutProperty('weather-cyclones', 'visibility', 'none');
  }, [map, p.weather.cyclones]);
  return null;
}
