import { unstable_cache } from 'next/cache';
import { ECONOMIC_INDICATORS } from './country-intel';
import { parseCountries, parseCountryIndicators } from './worldbank-parsers';

async function getJson(path: string) {
  const r = await fetch(`https://api.worldbank.org/v2/${path}`, { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
  if (!r.ok) throw new Error('World Bank unavailable');
  return r.json() as Promise<unknown>;
}
// Next's persistent cache shares results across visitors and retains the last successful value
// when background revalidation fails. No credentials or scheduled jobs are needed.
export const countries = unstable_cache(async () => parseCountries(await getJson('country?format=json&per_page=400')), ['intel-countries-v1'], { revalidate: 86400 });
export const countryProfile = unstable_cache(async (code: string) => {
  const country = (await countries()).find(c => c.code === code);
  if (!country) return null;
  const params = new URLSearchParams({ format: 'json', source: '2', mrnev: '1', per_page: '100' });
  const data = await getJson(`country/${code}/indicator/${Object.keys(ECONOMIC_INDICATORS).join(';')}?${params}`);
  return parseCountryIndicators(data, country);
}, ['intel-country-profile-v1'], { revalidate: 86400 });
