export const CATEGORIES = [
  'city', 'nature', 'wildlife', 'beach', 'harbor',
  'traffic', 'transit', 'weather', 'space', 'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** How a stream plays: YouTube embed, an operator's HLS or MJPEG video, or a periodically refreshed still. */
export type StreamKind = 'youtube' | 'hls' | 'mjpeg' | 'snapshot';

export type Source = keyof typeof SOURCE_CREDIT;

export interface Stream {
  /** YouTube video ID, or `<source>:<camera id>` for agency cameras. Primary key. */
  id: string;
  kind: StreamKind;
  /** HLS playlist, MJPEG stream or snapshot image URL (absent for YouTube). */
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

/** YouTube catalogs and curation; every other source is a camera operator (listed on /about). */
export const CATALOG_SOURCES = ['famelack', 'camlisted', 'override'] as const;

/** Credit shown on every stream from each source (and in full on /about). */
export const SOURCE_CREDIT = {
  famelack: { label: 'Famelack (MIT)', href: 'https://github.com/famelack/famelack-data' },
  camlisted: { label: 'camlisted (MIT)', href: 'https://github.com/tantran21501/camlisted' },
  override: { label: 'Atlas Eye curation', href: '/about' },
  // ── North America ──
  caltrans: { label: 'Caltrans', href: 'https://cwwp2.dot.ca.gov/' },
  deldot: { label: 'Delaware DOT', href: 'https://deldot.gov/map/' },
  nycdot: { label: 'NYC DOT', href: 'https://webcams.nyctmc.org/' },
  '511ny': { label: '511NY · New York State DOT', href: 'https://511ny.org/' },
  '511ga': { label: '511GA · Georgia DOT', href: 'https://511ga.org/' },
  az511: { label: 'AZ511 · Arizona DOT', href: 'https://az511.gov/' },
  '511wi': { label: '511WI · Wisconsin DOT', href: 'https://511wi.gov/' },
  '511la': { label: '511LA · Louisiana DOTD', href: 'https://511la.org/' },
  '511id': { label: 'Idaho 511 · Idaho Transportation Department', href: 'https://511.idaho.gov/' },
  udot: { label: 'UDOT Traffic · Utah DOT', href: 'https://udottraffic.utah.gov/' },
  nvroads: { label: 'NVRoads · Nevada DOT', href: 'https://www.nvroads.com/' },
  '511pa': { label: '511PA · PennDOT', href: 'https://www.511pa.com/' },
  ctroads: { label: 'CTroads · Connecticut DOT', href: 'https://ctroads.org/' },
  fl511: { label: 'FL511 · Florida DOT', href: 'https://fl511.com/' },
  ne511: { label: 'New England 511 · Maine, New Hampshire & Vermont', href: 'https://newengland511.org/' },
  drivenc: { label: 'DriveNC · North Carolina DOT', href: 'https://www.drivenc.gov/' },
  '511ak': { label: 'Alaska 511 · Alaska DOT&PF', href: 'https://511.alaska.gov/' },
  '511mn': { label: '511MN · Minnesota DOT', href: 'https://511mn.org/' },
  '511ia': { label: '511IA · Iowa DOT', href: 'https://511ia.org/' },
  '511in': { label: '511IN · Indiana DOT', href: 'https://511in.org/' },
  kandrive: { label: 'KanDrive · Kansas DOT', href: 'https://kandrive.gov/' },
  '511ne': { label: 'Nebraska 511 · Nebraska DOT', href: 'https://511.nebraska.gov/' },
  mass511: { label: 'Mass511 · MassDOT', href: 'https://mass511.com/' },
  vdot: { label: '511 Virginia · VDOT', href: 'https://511.vdot.virginia.gov/' },
  modot: { label: 'MoDOT Traveler Information', href: 'https://traveler.modot.org/' },
  chart: { label: 'CHART · Maryland DOT SHA', href: 'https://chart.maryland.gov/' },
  tripcheck: { label: 'TripCheck · Oregon DOT', href: 'https://tripcheck.com/' },
  cotrip: { label: 'COtrip · Colorado DOT', href: 'https://www.cotrip.org/' },
  wsdot: { label: 'WSDOT · Washington State DOT', href: 'https://wsdot.com/travel/real-time/cameras' },
  austin: { label: 'City of Austin Transportation & Public Works (open data)', href: 'https://data.austintexas.gov/Transportation-and-Mobility/Traffic-Cameras/b4k4-adkb' },
  alertca: { label: 'ALERTCalifornia · UC San Diego', href: 'https://cameras.alertcalifornia.org/' },
  drivebc: { label: 'DriveBC · Open Government Licence – British Columbia', href: 'https://www.drivebc.ca/' },
  '511on': { label: 'Ontario 511 · Ministry of Transportation', href: 'https://511on.ca/' },
  york: { label: 'York Region traffic cameras', href: 'https://www.york.ca/newsroom/campaigns-projects/traffic-cameras' },
  '511ab': { label: '511 Alberta', href: 'https://511.alberta.ca/' },
  skhotline: { label: 'Saskatchewan Highway Hotline', href: 'https://hotline.gov.sk.ca/' },
  '511mb': { label: 'Manitoba 511', href: 'https://www.manitoba511.ca/' },
  '511nb': { label: 'New Brunswick 511', href: 'https://511.gnb.ca/' },
  '511ns': { label: 'Nova Scotia 511', href: 'https://511.novascotia.ca/' },
  '511nl': { label: 'Newfoundland and Labrador 511', href: 'https://511nl.ca/' },
  '511yt': { label: 'Yukon 511', href: 'https://511yukon.ca/' },
  // ── Europe ──
  digitraffic: { label: 'Fintraffic / digitraffic.fi (CC BY 4.0)', href: 'https://www.digitraffic.fi/en/' },
  dgt: { label: 'DGT · Dirección General de Tráfico', href: 'https://nap.dgt.es/' },
  madrid: { label: 'Ayuntamiento de Madrid · Informo', href: 'https://informo.madrid.es/' },
  sct: { label: 'Servei Català de Trànsit', href: 'https://transit.gencat.cat/' },
  tfl: { label: 'Powered by TfL Open Data', href: 'https://tfl.gov.uk/info-for/open-data-users/' },
  tii: { label: 'TII Traffic · Transport Infrastructure Ireland', href: 'https://traffic.tii.ie/' },
  vegagerdin: { label: 'Vegagerðin · Icelandic Road and Coastal Administration', href: 'https://www.vegagerdin.is/' },
  eismoinfo: { label: 'Eismoinfo · Lithuanian Transport Safety Administration', href: 'https://eismoinfo.lt/' },
  fotowebcam: { label: 'foto-webcam.eu', href: 'https://www.foto-webcam.eu/' },
  // ── Asia, Africa, Oceania ──
  hktd: { label: 'Transport Department, HKSAR · DATA.GOV.HK', href: 'https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images' },
  twfreeway: { label: 'Freeway Bureau, MOTC (Taiwan)', href: 'https://www.freeway.gov.tw/' },
  twthb: { label: 'Highway Bureau, MOTC (Taiwan)', href: 'https://www.thb.gov.tw/' },
  mlit: { label: 'MLIT regional bureaus & prefectures (Japan) · index by Esri Japan', href: 'https://www.mlit.go.jp/road/bosai/LIVEcamera.html' },
  itraffic: { label: 'i-traffic · SANRAL', href: 'https://www.i-traffic.co.za/' },
  nzta: { label: 'NZ Transport Agency Waka Kotahi', href: 'https://www.journeys.nzta.govt.nz/traffic-cameras' },
  livetraffic: { label: 'Live Traffic NSW · Transport for NSW', href: 'https://www.livetraffic.com/traffic-cameras' },
  // ── worldwide ──
  usgs: { label: 'USGS HIVIS river cameras', href: 'https://apps.usgs.gov/hivis/' },
  aad: { label: 'Australian Antarctic Division', href: 'https://www.antarctica.gov.au/antarctic-operations/webcams/' },
  noaagml: { label: 'NOAA Global Monitoring Laboratory', href: 'https://gml.noaa.gov/obop/' },
  ndbc: { label: 'NOAA National Data Buoy Center', href: 'https://www.ndbc.noaa.gov/buoycams.shtml' },
  osm: { label: 'OpenStreetMap contributors (ODbL) · image © its operator', href: 'https://www.openstreetmap.org/copyright' },
} as const satisfies Record<string, { label: string; href: string }>;
