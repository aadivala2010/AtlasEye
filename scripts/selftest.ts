/** `npm test` — assert-based checks for the parts that are easy to break silently. */
import assert from 'node:assert/strict';
import { geocode, loadGazetteer } from './geocode';
import { nightBands, subsolarPoint, sunAltitude } from '../lib/solar';
import { zonedClock } from '../lib/time';

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

// Solar: at the June solstice the subsolar point sits on the Tropic of Cancer, near 0° at 12:00 UTC.
const solstice = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
assert.ok(Math.abs(solstice.lat - 23.44) < 0.2, `solstice lat ${solstice.lat}`);
assert.ok(Math.abs(solstice.lon) < 2.5, `solstice lon ${solstice.lon}`);
assert.ok(sunAltitude(0, 0, solstice) > 60);
assert.ok(sunAltitude(0, 180, solstice) < -60);
const bands = nightBands(new Date('2026-06-21T12:00:00Z'));
assert.equal(bands.features.length, 10);
assert.ok(bands.features.every((f) => f.geometry.coordinates[0].length > 100));

// Clocks: Tokyo has no DST.
assert.deepEqual(zonedClock(new Date('2026-01-01T00:00:00Z'), 'Asia/Tokyo'), { time: '09:00:00', offset: 'UTC+9' });

console.log('✔ selftest passed');
