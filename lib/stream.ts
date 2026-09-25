export const CATEGORIES = [
  'city', 'nature', 'wildlife', 'beach', 'harbor',
  'traffic', 'transit', 'weather', 'space', 'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** How a stream plays: YouTube embed, an agency's HLS video, or a periodically refreshed still. */
export type StreamKind = 'youtube' | 'hls' | 'snapshot';

export type Source =
  | 'famelack' | 'camlisted' | 'override'
  | 'caltrans' | 'deldot' | 'nycdot' | 'drivebc' | 'digitraffic' | 'hktd';

export interface Stream {
  /** YouTube video ID, or `<source>:<camera id>` for agency cameras. Primary key. */
  id: string;
  kind: StreamKind;
  /** HLS playlist or snapshot image URL (absent for YouTube). */
  url?: string;
  /** Snapshot refresh interval, seconds. */
  refresh?: number;
  /** Upstream title, when it differs from `name` (YouTube SEO titles). */
  title?: string;
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
  source: Source;
  /**
   * How the coordinates were obtained: hand-placed, matched in the gazetteer, the uploader's own
   * YouTube recording location, or published by the camera's operator.
   */
  geocode: 'override' | 'gazetteer' | 'gps' | 'operator';
  confidence: number;     // 0–1
  addedAt: string;        // ISO 8601
}

export interface Catalog {
  builtAt: string;
  count: number;
  streams: Stream[];
}

/** Credit shown on every stream from each source (and in full on /about). */
export const SOURCE_CREDIT: Record<Source, { label: string; href: string }> = {
  famelack: { label: 'Famelack (MIT)', href: 'https://github.com/famelack/famelack-data' },
  camlisted: { label: 'camlisted (MIT)', href: 'https://github.com/tantran21501/camlisted' },
  override: { label: 'Atlas Eye curation', href: '/about' },
  caltrans: { label: 'Caltrans', href: 'https://cwwp2.dot.ca.gov/' },
  deldot: { label: 'Delaware DOT', href: 'https://deldot.gov/map/' },
  nycdot: { label: 'NYC DOT', href: 'https://webcams.nyctmc.org/' },
  drivebc: { label: 'DriveBC · Open Government Licence – British Columbia', href: 'https://www.drivebc.ca/' },
  digitraffic: { label: 'Fintraffic / digitraffic.fi (CC BY 4.0)', href: 'https://www.digitraffic.fi/en/' },
  hktd: { label: 'Transport Department, HKSAR · DATA.GOV.HK', href: 'https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images' },
};
