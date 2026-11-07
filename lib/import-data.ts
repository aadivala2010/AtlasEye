import { validPoint } from './explore';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_POSITIONS = 50_000;

/** Validate and copy geometry only: never execute styles, HTML, URLs, or KML network links. */
export function validateGeoJSON(input: unknown): GeoJSON.FeatureCollection {
  let count = 0;
  const position = (v: unknown): number[] => {
    if (!Array.isArray(v) || v.length < 2 || v.length > 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n)) || !validPoint(v[1], v[0])) throw new Error('Coordinates must be longitude, latitude in WGS84.');
    if (++count > MAX_POSITIONS) throw new Error('Use a smaller file (maximum 50,000 coordinates).');
    return v.slice(0, 2);
  };
  const line = (v: unknown, min = 2): number[][] => {
    if (!Array.isArray(v) || v.length < min) throw new Error('A line needs two points; a polygon ring needs four.');
    return v.map(position);
  };
  const polygon = (v: unknown): number[][][] => {
    if (!Array.isArray(v) || !v.length) throw new Error('Empty polygon.');
    return v.map((r) => {
      const ring = line(r, 4);
      if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) throw new Error('Polygon rings must be closed.');
      return ring;
    });
  };
  const geometry = (v: unknown, depth = 0): GeoJSON.Geometry => {
    if (!v || typeof v !== 'object' || depth > 4) throw new Error('Invalid geometry.');
    const g = v as { type: string; coordinates: unknown; geometries: unknown[] };
    switch (g.type) {
      case 'Point': return { type: g.type, coordinates: position(g.coordinates) };
      case 'MultiPoint': return { type: g.type, coordinates: line(g.coordinates, 1) };
      case 'LineString': return { type: g.type, coordinates: line(g.coordinates) };
      case 'MultiLineString':
        if (!Array.isArray(g.coordinates)) throw new Error('Invalid lines.');
        return { type: g.type, coordinates: g.coordinates.map((l) => line(l)) };
      case 'Polygon': return { type: g.type, coordinates: polygon(g.coordinates) };
      case 'MultiPolygon':
        if (!Array.isArray(g.coordinates)) throw new Error('Invalid polygons.');
        return { type: g.type, coordinates: g.coordinates.map(polygon) };
      case 'GeometryCollection':
        if (!Array.isArray(g.geometries) || g.geometries.length > 5000) throw new Error('Invalid geometry collection.');
        return { type: g.type, geometries: g.geometries.map((x) => geometry(x, depth + 1)) };
      default: throw new Error('Unsupported geometry. Use points, lines, or polygons.');
    }
  };
  if (!input || typeof input !== 'object') throw new Error('Expected GeoJSON.');
  const root = input as { type: string; features?: unknown[] };
  const features = root.type === 'FeatureCollection' ? root.features : root.type === 'Feature' ? [root] : [{ type: 'Feature', geometry: root }];
  if (!Array.isArray(features) || !features.length || features.length > 5000) throw new Error('Use 1–5,000 features per file.');
  return { type: 'FeatureCollection', features: features.map((v, i) => {
    if (!v || typeof v !== 'object') throw new Error('Invalid feature.');
    const f = v as GeoJSON.Feature;
    if (f.type !== 'Feature') throw new Error('Invalid feature.');
    return { type: 'Feature', id: i, geometry: geometry(f.geometry), properties: { name: String(f.properties?.name ?? f.properties?.title ?? `Feature ${i + 1}`).slice(0, 160) } };
  }) };
}

export function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || !cell) quoted = !quoted; else throw new Error('Invalid CSV quote.'); }
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== ',') { if (row.some((s) => s.trim())) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else cell += c;
  }
  if (quoted) throw new Error('CSV contains an unclosed quote.');
  row.push(cell); if (row.some((s) => s.trim())) rows.push(row);
  return rows;
}

export function importData(text: string, filename: string): GeoJSON.FeatureCollection {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('File exceeds 5 MB.');
  if (/\.csv$/i.test(filename)) {
    const [header, ...rows] = csvRows(text);
    if (!header) throw new Error('CSV is empty.');
    const fields = header.map((h) => h.trim().toLowerCase());
    const lat = fields.findIndex((h) => ['lat', 'latitude'].includes(h));
    const lon = fields.findIndex((h) => ['lon', 'lng', 'longitude'].includes(h));
    const name = fields.findIndex((h) => ['name', 'title'].includes(h));
    if (lat < 0 || lon < 0) throw new Error('CSV needs latitude and longitude columns; name is optional.');
    return validateGeoJSON({ type: 'FeatureCollection', features: rows.map((r, i) => {
      if (!r[lat]?.trim() || !r[lon]?.trim()) throw new Error(`Missing coordinates on CSV row ${i + 2}.`);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [Number(r[lon]), Number(r[lat])] }, properties: { name: r[name] || `Row ${i + 2}` } };
    }) });
  }
  if (/\.kml$/i.test(filename)) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('KML entities are not supported.');
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('KML is not valid XML.');
    const children = (e: Element | Document, tag: string) => Array.from(e.getElementsByTagNameNS('*', tag));
    if (children(doc, 'NetworkLink').length) throw new Error('KML NetworkLinks are not loaded. Import a file containing geometry.');
    const coords = (e: Element) => (children(e, 'coordinates')[0]?.textContent ?? '').trim().split(/\s+/).map((s) => s.split(',').map(Number));
    return validateGeoJSON({ type: 'FeatureCollection', features: children(doc, 'Placemark').flatMap((p) => {
      const properties = { name: children(p, 'name')[0]?.textContent ?? 'KML feature' };
      return [...children(p, 'Point').map((e) => ({ type: 'Point', coordinates: coords(e)[0] })),
        ...children(p, 'LineString').map((e) => ({ type: 'LineString', coordinates: coords(e) })),
        ...children(p, 'Polygon').map((e) => ({ type: 'Polygon', coordinates: children(e, 'LinearRing').map(coords) }))]
        .map((geometry) => ({ type: 'Feature', geometry, properties }));
    }) });
  }
  return validateGeoJSON(JSON.parse(text));
}

export function firstPoint(data: GeoJSON.FeatureCollection): [number, number] | null {
  const walk = (g: GeoJSON.Geometry): number[] | null => {
    if (g.type === 'GeometryCollection') return g.geometries.map(walk).find(Boolean) ?? null;
    let c: unknown = g.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return Array.isArray(c) && c.length >= 2 ? c as number[] : null;
  };
  const p = data.features.map((f) => f.geometry && walk(f.geometry)).find(Boolean);
  return p ? [p[0], p[1]] : null;
}
