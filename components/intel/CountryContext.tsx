'use client';
import { useState } from 'react';
import { ECONOMIC_INDICATORS, type CountryProfile, type IntelCountry, type IndicatorId } from '@/lib/country-intel';
import { useFeed, useSources } from '@/lib/sources';

export default function CountryContext({ initialCode = '', onDossier }: { initialCode?: string; onDossier?(country: IntelCountry): void }) {
  const [code, setCode] = useState(initialCode), [expanded, setExpanded] = useState(!!initialCode);
  const list = useFeed<IntelCountry[]>('World Bank countries', expanded ? '/api/intel/countries' : null, 86400_000, value => value);
  const profile = useFeed<CountryProfile>(`World Bank ${code}`, code ? `/api/intel/country/${code}` : null, 86400_000, value => value);
  const sources = useSources();
  const error = sources.find(s => s.id === `World Bank ${code}`)?.error;
  const directoryError = sources.find(s => s.id === 'World Bank countries')?.error;
  const country = profile?.country;
  return <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)} className="mt-3 border-t border-strong pt-3">
    <summary className="min-h-8 cursor-pointer font-mono text-[11px] uppercase tracking-wide text-accent">Country context · World Bank</summary>
    <label className="block text-xs text-secondary">Country or territory
      <select value={code} onChange={e => setCode(e.target.value)} className="mt-1 min-h-10 w-full rounded border border-strong bg-raised px-2 text-primary">
        <option value="">{directoryError && !list ? 'Country directory unavailable' : list ? 'Select a country' : 'Loading countries…'}</option>
        {code && !list?.some(c => c.code === code) && <option value={code}>{code}</option>}
        {list?.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
    </label>
    {code && !profile && <p role="status" className="mt-2 text-xs text-secondary">{error ? 'World Bank is unavailable. Try again later.' : 'Loading dated country indicators…'}</p>}
    {profile && country && <div className="mt-3 text-xs text-secondary">
      <h3 className="font-medium text-primary">{country.name}</h3>
      <p className="mt-1">{country.region}{country.capital ? ` · Capital: ${country.capital}` : ''}</p>
      <dl className="mt-2 space-y-2">{(Object.keys(ECONOMIC_INDICATORS) as IndicatorId[]).map(id => {
        const meta = ECONOMIC_INDICATORS[id], value = profile.indicators.find(i => i.id === id);
        const formatted = value?.value.toLocaleString(undefined, { maximumFractionDigits: meta.unit === 'people' ? 0 : 2 });
        return <div key={id}><dt>{meta.label}</dt><dd className="text-primary">{value ? <a href={`https://data.worldbank.org/indicator/${id}?locations=${country.code}`} target="_blank" rel="noopener noreferrer" className="underline decoration-strong underline-offset-2">{meta.unit === 'USD' ? 'US$ ' : ''}{formatted}{meta.unit === '%' ? '%' : ''} <span className="text-secondary">· {value.year}</span></a> : 'Not available'}</dd></div>;
      })}</dl>
      <p className="mt-3 text-[11px] leading-4">Annual statistics, not live financial data. Each year belongs to its indicator. Unemployment is a modeled ILO estimate.</p>
      <p className="mt-2 text-[11px]">Dataset updated: {profile.datasetUpdated ?? 'not supplied'} · Retrieved: {new Date(profile.retrievedAt).toLocaleDateString()}</p>
      {(error || Date.now() - profile.retrievedAt > 2 * 86400_000) && <p role="status" className="mt-2 text-[11px]">Cached data; refresh is delayed.</p>}
      {onDossier && country.lat !== null && country.lon !== null && <button type="button" onClick={() => onDossier(country)} className="mt-2 min-h-10 text-accent">Open capital and country Dossier</button>}
    </div>}
  </details>;
}
