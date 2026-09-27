# Atlas Eye

A live window onto anywhere on Earth. A 3D satellite globe scattered with ~60,000 public live
cameras in 89 countries and on every continent — spin it, click a point, and watch what is happening
there right now.

No accounts. No API keys. No tracking. One tiny server route: a caching proxy for live flights.

## Run it

```sh
npm install
npm run dev          # http://localhost:3000
```

On Windows you can double-click **`start.bat`** instead: it installs dependencies on
first run, starts the dev server and opens the browser.

Deploy: import the repo into Vercel — zero configuration, no environment variables.
The page is static (the catalog is a file in `public/data/`) apart from `app/api/flights` (caching proxy to adsb.lol, live near the view) and `app/api/flights/global` (worldwide airliners, military and 7700 squawks from adsb.lol, one feed per CDN-cached request).

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run import` | Re-pull every source, validate, geocode, probe every live stream and unvetted image, write `public/data/streams.json` + `rejected.json` (~30 min) |
| `npm run import -- --offline` | Same, from the committed snapshots in `data/upstream/` (for tuning the geocoder) |
| `npm run gazetteer` | Rebuild `data/gazetteer/cities.tsv` from GeoNames (~210 MB download; rarely needed) |
| `npm test` | Assert-based self-test of the geocoder, solar math, clocks and camera-feed parsing |
| `npm run typecheck` | `tsc --noEmit` |

## How the data gets here

```
Famelack webcams ──┐                                             ┌─ public/data/streams.json  (the globe)
camlisted ─────────┼─ Zod ─ dedupe ─ overrides ─ geocode / GPS ──┤
                   │                                             └─ public/data/rejected.json (every YouTube drop + reason)
60+ camera ────────┴─ Zod ─ dedupe ─ probe streams + unvetted images ─ nearest place/timezone ─┘
operators + OSM       (scripts/agencies.ts)
```

`scripts/import-catalog.ts` runs offline (by you, or weekly by
`.github/workflows/refresh-catalog.yml`) and commits its output. The app never calls it.

### Four kinds of stream

| Kind | Where from | Plays as | Coordinates |
|---|---|---|---|
| **YouTube** | [Famelack](https://github.com/famelack/famelack-data), [camlisted](https://github.com/tantran21501/camlisted) (both MIT) | youtube-nocookie iframe | geocoded from the title (below), or the broadcaster's own YouTube GPS |
| **Live video (HLS)** | US state DOTs (511 sites, Caltrans, VDOT, MoDOT, CHART, COtrip…) | hls.js (loaded only when opened) | published by the operator |
| **Live video (MJPEG)** | Taiwan's Freeway and Highway Bureaus | a plain `<img>` — browsers play multipart JPEG natively | published by the operator |
| **Snapshot** | every other operator, plus OpenStreetMap-mapped webcams | a still the operator refreshes every 5 s – 10 min, re-fetched on that cadence and labelled **SNAPSHOT** | published by the operator (or the OSM mapper) |

Snapshots can be hidden with the **SNAPSHOTS** chip in the header; their pins are drawn smaller,
and Random picks them rarely.

**Camera operators** (all keyless, all in `scripts/agencies.ts`, credited on every stream and on /about):

- **North America** — the IBI "511" platform (one list endpoint behind 22 sites: NY, GA, AZ, WI, LA, ID,
  UT, NV, PA, CT, FL, New England, NC, AK, and Ontario, Alberta, Saskatchewan, Manitoba, New Brunswick,
  Nova Scotia, Newfoundland, Yukon), Castle Rock's CARS platform (MN, IA, IN, KS, NE, MA — and Ireland),
  COtrip (CO), VDOT (VA), MoDOT (MO), CHART (MD), TripCheck (OR), WSDOT (WA, via ArcGIS), Caltrans,
  DelDOT, NYC DOT, Austin, DriveBC, York Region, ALERTCalifornia wildfire cameras, USGS river cameras,
  NOAA buoys.
- **Europe** — DGT (all of Spain, DATEX II), Madrid, Catalonia, TfL JamCams (London), TII (Ireland),
  Vegagerðin (Iceland), eismoinfo (Lithuania), Digitraffic (Finland), foto-webcam.eu (the Alps).
- **Asia & Oceania** — Taiwan Freeway and Highway Bureaus, Japan's MLIT regional bureaus (via Esri
  Japan's index), Hong Kong TD, NZTA (New Zealand), Live Traffic NSW (Australia).
- **Africa & Antarctica** — SANRAL i-traffic (South Africa), Australian Antarctic Division stations,
  NOAA's South Pole observatory.
- **Everywhere else** — OpenStreetMap: every node mapped with `contact:webcam` / `webcam` pointing at a
  direct image, fetched through Overpass.

- **Vendored.** Validated snapshots of every source live in `data/upstream/`
  (`agencies.json` is the normalised, probed camera list).
- **Only live, embeddable YouTube streams.** From camlisted we keep `status: live`,
  `content_type: live` (not ended VOD archives), `embeddable`, approved and not hidden.
  Famelack already verifies embed + live status.
- **Live video is verified at import.** Every HLS playlist is fetched with an `Origin` header; one that
  doesn't answer `#EXTM3U` with CORS headers within 8 s (hls.js can't play it) falls back to the camera's
  still image, or is dropped if it has none. Every MJPEG stream must start a multipart response.
  Tokenised or login-only video (Mass511, Georgia, Florida…) is shown as the operator's still.
