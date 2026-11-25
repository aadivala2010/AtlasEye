'use client';
import { useEffect, useRef } from 'react';
import type { GeoJSONSource, Map as MLMap, MapLayerMouseEvent } from 'maplibre-gl';
import { INTEL_CATEGORIES, type IntelEvent } from '@/lib/intel';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
export default function IntelLayers({ map, events, onPick, reducedMotion }: { map: MLMap | null; events: IntelEvent[]; onPick(event: IntelEvent): void; reducedMotion: boolean }) {
  const current = useRef({ events, onPick, reducedMotion }); current.current = { events, onPick, reducedMotion };
  useEffect(() => {
    if (!map) return;
    map.addSource('intel', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 44, clusterMaxZoom: 9 });
    map.addLayer({ id: 'intel-clusters', type: 'circle', source: 'intel', filter: ['has', 'point_count'], paint: { 'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20], 'circle-color': '#1B5567', 'circle-stroke-color': '#78CBD5', 'circle-stroke-width': 1 } });
    const glyphs = map.getStyle().glyphs;
    if (glyphs) map.addLayer({ id: 'intel-counts', type: 'symbol', source: 'intel', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': (map.getLayer('places') ? map.getLayoutProperty('places', 'text-font') : ['Open Sans Regular']) as string[], 'text-size': 10 }, paint: { 'text-color': '#E6EAF2' } });
    map.addLayer({ id: 'intel-points', type: 'circle', source: 'intel', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#040508', 'circle-stroke-width': 2 } });
    const click = async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]; if (f?.geometry.type !== 'Point') return;
      if (f.properties.cluster) {
        try {
          const zoom = await map.getSource<GeoJSONSource>('intel')?.getClusterExpansionZoom(f.properties.cluster_id);
          if (zoom !== undefined) map.easeTo({ center: f.geometry.coordinates as [number, number], zoom, duration: current.current.reducedMotion ? 0 : 500 });
        } catch { /* source removed while expanding */ }
      } else { const item = current.current.events.find(item => item.id === f.properties.id); if (item) current.current.onPick(item); }
    };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; }, leave = () => { map.getCanvas().style.cursor = ''; };
    for (const layer of ['intel-clusters', 'intel-points']) { map.on('click', layer, click); map.on('mouseenter', layer, enter); map.on('mouseleave', layer, leave); }
    return () => {
      for (const layer of ['intel-clusters', 'intel-points']) { map.off('click', layer, click); map.off('mouseenter', layer, enter); map.off('mouseleave', layer, leave); }
      if (!map.getStyle()) return;
      for (const layer of ['intel-counts', 'intel-clusters', 'intel-points']) if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource('intel')) map.removeSource('intel');
    };
  }, [map]);
  useEffect(() => {
    map?.getSource<GeoJSONSource>('intel')?.setData({ type: 'FeatureCollection', features: events.filter(e => e.lat !== null && e.lon !== null).map(e => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon!, e.lat!] }, properties: { id: e.id, color: INTEL_CATEGORIES[e.category].color } })) });
  }, [map, events]);
  return null;
}
