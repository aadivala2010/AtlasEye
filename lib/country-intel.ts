export const ECONOMIC_INDICATORS = {
  'SP.POP.TOTL': { label: 'Population', unit: 'people' },
  'NY.GDP.MKTP.CD': { label: 'GDP', unit: 'USD' },
  'NY.GDP.PCAP.CD': { label: 'GDP per capita', unit: 'USD' },
  'FP.CPI.TOTL.ZG': { label: 'Inflation', unit: '%' },
  'SL.UEM.TOTL.ZS': { label: 'Unemployment (ILO estimate)', unit: '%' },
} as const;
export type IndicatorId = keyof typeof ECONOMIC_INDICATORS;
export interface IntelCountry { code: string; name: string; capital: string; region: string; lat: number | null; lon: number | null }
export interface CountryIndicator { id: IndicatorId; value: number; year: string }
export interface CountryProfile { country: IntelCountry; indicators: CountryIndicator[]; datasetUpdated: string | null; retrievedAt: number }