- **Unvetted images are fetched at import** (OpenStreetMap links, Japan's index, South Africa): dropped
  if the URL doesn't return a real image, if its `Last-Modified` is over 30 days old (a stopped camera),
  or if the same bytes come back from three or more cameras — that's an operator's "camera offline" card.
- **Fails loudly, per source.** Every source is parsed with Zod. A schema mismatch in a YouTube catalog
  prints the first issues, exits 1 and **leaves the existing catalog untouched**; the script also refuses
  to write if the catalog would shrink by more than half (override with `--force`) or would be empty.
  A camera operator that is unreachable *or* has changed its format keeps its cameras from the previous
  catalog, with the Zod issues printed as a warning: one of 60-odd operators shouldn't blank its region or
  hold up everyone else's weekly refresh. So does an operator whose probes nearly all fail (90%+ of at
  least 20): every camera dying at once doesn't happen, a CI runner abroad being refused does.
- **Dedupe** on YouTube video ID (Famelack wins: cleaner names, hand-assigned categories); on stream URL
  across operators (the first listed keeps it); and an OSM camera within 150 m of an operator's camera is
  dropped as a mirror of it.
- **Timezones and place names** come from coordinates at build time: a gazetteer match carries its
  GeoNames timezone; everything else takes the nearest GeoNames place (a 1° grid index keeps
  that fast for ~60,000 cameras). Antarctic stations, far from any GeoNames place, carry their own.

### Current numbers (catalog built 2026-09-27)

| | |
|---|---|
| **On the globe** | **60,372** in 89 countries, from 61 camera operators and 2 YouTube catalogs |
| YouTube live streams placed | 2,397 of 4,740 upstream (142 hand-placed, 152 by broadcaster GPS) |
| Live video | 10,235 HLS + 3,378 MJPEG (every stream probed live at import) |
| Snapshot cameras | 44,362 |
| By region | North America 44,583 · Asia 7,361 · Europe 7,046 · Africa & Middle East 700 · Oceania 561 · Latin America 115 · Antarctica 4 |
| Dropped at import | 2,262 dead or CORS-less video streams (downgraded to stills where possible), 2,183 dead, stale or placeholder images |
| YouTube streams dropped | 2,343 (49.4%) — every one listed in `public/data/rejected.json` |

The YouTube drop rate is deliberate. Most drops are streams whose title names no findable place
("Bridge Cam", "Osprey Nest 2") — those need an override, not a guess.

## How to add an override (the main way to improve quality)

`data/overrides.json` maps a YouTube video ID to exact coordinates. It always wins over automatic
matching.

```json
{
  "dfVK7ld38Ys": {
    "name": "Shibuya Scramble Crossing",
    "latitude": 35.6595,
    "longitude": 139.7005,
    "place": "Shibuya, Tokyo",
    "country": "JP",
    "category": "city"
  }
}
```

1. Find candidates in `public/data/rejected.json` (or a misplaced pin — click it, the URL has its ID).
2. Look up the real coordinates of the camera (or of the landmark it films). Only add it if you are sure.
3. `npm run import -- --offline`, check the pin, commit.

