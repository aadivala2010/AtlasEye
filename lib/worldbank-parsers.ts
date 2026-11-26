import { z } from 'zod';
import { ECONOMIC_INDICATORS, type CountryIndicator, type CountryProfile, type IntelCountry, type IndicatorId } from './country-intel';

const countryRow = z.object({ id: z.string().regex(/^[A-Z]{3}$/), name: z.string(), capitalCity: z.string(), region: z.object({ id: z.string(), value: z.string() }), latitude: z.string(), longitude: z.string() });
const envelope = z.tuple([z.object({ lastupdated: z.string().optional() }).passthrough(), z.array(z.unknown()).nullable()]);
export function parseCountries(input: unknown): IntelCountry[] {
  const [, rows] = envelope.parse(input);
  return (rows ?? []).flatMap(row => {
    const parsed = countryRow.safeParse(row);
    if (!parsed.success || parsed.data.region.value === 'Aggregates' || parsed.data.region.id === 'NA') return [];
    const c = parsed.data;
    const lat = c.latitude.trim() ? Number(c.latitude) : NaN, lon = c.longitude.trim() ? Number(c.longitude) : NaN;
    const point = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    return [{ code: c.id, name: c.name, capital: c.capitalCity, region: c.region.value, lat: point ? lat : null, lon: point ? lon : null }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
const indicatorRow = z.object({ indicator: z.object({ id: z.string() }), countryiso3code: z.string(), date: z.string().regex(/^\d{4}$/), value: z.number().finite().nullable() });
export function parseCountryIndicators(input: unknown, country: IntelCountry, now = Date.now()): CountryProfile {
  const [metadata, rows] = envelope.parse(input);
  const found = new Map<IndicatorId, CountryIndicator>();
  for (const row of rows ?? []) {
    const parsed = indicatorRow.safeParse(row);
    if (!parsed.success) continue;
    const r = parsed.data;
    if (r.countryiso3code !== country.code || r.value === null || !Object.hasOwn(ECONOMIC_INDICATORS, r.indicator.id)) continue;
    const id = r.indicator.id as IndicatorId;
    if (!found.has(id) || found.get(id)!.year < r.date) found.set(id, { id, value: r.value, year: r.date });
  }
  return { country, indicators: [...found.values()], datasetUpdated: metadata.lastupdated ?? null, retrievedAt: now };
}
