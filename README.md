# Atlas Eye

A live window onto anywhere on Earth. A 3D satellite globe scattered with ~10,000 public live
cameras — spin it, click a point, and watch what is happening there right now.

No accounts. No API keys. No tracking. One tiny server route: a caching proxy for live flights.

## Run it

```sh
npm install
npm run dev          # http://localhost:3000
```

On Windows you can double-click **`start.bat`** instead: it installs dependencies on
first run, starts the dev server and opens the browser.

Deploy: import the repo into Vercel — zero configuration, no environment variables.
The page is static (the catalog is a file in `public/data/`) apart from `app/api/flights` (caching proxy to adsb.lol, live near the view) and `app/api/flights/global` (OpenSky worldwide snapshot, cached 15 min; set `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` from a free OpenSky account for 90 s refreshes).

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run import` | Re-pull every source, validate, geocode, probe live video, write `public/data/streams.json` + `rejected.json` (~4 min) |
| `npm run import -- --offline` | Same, from the committed snapshots in `data/upstream/` (for tuning the geocoder) |
| `npm run gazetteer` | Rebuild `data/gazetteer/cities.tsv` from GeoNames (~210 MB download; rarely needed) |
| `npm test` | Assert-based self-test of the geocoder, solar math and clocks |
| `npm run typecheck` | `tsc --noEmit` |

## How the data gets here

```
Famelack webcams ──┐                                             ┌─ public/data/streams.json  (the globe)
camlisted ─────────┼─ Zod ─ dedupe ─ overrides ─ geocode / GPS ──┤
                   │                                             └─ public/data/rejected.json (every YouTube drop + reason)
Caltrans, DelDOT, ─┴─ Zod ─ probe live video ─ nearest place/timezone ─┘
NYC DOT, DriveBC,
Digitraffic, HK TD
```

`scripts/import-catalog.ts` runs offline (by you, or weekly by
`.github/workflows/refresh-catalog.yml`) and commits its output. The app never calls it.

### Three kinds of stream

| Kind | Where from | Plays as | Coordinates |
|---|---|---|---|
| **YouTube** | [Famelack](https://github.com/famelack/famelack-data), [camlisted](https://github.com/tantran21501/camlisted) (both MIT) | youtube-nocookie iframe | geocoded from the title (below), or the broadcaster's own YouTube GPS |
| **Live video** | Caltrans, Delaware DOT road cameras | HLS via hls.js (loaded only when opened) | published by the operator |
| **Snapshot** | Caltrans, NYC DOT, DriveBC, Digitraffic (Finland), Hong Kong TD | a still the operator refreshes every 5 s – 5 min, re-fetched on that cadence and labelled **SNAPSHOT** | published by the operator |

Snapshots can be hidden with the **SNAPSHOTS** chip in the header; their pins are drawn smaller,
and Random picks them rarely.

- **Vendored.** Validated snapshots of every source live in `data/upstream/`
  (`agencies.json` is the normalised, probed camera list).
- **Only live, embeddable YouTube streams.** From camlisted we keep `status: live`,
  `content_type: live` (not ended VOD archives), `embeddable`, approved and not hidden.
  Famelack already verifies embed + live status.
- **Live video is verified at import.** Every HLS playlist is fetched; one that doesn't answer
  with `#EXTM3U` within 8 s is dropped (Caltrans cameras fall back to their still image).
- **Fails loudly.** Every source is parsed with Zod. On any schema mismatch the script prints the
  first issues, exits 1 and **leaves the existing catalog untouched**. It also refuses to write if
  the catalog would shrink by more than half (override with `--force`) or would be empty. An agency
  that is merely *unreachable* keeps its cameras from the previous catalog (with a warning), so one
  flaky server doesn't blank a region.
- **Dedupe** on YouTube video ID; Famelack wins (cleaner names, hand-assigned categories).
- **Timezones and place names** come from coordinates at build time: a gazetteer match carries its
  GeoNames timezone; everything else takes the nearest GeoNames place (a 1° grid index keeps
  that fast for ~10,000 cameras).

### Current numbers (catalog built 2026-09-25)

| | |
|---|---|
| **On the globe** | **9,963** |
| YouTube live streams placed | 2,386 of 4,726 upstream (146 hand-placed, 152 by broadcaster GPS) |
| Live road-camera video | 1,868 (playlist verified live at import) |
| Snapshot cameras | 5,709 |
| YouTube streams dropped | 2,340 (49.5%) — every one listed in `public/data/rejected.json` |

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
- **Road cameras and snapshots (added on request for many more streams).** The prompt's catalog is
  YouTube-only; transport agencies publish thousands of public cameras with exact coordinates, which
  need no geocoding at all. Live video is verified at import. Still-image cameras are included but
  never passed off as video: labelled SNAPSHOT, drawn smaller, hideable, and rarely picked by Random.
  Keyed agency APIs (most US 511 systems, WSDOT, Ontario, Alberta) are skipped — no keys is a
  project rule. [Ora](https://github.com/warner-wvez/Ora) has ~46k US cameras but is licensed
  PolyForm Noncommercial, so none of its data is used.
- **Satellite imagery:** the globe shows EOX *Sentinel-2 cloudless 2016* (CC BY 4.0, keyless),
  with OpenStreetMap borders and place names from OpenFreeMap (CARTO fallback) drawn on top. The
  2016 layer is used deliberately: EOX's later years are CC BY-NC-SA, which would forbid commercial use.
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
scripts/            import-catalog, geocode, stopwords, build-gazetteer, selftest
data/               overrides.json, excluded.json, gazetteer/, upstream/ snapshots
public/data/        streams.json, rejected.json
```

## Keyboard

`R` random · `←` `→` walk outward through the nearest streams · `/` search · `Esc` close ·
`F` fullscreen · `M` mute

Attribution and full license texts: [`ATTRIBUTION.md`](ATTRIBUTION.md).
