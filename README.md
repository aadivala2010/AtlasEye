# Atlas Eye

A live window onto anywhere on Earth. A 3D satellite globe scattered with ~60,000 public live
cameras in 89 countries and on every continent — spin it, click a point, and watch what is happening
there right now. Over it: the clouds as five geostationary satellites see them now, the night side's
city lights, every satellite in orbit, every aircraft, earthquake, fire and storm as it happens, ~7,900
live radio stations, and a time machine back to 2000.

No accounts. No API keys. No tracking. A few small server routes, all caching proxies.

## Run it

```sh
npm install
npm run dev          # http://localhost:3000
```

On Windows you can double-click **`start.bat`** instead: it installs dependencies on
first run, starts the dev server and opens the browser.

Deploy: import the repo into Vercel — zero configuration, no environment variables.
The page is static (the catalogs are files in `public/data/`) apart from four caching routes: `app/api/flights` (adsb.lol, live near the view), `app/api/flights/global` (worldwide airliners, military and 7700 squawks from adsb.lol, one feed per CDN-cached request), `app/api/fires` (NASA FIRMS's 24-hour fire CSV, binned to ~250 KB) and `app/api/satellites` (CelesTrak's orbital elements, 2 h at the CDN).

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run import` | Re-pull every source, validate, geocode, probe every live stream and unvetted image, write `public/data/streams.json` + `rejected.json` (~30 min) |
| `npm run import -- --offline` | Same, from the committed snapshots in `data/upstream/` (for tuning the geocoder) |
| `npm run extras` | Write `public/data/iss.json` (ISS live feeds, from the snapshots) and `public/data/radio.json` (Radio Browser) |
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

`scripts/import-catalog.ts` and `scripts/import-extras.ts` run offline (by you, or weekly by
`.github/workflows/refresh-catalog.yml`) and commit their output. The app never calls them.

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

## Seeing everything

Everything below is keyless and fetched straight from the browser (CORS), except where a route is named.

| | What | From |
|---|---|---|
| **Sky** (cloud button) | **Live clouds**: infrared from GOES-18, GOES-19, Meteosat-12, Meteosat-9 and Himawari-9, a frame every 10–15 min (~25–60 min behind). **Night side** with city lights. The **daily pass** (true colour). **Aurora**. **Lightning** (Europe, Africa, Atlantic). One **sense** at a time: infrared, rain, radar, sea temperature, marine heatwaves, smoke & dust, snow, sea ice, carbon monoxide — each with NASA's legend. **3D terrain** | NASA GIBS, EUMETSAT, RainViewer, NOAA SWPC |
| **Earth** (on by default) | M2.5+ earthquakes of the last day, rings for the last hour; every fire of the last 24 h; storms with their tracks, wildfires, volcanoes, ice | USGS, NASA FIRMS (`/api/fires`), NASA EONET |
| **Pulse** (P) | The notable things on Earth now, most urgent first: M4.5+ quakes, 7700 squawks, storms and eruptions, launches in the next day, geomagnetic storms. Optional background browser alerts for critical ones | the Earth feeds, adsb.lol, The Space Devs, NOAA SWPC |
| **Satellites** | All ~16,600 active objects (~11,000 Starlink) by SGP4 every 2 s; click one for its ground track, footprint and a following camera. The ISS plays its own live video | CelesTrak (`/api/satellites`), satellite.js |
| **Time** (T) | Scrub, step or play the planet back to 24 Feb 2000: the geostationary frames (weeks back), the night side, the senses, the day's true colour, quakes and events from their archives. The moment rides in the URL (`?t=`) | as above |
| **Dossier** | Click anywhere: local time, sun and moon, weather, air, sea, street-level photos, Wikipedia, cameras, aircraft, satellites overhead and the next ISS pass, quakes nearby, local radio | Open-Meteo, Wikipedia, Panoramax, USGS, adsb.lol |
| **Radio** | ~7,900 live stations with a place on the map; a radio button on every camera plays the one nearest it | Radio Browser |
| **Wall** (W) | A grid of live feeds: in view, one per country, or wherever the sun is rising or setting | the catalog |
| **Tour** (A) | Autopilot: follow the sunrise (or sunset) around the world, or visit the Pulse, a hop every 40 s | the catalog, the Pulse |

- **Every pixel of the live clouds comes from the satellite with the straightest view of it.** The five
  sources are drawn bottom to top, and each gives way to one beneath it wherever that one's nadir is
  nearer, blended ~3.5° either side of the midline; each also fades out between 62° and 76° off nadir.
  `npm test` checks there's no gap or double cover along the equator. Infrared becomes white cloud by
  day and moonlit grey by night (GIBS's enhanced palette's coloured pixels count as the coldest tops).
- **GIBS's newest frame comes from DescribeDomains,** a few hundred bytes per layer: GIBS 404s any time
  past its newest frame, and `default` never changes URL, so tiles would never refresh.
- **The night side is per pixel,** Black Marble masked by the sun's altitude in a tile protocol, so none
  of the old terminator's polygon trouble at the poles can happen.
- **ISS feeds play on the ISS.** They used to be excluded for having no honest pin; in the satellite
  layer they have one, and it moves. Music loops that only call themselves "ISS" are skipped.
- **Radio is HTTPS-only** (an https page can't play http audio), not HLS, last check OK, one station per
  stream; a Radio Browser outage keeps last week's list.
- **What doesn't reach back in time** — flights, fires, launches, the aurora, the Pulse's squawks — steps
  aside in the time machine rather than showing today's data on another day. Satellites follow the
  clock for a week either way of their elements.
- **Not here, and why:** ships worldwide need a key (aisstream.io) — keyless AIS only covers the Baltic;
  lightning outside Meteosat's view has no keyless live source; GDELT's geo API is gone; an animated
  global wind field needs GRIB2 decoding on a schedule.

## How to add an override (the main way to improve quality)

`data/overrides.json` maps a YouTube video ID to exact coordinates. It always wins over automatic
matching. Map an ID to `null` when the automatic match is wrong and the real spot is unknown — the
stream is left off the globe (reason `misplaced` in `rejected.json`).

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
- **Streams with no place on Earth** (ISS feeds) are kept out of the camera catalog — there is no honest
  pin for them on the ground. They play on the ISS itself in the satellite layer (`public/data/iss.json`).
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
- **The daily pass is real imagery,** not a model: NASA GIBS VIIRS (NOAA-20) corrected-reflectance true
  colour (MODIS Terra for days before 2018), keyless, for **yesterday UTC** (or the time machine's day) — the most recent *complete* global composite, and what NASA
  Worldview itself opens on. GIBS's `default` (latest date that exists) is the day still being flown:
  a polar orbiter has only swathed part of the globe so far, the rest of that day's tiles come back
  empty, and the boundary lands as a hard seam down the middle of the planet. Just after UTC midnight
  the previous day's own westernmost swaths can still be in NRT processing, so before 04:00 UTC the
  date holds a further day back. Laid over Esri at ~0.6 opacity — clouds are the brightest thing in frame, so they read
  as clouds — and faded out by z7.5, where GIBS runs out of levels and Esri is sharper. Its tiles are
  only requested once Daily pass (Sky menu) is first switched on. Where VIIRS saw nothing — the unlit
  polar caps and the ragged swath edges around them — GIBS paints solid black, which at that
  opacity dimmed the poles into a dark disc. Tiles come through a `gibs://` protocol that paints
  stand-in clouds over every solid block of near-black (a 3×3 core, grown two texels to take the
  JPEG blur at its edge); dark water only comes as specks of black, so it stays. The stand-ins are
  fractal noise on the sphere, toned like the real imagery at the gap's edge and flattened to one
  tone near the pole, where MapLibre smears each polar tile's outer row into a pinwheel.
  Ceiling: the daily composite doesn't line up across the antimeridian, so a seam runs along 180°.
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
app/                page, /about, error + 404 screens; api/ flights, fires, satellites
components/globe/   GlobeView (map, pins, clusters, sky, Earth layer, orbits, radio, 3D, rim light), Starfield
components/stream/  StreamPanel, Player (+ unavailable state), Clocks
components/chrome/  Header, SkyMenu, TimeBar, TourBar, Search, StatusBar, icons
components/…        flight/ (cockpit), dossier/, pulse/, satellite/, radio/, wall/
lib/                stream types, geo, solar (sun, moon), time, readout store, sky (overlays + tile protocols),
                    events (quakes, EONET, launches, Pulse), fires, satellites (SGP4), radio, wall
scripts/            import-catalog, import-extras (ISS feeds, radio), agencies, geocode, stopwords, build-gazetteer, selftest
data/               overrides.json, excluded.json, gazetteer/, upstream/ snapshots
public/data/        streams.json, rejected.json, iss.json, radio.json
```

## Keyboard

`R` random · `←` `→` walk outward through the nearest streams · `/` search · `Esc` close ·
`F` fullscreen · `M` mute · `P` pulse · `T` time machine · `W` wall · `A` tour (autopilot)

Attribution and full license texts: [`ATTRIBUTION.md`](ATTRIBUTION.md).
