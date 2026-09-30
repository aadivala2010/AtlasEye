/**
 * Gazetteer names that are also ordinary words in stream titles. A place with
 * one of these names can still be placed via data/overrides.json.
 * Normalised form (lowercase, diacritics folded).
 */
export const STOPWORDS = new Set<string>([
  // camera / stream vocabulary
  'live', 'cam', 'camera', 'webcam', 'stream', 'view', 'views', 'video', 'hd', 'tv', 'news', 'channel',
  // generic geography that is also a town somewhere
  'beach', 'park', 'bridge', 'harbor', 'harbour', 'port', 'bay', 'city', 'town', 'river', 'lake',
  'mountain', 'island', 'airport', 'station', 'street', 'avenue', 'road', 'square', 'center', 'centre',
  'downtown', 'north', 'south', 'east', 'west', 'central', 'ocean', 'sea', 'coast', 'valley', 'hill',
  'marina', 'pier', 'canal', 'falls', 'springs', 'ski', 'resort', 'hotel', 'plaza', 'main',
  // colours, weather, everyday words
  'green', 'red', 'white', 'black', 'blue', 'gold', 'golden', 'silver', 'sun', 'sunset', 'sunrise', 'rain',
  'snow', 'storm', 'weather', 'summit', 'paradise', 'eagle', 'bear', 'wolf', 'deer', 'fox', 'orange', 'rock',
  'union', 'liberty', 'victory', 'harmony', 'unity', 'concord', 'hope', 'friendship', 'grand', 'royal',
  'apex', 'scenic', 'lakes', 'banks', 'pantai', 'laghi', 'noord', 'zuid', 'sertao', 'nord', 'sud',
  'shoreline', 'boulder', 'university', 'college', 'kennedy', 'marine', 'junction', 'osprey', 'falcon', 'heron',
  'hawk', 'temple', 'pelican', 'owl', 'puffin', 'ixtapa', 'skyline', 'skyline view', 'ocean view', 'volcano',
  // volcanoes named like a town elsewhere (Kīlauea town is on Kauai; the volcano is on Hawaiʻi) — use overrides
  'kilauea', 'etna', 'vesuvius',
  // everyday Japanese/Chinese words that are also district names
  '海岸', '公園', '中央', '本町', '駅前', '大橋', '港町', '新町', '温泉', '市場', '空港', '本通', '中町', '北口', '南口',
  'national park', 'state park',
  'canyon', 'panorama', 'lake panorama', 'vista', 'bellevue', 'belvedere', 'piazza', 'simpang', 'landing',
  // plain words that are also a small town ("Dillon Reservoir" ≠ Reservoir, MA; "Waterfront" is an alias of Boston Seaport)
  'waterfront', 'reservoir', 'diamond', 'fountain', 'atlantic', 'mountain view', 'west end', 'north end', 'reserve',
  'plantation', 'white house',
]);