`category` is optional (defaults to the upstream category). Overrides for IDs that are no longer
upstream are reported and ignored — an override never creates a stream on its own, because we
can't verify it is live.

**Removal requests:** add the video ID to `data/excluded.json`; it is dropped on the next import.

## How geocoding works

Neither source has coordinates, so they come from the stream title (and, for camlisted, the
channel name) matched against an offline gazetteer: **GeoNames `cities1000`** (171k places)
plus language-tagged, non-historic alternate names so `東京`, `Wien` and `Kromeriz` all resolve.

1. **Overrides first** (see above).
2. **Candidate names.** Latin-script text is split into words and every 1–6 word n-gram is looked
   up; CJK/Hangul/Thai runs are matched by substring. A Latin name must be capitalised
   ("nice view" ≠ Nice). Matches are kept **longest-first**, non-overlapping — "New York" beats "York".
3. **Filters that kill false positives:**
   - the source's **country field** removes candidates in other countries (the Springfield problem);
   - a name followed by *Street / Field / Mountain / County…* or preceded by *Mount / Lake /
     North / Outer…* belongs to a feature, not the town ("Duval Street", "Mount Fuji", "Outer Banks");
   - `scripts/stopwords.ts` lists gazetteer names that are everyday words in titles
     (Beach, Green, Summit, 海岸…);
   - if several same-named places exist in the country and the biggest holds < 75% of their
     combined population — and the title doesn't name the state/prefecture — the stream is
     **rejected as ambiguous** rather than put in the biggest one;
   - two strong matches > 75 km apart ("Tokyo to Osaka") → rejected as ambiguous;
   - a smaller place within 40 km of a bigger one (Shibuya in Tokyo) is preferred as more precise.
4. **Confidence score (0–1):**

   ```
   0.25 · name length      (short names are riskier; multi-word names get a bonus)
   0.20 · country agreed   (1 if the source gave a country, 0.3 if not)
   0.25 · population       (log-scaled: 1k → 0, 10M → 1)
   0.15 · field            (title 1, channel name 0.5)
   0.15 · unambiguity      (share of same-name population, or 1 if the state is named)
   ```

5. **Second opinions from camlisted.** camlisted publishes its own location resolution. When our
   gazetteer can't place a stream, the broadcaster's own **YouTube recording location (GPS)** is used,
   provided it lies within 60 km of a known place in the stream's country. camlisted's *text-based*
   geocodes are too often wrong to trust alone ("Catalina Island" → Paramaribo), so they only count
   when they land **within 30 km of our own best borderline candidate** — two independent geocoders
   agreeing. Country-level fallbacks are never used.

**Threshold: 0.65.** Tuned by eye against random samples of placements in each confidence band.
The 0.60–0.65 band was dominated by generic words matched to small towns ("Scenic", "Lakes",
"Pantai" = beach), so it's cut. Above 0.65 errors were rare in the samples; each one found was
fixed with a rule, a stopword or an override — but automatic matching is not perfect, and
`rejected.json` plus spot-checking pins is how it keeps improving. Short-named big cities
(Lyon, Riga, Oslo) clear the threshold through the population term.

## Decisions & deviations (noted as the prompt asked)

- **`cities1000` instead of `cities15000`.** Webcams are disproportionately in small towns
  (ski villages, beach towns). With the filters above, cities1000 placed ~19% more streams than
  cities5000 with comparable precision in the samples checked.
- **Zod schemas live in `scripts/import-catalog.ts`,** not `lib/stream.ts`, so Zod never ships in
  the client bundle. `lib/stream.ts` holds the shared types.
- **Timezones without a lookup library.** GeoNames already gives each place its IANA zone; overrides
  use the nearest place's zone. Ceiling: an override within a few km of a timezone border could
  pick the neighbour's zone — check the panel's TIMEZONE row when adding one near a border.
- **camlisted `parking` category is excluded** (parking-lot security cameras read as
  surveillance). Moving streams (walking tours, dashcams) are pinned at the city they're in.
