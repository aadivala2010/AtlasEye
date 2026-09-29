/**
 * GIBS paints wherever VIIRS saw nothing — the unlit polar caps and the ragged swath edges around
 * them — as solid black, and laid over the imagery that black dimmed both poles into a dark disc.
 * This keys it out of one tile's RGBA pixels, in place: every solid block of near-black (a 3×3
 * core), grown back out by two texels to take the JPEG blur along its edge. Dark water in the
 * imagery only ever comes as specks of near-black, never a 3×3 block of it, so it stays.
 * Returns whether anything was keyed.
 */
export function keyNoData(px: Uint8ClampedArray, w: number, h: number): boolean {
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
  for (let p = 0; p < w * h; p++) if (near(core, p, 2, 1)) px.fill(0, 4 * p, 4 * p + 4);
  return true;
}
