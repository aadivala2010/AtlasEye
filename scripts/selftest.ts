/** `npm test` — assert-based checks for the parts that are easy to break silently. */
import assert from 'node:assert/strict';
import { distanceKm, geocode, loadGazetteer, nearestPlace } from './geocode';
import { blockedSources, cameraName, titleCase, tmInverse } from './agencies';
import { moonPhase, subsolarPoint, sunAltitude } from '../lib/solar';
import { fillNoData } from '../lib/clouds';
import { cloudsDate, zonedClock } from '../lib/time';
import { parseFlights, project } from '../lib/flights';
import { parseEonet, pulseItems, type Quake } from '../lib/events';
import { binFires } from '../lib/fires';
import { pickStations, tidyTitle, type RawStation } from './import-extras';
import { nearestStations } from '../lib/radio';
import { MAX_YOUTUBE, pickWall, sunPhase } from '../lib/wall';
import type { Stream } from '../lib/stream';
import { elevation, footprintKm, groundTrack, groupOf, nextPass, parseTle, periodMin, subpoint } from '../lib/satellites';
import { GEO, SKY_DEFAULT, cloudiness, daylight, geoWeight, skyTiles, tileAxes, tileBbox } from '../lib/sky';

const g = loadGazetteer();
const place = (title: string, country?: string) => {
  const r = geocode(g, { title }, country);
  return r.ok ? `${r.hit.place.name}, ${r.hit.place.country}` : `REJECT ${r.reason.split(':')[0]}`;
};

// Longest match wins: "New York" beats "York".
assert.equal(place('New York City Skyline Cam', 'US'), 'New York City, US');
// Country filter kills cross-border homonyms; ambiguous same-name towns are rejected, not guessed.
assert.match(place('Springfield Downtown', 'US'), /^REJECT ambiguous-name/);
assert.equal(place('Paris Eiffel Tower View', 'FR'), 'Paris, FR');
// A state named after the city isn't a rival place.
assert.equal(place('Seattle, Washington, USA | LIVE Train Camera', 'US'), 'Seattle, US');
// "St." before a proper noun is Saint, not Street.
assert.equal(place("Venice St. Mark's Basin", 'IT'), 'Venice, IT');
// Street and feature names don't resolve to the town they share a name with.
assert.match(place('Duval Street', 'US'), /^REJECT/);
assert.match(place('Mount Fuji Panorama', 'JP'), /^REJECT/);
assert.match(place('富士山ライブカメラ', 'JP'), /^REJECT/);
// Local scripts resolve.
assert.equal(place('渋谷スクランブル交差点', 'JP'), 'Shibuya, JP');
// Lowercase common words aren't proper nouns.
assert.match(place('a nice view of the harbour', 'FR'), /^REJECT/);

// Nearest place (agency cameras, overrides): right zone even for DST-free Creston, BC.
assert.equal(nearestPlace(g, 49.1093, -116.1695).place.timezone, 'America/Creston');
assert.equal(nearestPlace(g, 40.7324, -73.9849).place.timezone, 'America/New_York');
assert.ok(nearestPlace(g, 60.3858, 23.9049).km < 20);

// Solar: at the June solstice the subsolar point sits on the Tropic of Cancer, near 0° at 12:00 UTC.
const solstice = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
assert.ok(Math.abs(solstice.lat - 23.44) < 0.2, `solstice lat ${solstice.lat}`);
assert.ok(Math.abs(solstice.lon) < 2.5, `solstice lon ${solstice.lon}`);
assert.ok(sunAltitude(0, 0, solstice) > 60);
assert.ok(sunAltitude(0, 180, solstice) < -60);

// Moon: full on 26 Sep 2026 (16:49 UTC), new on 10 Oct.
assert.equal(moonPhase(new Date('2026-09-26T16:49:00Z')).name, 'Full moon');
assert.ok(moonPhase(new Date('2026-09-26T16:49:00Z')).lit > 0.99);
assert.ok(moonPhase(new Date('2026-10-10T15:50:00Z')).lit < 0.02);

// Clocks: Tokyo has no DST.
assert.deepEqual(zonedClock(new Date('2026-01-01T00:00:00Z'), 'Asia/Tokyo'), { time: '09:00:00', offset: 'UTC+9' });