- **Streams with no place on Earth** (ISS feeds) are excluded — there is no honest pin for them.
- **Road cameras and snapshots (added on request for many more streams, then for the whole world).**
  The prompt's catalog is YouTube-only; transport agencies publish tens of thousands of public cameras
  with exact coordinates, which need no geocoding at all. Live video is verified at import. Still-image
  cameras are included but never passed off as video: labelled SNAPSHOT, drawn smaller, hideable, and
  rarely picked by Random. **No keys is a project rule:** the 511 sites' keyed developer APIs are not
  used; their public maps' own list endpoints (the data every visitor's browser loads, no key or login)
  are. Skipped because they need a key or registration: Trafikverket (Sweden), QLDTraffic, Taiwan's TDX
  (city cameras), Korea's ITS, Norway's DATEX, FAA WeatherCams, NPS, Windy. Skipped for lack of
  structured data: most of Latin America, Africa and South Asia publish cameras only as web pages, and
  Germany's Autobahn API no longer lists webcams. Unsecured private cameras (Insecam-style lists) are
  never used. [Ora](https://github.com/warner-wvez/Ora) has ~46k US cameras but is licensed PolyForm
  Noncommercial, so none of its data is used.
- **Satellite imagery:** the globe shows Esri World Imagery (keyless) at every zoom, with
  OpenStreetMap borders and place names from OpenFreeMap (CARTO fallback) drawn on top. EOX
  Sentinel-2 cloudless 2016 was dropped: its orbit-swath seams showed as stripes across continents.
- **Clouds are real imagery,** not a model: NASA GIBS VIIRS (NOAA-20) corrected-reflectance true
  colour, keyless, for **yesterday UTC** — the most recent *complete* global composite, and what NASA
  Worldview itself opens on. GIBS's `default` (latest date that exists) is the day still being flown:
  a polar orbiter has only swathed part of the globe so far, the rest of that day's tiles come back
  empty, and the boundary lands as a hard seam down the middle of the planet. Just after UTC midnight
  the previous day's own westernmost swaths can still be in NRT processing, so before 04:00 UTC the
  date holds a further day back. Laid over Esri at ~0.6 opacity — clouds are the brightest thing in frame, so they read
  as clouds — and faded out by z7.5, where GIBS runs out of levels and Esri is sharper. Its tiles are
  only requested once the cloud toggle (beside the day/night one) is first switched on. Ceiling: polar winter is genuinely
  unlit, so those tiles are black and dim the winter pole.
- **Military and emergency aircraft** come from two more global adsb.lol endpoints (`/v2/mil`,
  `/v2/squawk/7700`) folded into the same worldwide rotation as the type sweeps, so the request rate
  is unchanged. `/v2/mil` also brings the helicopters, transports and fighters that no airliner-type
  sweep would ever show. Both flags ride on the aircraft, not on the feed it arrived on — military
  from readsb's `dbFlags` bit 1, emergency from squawk 7500/7600/7700 or the declared `emergency`
  field — so they survive the merge with the live local feed. Emergency outranks selection for
  colour and is drawn selected-size at every zoom.
- **Rim light is CSS, not MapLibre's atmosphere,** which can't be tinted. The limb is found by
  projecting points outward from the view centre each frame.
- **Cluster counts are drawn in Geist Mono via canvas** (`styleimagemissing`), because map glyph
  servers only carry sans fonts.
- **"Stream unavailable" detection** uses the YouTube player's postMessage events (no API script,
  no key): `onError` (e.g. 150, embedding disabled) or 12 s of silence from the player.
- **Overrides place the pin at the landmark the stream shows** when the camera's own spot isn't
  known exactly (e.g. "Mount Fuji" feeds). All override coordinates were checked by hand.

## Project layout

```
app/                page, /about, error + 404 screens
components/globe/   GlobeView (map, pins, clusters, terminator, rim light), Starfield
components/stream/  StreamPanel, Player (+ unavailable state), Clocks
components/chrome/  Header (categories, random), Search, StatusBar, icons
lib/                stream types, geo, solar (terminator), time, readout store
scripts/            import-catalog, agencies (every camera operator), geocode, stopwords, build-gazetteer, selftest
data/               overrides.json, excluded.json, gazetteer/, upstream/ snapshots
public/data/        streams.json, rejected.json
```

## Keyboard

`R` random · `←` `→` walk outward through the nearest streams · `/` search · `Esc` close ·
`F` fullscreen · `M` mute

Attribution and full license texts: [`ATTRIBUTION.md`](ATTRIBUTION.md).
