/** `npm test` — assert-based checks for the parts that are easy to break silently. */
import assert from 'node:assert/strict';
import { distanceKm, geocode, loadGazetteer, nearestPlace } from './geocode';
import { blockedSources, cameraName, titleCase, tmInverse } from './agencies';
import { subsolarPoint, sunAltitude } from '../lib/solar';
import { fillNoData } from '../lib/clouds';
import { cloudsDate, zonedClock } from '../lib/time';
import { parseFlights, project } from '../lib/flights';
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
