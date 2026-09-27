/** `npm test` — assert-based checks for the parts that are easy to break silently. */
import assert from 'node:assert/strict';
import { distanceKm, geocode, loadGazetteer, nearestPlace } from './geocode';
import { blockedSources, cameraName, titleCase, tmInverse } from './agencies';
import { POLE_LIMIT_LAT, nightBands, subsolarPoint, sunAltitude } from '../lib/solar';
import { cloudsDate, zonedClock } from '../lib/time';
import { parseFlights, project } from '../lib/flights';

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
const bands = nightBands(new Date('2026-06-21T12:00:00Z'));
assert.equal(bands.features.length, 10);
assert.ok(bands.features.every((f) => f.geometry.coordinates[0].length > 100));

// The terminator's real invariant: what the band polygons cover must match what the sun actually
// does. Evaluating sun altitude per point is the truth; the polygons are an approximation of it,
// and every way they have gone wrong shows up as a disagreement near a pole — a vertex at lat ±90
// projecting to infinity (a wedge), over-clamping to the tile grid's 85.0511° (an unshaded disc),
// or too coarse a bearing step (scalloped, bulging edges). Equinox is the hard case: the poles sit
// right on the terminator, where the caps crowd together and longitude moves fastest.
const inRing = (ring: GeoJSON.Position[], lat: number, lon: number) => {
  for (const shift of [0, 360, -360]) {
    const x = lon + shift;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
};
const DEPRESSIONS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
for (const iso of ['2026-09-27T12:00:00Z', '2026-03-20T09:00:00Z', '2026-06-21T12:00:00Z', '2026-12-21T03:00:00Z']) {
  const date = new Date(iso);
  const sun = subsolarPoint(date);
  const polys = nightBands(date).features.map((f) => f.geometry.coordinates[0]);
  // Strictly inside the clamp and off the ±180 seam: a sample exactly on a polygon edge has no
  // defined answer under an even-odd test.
  for (const lat of [89.9, 89, 87, 85.05, 83, 80, -80, -85.05, -89, -89.9]) {
    for (let lon = -176; lon < 180; lon += 7) {
      const alt = sunAltitude(lat, lon, sun);
      // Skip points sitting on a band edge, where either side is a fair answer.
      if (DEPRESSIONS.some((d) => Math.abs(alt + d) < 0.05)) continue;
      const truth = DEPRESSIONS.filter((d) => alt < -d).length;
      const drawn = polys.filter((ring) => inRing(ring, lat, lon)).length;
      assert.equal(drawn, truth, `${iso} lat ${lat} lon ${lon}: ${drawn} bands drawn, sun ${alt.toFixed(2)}° wants ${truth}`);
    }
  }
}
// A pole has no finite Mercator y, so a vertex there renders as a wedge — but it is a perfectly
// valid lat/lon, so the coverage check above cannot see it. Bound it against a literal rather than
// POLE_LIMIT_LAT, which would just be comparing the constant with itself.
assert.ok(POLE_LIMIT_LAT < 90);
for (let day = 0; day < 365; day += 1) {
  for (const f of nightBands(new Date(Date.UTC(2026, 0, 1 + day, 12))).features) {
    for (const [, lat] of f.geometry.coordinates[0]) assert.ok(Math.abs(lat) <= 89.99, `vertex at lat ${lat}`);
  }
}

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
