/** Lattice hash, [0, 1). */
function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

// Kept at module level: closures built inside noise() made it ~20× slower.
const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Smooth 3-D value noise, [0, 1). */
function noise(x: number, y: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = fade(x - i), v = fade(y - j), w = fade(z - k);
  return lerp(
    lerp(lerp(hash(i, j, k), hash(i + 1, j, k), u), lerp(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
    lerp(lerp(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), lerp(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v),
    w,
  );
}

/**
 * A stand-in cloud's grey level at a point on the unit sphere: fractal noise on the sphere itself,
 * so it runs on across tiles, zoom levels and the antimeridian without a seam. Toned like the real
 * imagery along the edge of the gap: mostly near-white, greyer in the thin parts.
 */
function fakeCloud(x: number, y: number, z: number, octaves: number): number {
  let d = 0, sum = 0;
  for (let o = 0, f = 6, a = 1; o < octaves; o++, f *= 2, a /= 2) {
    d += a * noise(f * x + 17 * o, f * y + 31 * o, f * z + 11 * o);
    sum += a;
  }
  return 175 + 77 * fade(clamp01((d / sum - 0.25) / 0.32));
}

/**
 * GIBS paints wherever VIIRS saw nothing — the unlit polar caps and the ragged swath edges around
 * them — as solid black. This paints stand-in clouds over it in one tile's RGBA pixels, in place:
 * every solid block of near-black (a 3×3 core), grown back out by two texels to take the JPEG blur
 * along its edge. Dark water in the imagery only ever comes as specks of near-black, never a 3×3
 * block of it, so it stays. `tile` places the pixels on the globe. Returns whether anything changed.
 */
export function fillNoData(px: Uint8ClampedArray, w: number, h: number, tile: { z: number; x: number; y: number }): boolean {
  /** Is there a pixel equal to `v` in `m` within `r` texels of `p`? The window stops at the tile edge. */
  const near = (m: Uint8Array, p: number, r: number, v: number) => {
    const x = p % w, y = (p - x) / w;
    for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) {
      for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) if (m[j * w + i] === v) return true;
    }
    return false;
  };
  // No-data decodes as exact zeros; the ringing along its edge is what the grow is for.
  const dark = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) dark[p] = Math.max(px[4 * p], px[4 * p + 1], px[4 * p + 2]) < 12 ? 1 : 0;
  const core = dark.map((_, p) => (near(dark, p, 1, 0) ? 0 : 1));
  if (!core.includes(1)) return false;

  // The noise is the costly part, so it is sampled every G texels (the far edge included, so
  // neighbouring tiles meet on the same values) and blended between. Detail follows zoom.
  const G = 4, gw = Math.ceil(w / G) + 1, gh = Math.ceil(h / G) + 1;
  const n = 2 ** tile.z, octaves = Math.min(8, 4 + tile.z);
  const grid = new Float32Array(gw * gh);
  for (let b = 0; b < gh; b++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + (b * G + 0.5) / h)) / n)));
    // MapLibre smears each polar tile's outer row across the last 5° to the pole; flattening to one
    // tone by then keeps that smear from drawing a pinwheel.
    const flat = fade(clamp01(((Math.abs(lat) * 180) / Math.PI - 80) / 5));
    for (let a = 0; a < gw; a++) {
      const lon = (2 * Math.PI * (tile.x + (a * G + 0.5) / w)) / n - Math.PI;
      const cloud = fakeCloud(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat), octaves);
      grid[b * gw + a] = lerp(cloud, 240, flat);
    }
  }
  for (let p = 0; p < w * h; p++) {
    // Dark leftovers a little further out are slivers of the gap and JPEG undershoot, not imagery.
    const dim = Math.max(px[4 * p], px[4 * p + 1], px[4 * p + 2]) < 96;
    if (!near(core, p, 2, 1) && !(dim && near(core, p, 4, 1))) continue;
    const x = p % w, y = (p - x) / w, q = Math.floor(y / G) * gw + Math.floor(x / G);
    const fx = (x % G) / G, fy = (y % G) / G;
    px.fill(lerp(lerp(grid[q], grid[q + 1], fx), lerp(grid[q + gw], grid[q + gw + 1], fx), fy), 4 * p, 4 * p + 3);
  }
  return true;
}
