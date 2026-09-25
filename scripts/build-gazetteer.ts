/**
 * Downloads GeoNames and writes a pruned, committed gazetteer so catalog
 * imports are reproducible offline. Run rarely: `npm run gazetteer`
 * (downloads ~210 MB, of which ~200 MB is the alternate-names file).
 *
 * Output: data/gazetteer/cities.tsv
 *   id  name  lat  lon  country  admin1Code  admin1Name  population  timezone  alternates(|-joined)
 *
 * Alternates come from alternateNamesV2 and keep only current, non-colloquial
 * names tagged with a real language — so "東京" and "Wien" resolve, but a
 * town's 19th-century name doesn't pull streams onto it.
 *
 * GeoNames data is CC BY 4.0 — see ATTRIBUTION.md.
 */
import { createReadStream, mkdirSync, openSync, readSync, fstatSync, closeSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, inflateRawSync } from 'node:zlib';

const DUMP = 'https://download.geonames.org/export/dump';
const SET = process.argv[2] ?? 'cities1000';

interface ZipEntry { name: string; start: number; size: number }

/** List a zip's entries from its central directory (GeoNames zips are plain deflate, no zip64). */
function zipEntries(read: (pos: number, len: number) => Buffer, total: number): ZipEntry[] {
  const tail = read(Math.max(0, total - 65557), Math.min(total, 65557));
  let eocd = tail.length - 22;
  while (eocd >= 0 && tail.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = tail.readUInt16LE(eocd + 10);
  const cd = read(tail.readUInt32LE(eocd + 16), tail.readUInt32LE(eocd + 12));
  const entries: ZipEntry[] = [];
  for (let p = 0, i = 0; i < count; i++) {
    const nameLen = cd.readUInt16LE(p + 28);
    const local = cd.readUInt32LE(p + 42);
    const head = read(local, 30);
    entries.push({
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      size: cd.readUInt32LE(p + 20),
      start: local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28),
    });
    p += 46 + nameLen + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
  }
  return entries;
}

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── admin1 names ─────────────────────────────────────────────────────────────
const admin1 = new Map<string, string>();
for (const line of (await get(`${DUMP}/admin1CodesASCII.txt`)).toString('utf8').split('\n')) {
  const [code, name] = line.split('\t');
  if (code && name) admin1.set(code, name);
}

// ── cities ───────────────────────────────────────────────────────────────────
const citiesZip = await get(`${DUMP}/${SET}.zip`);
const [citiesEntry] = zipEntries((pos, len) => citiesZip.subarray(pos, pos + len), citiesZip.length);
const cities = inflateRawSync(citiesZip.subarray(citiesEntry.start, citiesEntry.start + citiesEntry.size))
  .toString('utf8').split('\n').map((l) => l.split('\t')).filter((f) => f.length >= 19);
const ids = new Set(cities.map((f) => f[0]));

// ── alternate names (streamed; the file is ~700 MB inflated) ─────────────────
const altPath = join(tmpdir(), 'geonames-alternateNamesV2.zip');
console.log('downloading alternateNamesV2.zip …');
const res = await fetch(`${DUMP}/alternateNamesV2.zip`);
if (!res.ok || !res.body) throw new Error(`alternateNamesV2.zip → HTTP ${res.status}`);
// DOM and Node type the same web stream differently.
await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), createWriteStream(altPath));

const fd = openSync(altPath, 'r');
const altEntry = zipEntries((pos, len) => {
  const b = Buffer.alloc(len);
  readSync(fd, b, 0, len, pos);
  return b;
}, fstatSync(fd).size).find((e) => e.name === 'alternateNamesV2.txt');
closeSync(fd);
if (!altEntry) throw new Error('alternateNamesV2.txt missing from zip');

/** Language-code column values that are not languages (links, postcodes, airport codes, …). */
const NOT_A_LANGUAGE = new Set(['', 'link', 'post', 'iata', 'icao', 'faac', 'abbr', 'wkdt', 'unlc', 'tcid', 'phon', 'piny']);
const alternates = new Map<string, Set<string>>();
const lines = createInterface({
  input: createReadStream(altPath, { start: altEntry.start, end: altEntry.start + altEntry.size - 1 }).pipe(createInflateRaw()),
});
for await (const line of lines) {
  const [, geonameId, lang, name, , , isColloquial, isHistoric] = line.split('\t');
  if (!ids.has(geonameId) || NOT_A_LANGUAGE.has(lang) || lang.includes('_') || isColloquial === '1' || isHistoric === '1') continue;
  if (name.length < 2 || /\d/.test(name)) continue;
  let set = alternates.get(geonameId);
  if (!set) alternates.set(geonameId, (set = new Set()));
  set.add(name);
}

// ── write ────────────────────────────────────────────────────────────────────
const rows = cities.map((f) => {
  const [id, name, , , lat, lon, , , cc, , a1, , , , pop, , , tz] = f;
  const alts = [...(alternates.get(id) ?? [])].filter((a) => a !== name);
  return [id, name, lat, lon, cc, a1, admin1.get(`${cc}.${a1}`) ?? '', pop, tz, alts.join('|')].join('\t');
});

if (rows.length < 10000) throw new Error(`gazetteer suspiciously small (${rows.length} rows) — not writing`);
mkdirSync('data/gazetteer', { recursive: true });
writeFileSync('data/gazetteer/cities.tsv', rows.join('\n') + '\n');
console.log(`wrote ${rows.length} places from GeoNames ${SET}, ${[...alternates.values()].reduce((n, s) => n + s.size, 0)} alternate names`);
