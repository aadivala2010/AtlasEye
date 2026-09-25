export const CATEGORIES = [
  'city', 'nature', 'wildlife', 'beach', 'harbor',
  'traffic', 'transit', 'weather', 'space', 'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Stream {
  /** YouTube video ID. Primary key; dedupe across sources on this. */
  id: string;
  title: string;
  /** Clean display name — place, not the channel's SEO title. */
  name: string;
  latitude: number;
  longitude: number;
  place: string;          // "Shibuya, Tokyo"
  country: string;        // ISO 3166-1 alpha-2
  /** IANA zone, derived from coordinates at build time. Drives local-time display. */
  timezone: string;
  category: Category;
  /** Where this record came from, for attribution and debugging. */
  source: 'famelack' | 'camlisted' | 'override';
  /** How the coordinates were obtained. */
  geocode: 'override' | 'gazetteer';
  confidence: number;     // 0–1
  addedAt: string;        // ISO 8601
}

export interface Catalog {
  builtAt: string;
  count: number;
  streams: Stream[];
}