// Flights: 60 kt due east on the equator covers 1 arcminute of longitude in a minute; ground → alt 0.
const [f] = parseFlights([{ hex: 'abc', lat: 0, lon: 0, gs: 60, track: 90, alt_baro: 'ground', seen_pos: 0 }], 0);
assert.equal(f.ground, true);
assert.equal(f.alt, 0);
const p = project(f, 60_000);
assert.ok(Math.abs(p.lon - 1 / 60) < 1e-9 && Math.abs(p.lat) < 1e-9, `project ${JSON.stringify(p)}`);
assert.deepEqual(project(f, 60 * 60_000), project(f, 15 * 60_000)); // capped at 15 min
assert.equal(f.mil, false);
assert.equal(f.emergency, false);

// Military rides on readsb's dbFlags bit 1 (bit 8 is LADD, not military); emergencies on squawk or the declared field.
const flags = (dbFlags: number) => parseFlights([{ hex: 'a', lat: 0, lon: 0, dbFlags }], 0)[0].mil;
assert.equal(flags(1), true);
assert.equal(flags(9), true); // military and LADD
assert.equal(flags(8), false);
const emer = (r: Partial<Parameters<typeof parseFlights>[0][0]>) =>
  parseFlights([{ hex: 'a', lat: 0, lon: 0, ...r }], 0)[0].emergency;
assert.equal(emer({ squawk: '7700' }), true);
assert.equal(emer({ squawk: '7600' }), true);
assert.equal(emer({ squawk: '1200' }), false);
assert.equal(emer({ squawk: '7000' }), false); // European VFR conspicuity, not an emergency
assert.equal(emer({ emergency: 'none' }), false);
assert.equal(emer({ emergency: 'downed' }), true);

// Clouds: GIBS's own "latest" is the day still being flown, whose unflown half reads as a seam down
// the globe, so we ask for the last complete composite — and hold a day further back until the
// previous day's westernmost swaths have cleared NRT processing.
assert.equal(cloudsDate(Date.UTC(2026, 8, 27, 12, 0)), '2026-09-26');
assert.equal(cloudsDate(Date.UTC(2026, 8, 27, 4, 0)), '2026-09-26');
assert.equal(cloudsDate(Date.UTC(2026, 8, 27, 3, 59)), '2026-09-25');
assert.equal(cloudsDate(Date.UTC(2026, 8, 27, 0, 5)), '2026-09-25');
assert.equal(cloudsDate(Date.UTC(2026, 0, 1, 12, 0)), '2025-12-31'); // across a year boundary

// …and GIBS's no-data black (the unlit polar caps) is covered with stand-in cloud, JPEG blur at its
// edge included, while a speck of dark water inside the imagery stays.
{
  const w = 12, h = 6;
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  const paint = (x: number, y: number, v: number) => px.fill(v, 4 * (y * w + x), 4 * (y * w + x) + 3);
  const grey = (x: number, y: number) => px[4 * (y * w + x)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 4; x++) paint(x, y, 0); // no-data: columns 0–3
    paint(4, y, 90); // the blur along its edge
  }
  paint(6, 1, 40); // JPEG undershoot just past the blur
  paint(9, 3, 5); // dark water
  assert.equal(fillNoData(px, w, h, { z: 3, x: 2, y: 0 }), true);
  for (const [x, y] of [[0, 0], [3, 5], [4, 2], [6, 1]]) assert.ok(grey(x, y) >= 175 && grey(x, y) <= 252, `cloud at ${x},${y}`);
  assert.deepEqual([grey(5, 2), grey(9, 3)], [255, 5]);
  // Specks alone change nothing, so the tile goes to the map untouched.
  assert.equal(fillNoData(new Uint8ClampedArray(9 * 4).fill(255).fill(0, 16, 19), 3, 3, { z: 0, x: 0, y: 0 }), false);
}

// Sky: the geostationary ring paints each point from the satellite with the straightest view of it,
// drawn bottom to top with each layer giving way to a nearer one beneath — no gaps, no double cover.
{
  const RAD = Math.PI / 180;
  const cover = (lat: number, lon: number) => {
    const w = GEO.map((_, i) => geoWeight((j) => Math.cos(lat * RAD) * Math.cos((lon - GEO[j].lon) * RAD), i));
    let left = 1;
    const got: number[] = [];
    for (let i = GEO.length - 1; i >= 0; i--) { got[i] = left * w[i]; left *= 1 - w[i]; }
    return got;
  };
  const byId = (lat: number, lon: number) => Object.fromEntries(GEO.map((g, i) => [g.id, cover(lat, lon)[i]]));
  assert.ok(byId(0, -75.2)['goes-east'] > 0.99, 'GOES-East owns its nadir');
  assert.ok(byId(0, 10).mtg > 0.99 && byId(0, 90).iodc > 0.99 && byId(0, 150).himawari > 0.99 && byId(0, -150)['goes-west'] > 0.99);
  const mid = byId(0, -106.2);
  assert.ok(Math.abs(mid['goes-east'] - 0.5) < 0.1 && Math.abs(mid['goes-west'] - 0.5) < 0.1, `blend at the midline ${JSON.stringify(mid)}`);
  for (let lon = -180; lon < 180; lon += 1) {
    const total = cover(0, lon).reduce((a, b) => a + b, 0);
    assert.ok(total > 0.97 && total < 1.0001, `equator coverage at ${lon}: ${total}`);
  }
  assert.equal(cover(82, 0).reduce((a, b) => a + b, 0), 0); // beyond every limb: the daily pass shows instead
  // Clear sky is transparent, cloud opaque; GIBS's coloured (enhanced) pixels are the coldest tops.
  const goes = GEO.find((g) => g.id === 'goes-east')!;
  const mtg = GEO.find((g) => g.id === 'mtg')!;
  assert.deepEqual([cloudiness(goes, 110, 110, 110), cloudiness(goes, 250, 250, 250), cloudiness(goes, 255, 60, 40)], [0, 1, 1]);
  assert.deepEqual([cloudiness(mtg, 50, 50, 50), cloudiness(mtg, 200, 200, 200)], [0, 1]);
  assert.deepEqual([daylight(Math.sin(10 * RAD)), daylight(Math.sin(-20 * RAD))], [1, 0]);
  // Tile geometry: the whole-world tile, and the first row/column centres of a 2×2 z0 grid.
  assert.equal(tileBbox(0, 0, 0), '-20037508.342789244,-20037508.342789244,20037508.342789244,20037508.342789244');
  const ax = tileAxes(0, 0, 0, 2);
  assert.ok(Math.abs(ax.lat[0] / RAD - 66.513) < 0.01 && Math.abs(ax.lon[0] / RAD + 90) < 1e-9);
  // Time: live shows the newest frames; the past shows that day's composite, MODIS before VIIRS flew.
  const now = Date.UTC(2026, 8, 29, 2, 30);
  const live = skyTiles(SKY_DEFAULT, { t: null, now, frames: { 'goes-east': '2026-09-29T02:00:00Z' }, radar: null, aurora: 0 });
  assert.equal(live['live-goes-east']?.[0], 'live://goes-east/clouds/2026-09-29T02:00:00Z/{z}/{x}/{y}');
  assert.equal(live['live-goes-west'], null); // its newest frame isn't known yet
  assert.match(live['live-mtg']![0], /^live:\/\/mtg\/clouds\/latest-\d+\//);
  assert.equal(live.clouds, null);
  const past = skyTiles(SKY_DEFAULT, { t: Date.UTC(2005, 6, 1, 12), now, frames: null, radar: null, aurora: 0 });
  assert.match(past.clouds![0], /MODIS_Terra_CorrectedReflectance_TrueColor\/default\/2005-07-01\//);
  assert.equal(past['live-goes-east']?.[0], 'live://goes-east/clouds/2005-07-01T12:00:00Z/{z}/{x}/{y}');
  assert.equal(past.night?.[0], `night://${Date.UTC(2005, 6, 1, 12)}/{z}/{x}/{y}`);
}

// Fires: FIRMS rows sharing a ~2 km cell merge (FRP summed); low-confidence detections are dropped.
{
  const head = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight';
  const fires = binFires([head,
    '10.001,20.001,300,0.4,0.4,2026-09-27,0041,N20,nominal,2.0NRT,280,5.5,N',
    '10.004,20.003,300,0.4,0.4,2026-09-27,0145,N20,high,2.0NRT,280,4.5,N',
    '-5,30,300,0.4,0.4,2026-09-27,0200,N20,low,2.0NRT,280,99,N', ''].join('\n'));
  assert.deepEqual(fires.f, [10, 20, 10]);
  assert.equal(fires.at, Date.UTC(2026, 8, 27, 1, 45));
}

// Events: a storm's position is its latest point as of the moment asked for; its track is every point so far.
{
  const storm = { events: [{ id: 'E1', title: 'Storm A', categories: [{ id: 'severeStorms' }], geometry: [
    { date: '2026-09-27T00:00:00Z', type: 'Point', coordinates: [-50, 30], magnitudeValue: 40, magnitudeUnit: 'kts' },
    { date: '2026-09-28T00:00:00Z', type: 'Point', coordinates: [-52, 32], magnitudeValue: 50, magnitudeUnit: 'kts' },
  ] }] };
  const [now] = parseEonet(storm);
  assert.deepEqual([now.lon, now.lat, now.track.length, now.magnitude], [-52, 32, 2, '50 kts']);
  const [then] = parseEonet(storm, Date.UTC(2026, 8, 27, 12));
  assert.deepEqual([then.lon, then.track.length], [-50, 1]);
}

// Pulse: big quakes and severe space weather outrank the rest; small quakes aren't news.
{
  const now = Date.UTC(2026, 8, 29, 3);
  const q = (mag: number): Quake => ({ id: `q${mag}`, lat: 0, lon: 0, depth: 10, mag, place: 'x', at: now - 3600_000, url: '', tsunami: false });
  const items = pulseItems({ quakes: [q(4.6), q(6.8), q(3)], events: null, fires: null, launches: null, kp: 7.3, emergencies: null }, now);
  assert.deepEqual(items.map((i) => [i.kind, i.level]), [['aurora', 2], ['quake', 2], ['quake', 0]]);
  assert.equal(items[0].title, 'G3 geomagnetic storm');
}

// Orbits: the ISS from its own elements sits ~420 km up at ~7.7 km/s; seen from beneath, it's overhead.
{
  const [iss] = parseTle([
    'ISS (ZARYA)             ',
    '1 25544U 98067A   26271.46476993  .00006013  00000+0  11848-3 0  9990',
    '2 25544  51.6312 148.9632 0007159 198.2260 161.8473 15.48680135587767',
  ].join('\n'));
  assert.deepEqual([iss.id, iss.intl, iss.group], [25544, '98067A', 'station']);
  const epoch = new Date((iss.rec.jdsatepoch - 2440587.5) * 86400_000);
  const p = subpoint(iss, epoch)!;
  assert.ok(p.alt > 380 && p.alt < 460 && p.speed > 7.5 && p.speed < 7.8, `ISS ${JSON.stringify(p)}`);
  assert.ok(elevation(p.lat, p.lon, p) > 89.9);
  assert.ok(elevation(p.lat + 30, p.lon, p) < 0); // 3,300 km away it's below the horizon…
  assert.ok(Math.abs(footprintKm(420) - 2250) < 25); // …because it only sees ~2,250 km around
  assert.ok(Math.abs(periodMin(iss) - 93) < 1.5);
  assert.equal(nextPass(iss, p.lat, p.lon, epoch)!.start.getTime(), epoch.getTime());
  for (const line of groundTrack(iss, epoch, 50, 100)) {
    for (let i = 1; i < line.length; i++) assert.ok(Math.abs(line[i][0] - line[i - 1][0]) < 180, 'track split at the antimeridian');
  }
  // A satellite once a day around is geostationary; everything else by name.
  assert.equal(groupOf('INTELSAT 901', { ...iss.rec, no: (2 * Math.PI) / 1436 }), 'geo');
  assert.equal(groupOf('STARLINK-1007', iss.rec), 'starlink');
  assert.equal(groupOf('GPS BIIR-2  (PRN 13)', iss.rec), 'gnss');
}

// Radio: one station per stream (the most-voted keeps it); http (unplayable on https), HLS and (0,0) dropped.
{
  const raw = (o: Partial<RawStation>): RawStation => ({
    stationuuid: 'x', name: ' Radio  One ', url_resolved: 'https://a/1', geo_lat: 10, geo_long: 20, countrycode: 'fr',
    tags: 'Jazz,  Blues ,rock,pop', codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, votes: 1, ...o,
  });
  const picked = pickStations([
    raw({}), raw({ stationuuid: 'loved', votes: 5 }), raw({ stationuuid: 'http', url_resolved: 'http://b' }),
    raw({ stationuuid: 'nowhere', url_resolved: 'https://c', geo_lat: 0, geo_long: 0 }), raw({ stationuuid: 'hls', url_resolved: 'https://d', hls: 1 }),
  ]);
  assert.deepEqual(picked.map((s) => [s.id, s.name, s.cc, s.tags]), [['loved', 'Radio One', 'FR', 'jazz, blues, rock']]);
  assert.equal(nearestStations(picked, 10.1, 20.1, 1, 20)[0]?.s.id, 'loved'); // ~16 km away
  assert.equal(nearestStations(picked, 50, 20, 1, 400).length, 0);
  assert.equal(tidyTitle('🔴 Live Now: 24/7 NASA Live Stream of Earth from Space (ISS)'), 'NASA Live Stream of Earth from Space (ISS)');
}

// Wall: never more than four YouTube embeds, one camera per country around the world.
{
  const mk = (i: number, kind: Stream['kind'], country: string): Stream => ({
    id: `w${i}`, kind, name: `w${i}`, latitude: 0, longitude: i, place: `P${i}`, country, timezone: 'UTC',
    category: 'city', source: 'famelack', geocode: 'gazetteer', confidence: 0.8, addedAt: '',
  });
  const pool = [...Array.from({ length: 10 }, (_, i) => mk(i, 'youtube', `C${i}`)), mk(20, 'hls', 'C0'), mk(21, 'snapshot', 'X1'), mk(22, 'mjpeg', 'X2')];
  let seed = 7;
  const picks = pickWall(pool, 9, true, () => ((seed = (seed * 9301 + 49297) % 233280) / 233280));
  assert.ok(picks.filter((s) => s.kind === 'youtube').length <= MAX_YOUTUBE);
  assert.equal(new Set(picks.map((s) => s.country)).size, picks.length);
  assert.ok(picks.length >= 6 && picks.length <= 7, `wall of ${picks.length}`);
  // Equinox at 0°E: the sun is rising just after 06:00 UTC, setting just after 18:00, and at noon neither.
  const at = (h: number, m: number) => sunPhase({ latitude: 0, longitude: 0 }, Date.UTC(2026, 2, 20, h, m));
  assert.deepEqual([at(6, 0), at(18, 0), at(12, 0)], ['rise', 'set', null]);
}

// Camera names: operator codes become road + direction + place words; shouted names are tamed.
assert.equal(cameraName('1068N_75_N/O_GoldenGate_M107', 'I-75', 'Northbound'), 'I-75 Northbound · Golden Gate');
assert.equal(cameraName('CCTV10-US74-271.3E_ANSONVILLE', 'US-74', 'Eastbound'), 'US-74 Eastbound · Ansonville');
assert.equal(cameraName('CHAT-0019: SR 25 at SR 307 PORTS (CHATHAM)'), 'SR 25 at SR 307 Ports (Chatham)');
assert.equal(cameraName('N/A', 'West 4th St @ Woodland Roundabout'), 'West 4th St @ Woodland Roundabout');
assert.equal(cameraName('US 41 · -rwis SULLIVAN'), 'US 41 · Sullivan');
assert.equal(titleCase('PLAZA DE CASTILLA (NORTE)'), 'Plaza de Castilla (Norte)');

// Transverse Mercator: on the central meridian, northing / k0 is the meridian arc (45° N on GRS80: 4 984 944.378 m).
const [lat45, lon45] = tmInverse(500_000, 0.9996 * 4_984_944.378, 9, 0.9996, 500_000);
assert.ok(Math.abs(lat45 - 45) < 1e-6 && lon45 === 9, `tm ${lat45} ${lon45}`);
// Lithuania's "Vilnius A1 10,04" camera (LKS-94) lands 10 km out of Vilnius, not somewhere else.
const [ltLat, ltLon] = tmInverse(576_154, 6_056_867, 24, 0.9998, 500_000);
assert.equal(nearestPlace(g, ltLat, ltLon).place.country, 'LT');
assert.ok(distanceKm(ltLat, ltLon, 54.6872, 25.2797) < 15, `LKS-94 ${ltLat} ${ltLon}`);

// An operator whose probes (nearly) all fail is refused, not dead; a few dead cameras or a tiny sample isn't.
assert.deepEqual([...blockedSources(new Map([
  ['refused', { probed: 40, failed: 38 }], ['some-dead', { probed: 40, failed: 12 }], ['tiny', { probed: 5, failed: 5 }],
]))], ['refused']);

console.log('✔ selftest passed');
