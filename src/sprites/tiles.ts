import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import type { RNG } from "../core/prng";

/** World tile size in pixels (2× resolution). */
export const TILE = 32;

/** A clump of tall grass blades (transparent background, drawn over the field). */
export function tallGrassTile(rng: RNG): Pixmap {
  const p = new Pixmap(TILE, TILE);
  for (let i = 0; i < 5; i++) {
    const bx = 2 + i * 6 + Math.floor(rng() * 3);
    const baseY = 24 + Math.floor(rng() * 6);
    const h = 6 + Math.floor(rng() * 5);
    const lean = rng() < 0.5 ? -1 : 1;
    for (let yy = 0; yy < h; yy++) {
      const x = bx + Math.floor((yy * lean) / 3);
      const y = baseY - yy;
      const c = yy < 2 ? C.tallGrassLight : C.tallGrass;
      p.set(x, y, c);
      p.set(x + 1, y, c);
    }
  }
  return p;
}

/**
 * Sparse ground-texture ticks: a handful of 1-2px grass-blade marks per
 * tile, GBA-dither style — authored, fixed-position-per-tile texture
 * instead of continuous per-pixel noise, so open fields read as grass
 * rather than static.
 */
export function grassTickTile(rng: RNG, dense: boolean): Pixmap {
  const p = new Pixmap(TILE, TILE);
  const n = dense ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const c = rng() < 0.5 ? C.grassDark : C.grassLight;
    p.set(x, y, c);
    if (rng() < 0.6) p.set(x, Math.max(0, y - 1), c);
  }
  return p;
}

/**
 * Sparse path/road texture: a few pebble-like flecks for dirt, short seam
 * marks for pavement — same authored-tick approach as grassTickTile, in
 * place of per-pixel noise thresholding.
 */
export function pathTickTile(rng: RNG, paved: boolean): Pixmap {
  const p = new Pixmap(TILE, TILE);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rng() * TILE);
    const y = Math.floor(rng() * TILE);
    const c = rng() < 0.5 ? (paved ? C.roadDark : C.pathDark) : (paved ? C.roadLight : C.pathLight);
    p.set(x, y, c);
    if (!paved && rng() < 0.5) p.set(x + 1, y, c);
  }
  return p;
}

/** A single flower bloom on transparent background. */
export function flowerTile(rng: RNG): Pixmap {
  const p = new Pixmap(TILE, TILE);
  const r = rng();
  const petal =
    r < 0.42 ? C.flowerRed : r < 0.66 ? C.flowerYellow : r < 0.88 ? C.flowerWhite : C.flowerOrange;
  const cx = 6 + Math.floor(rng() * 20);
  const cy = 6 + Math.floor(rng() * 20);
  const px = [
    [0, -4], [-2, -2], [0, -2], [2, -2],
    [-4, 0], [-2, 0], [2, 0], [4, 0],
    [-2, 2], [0, 2], [2, 2], [0, 4],
  ];
  for (const [dx, dy] of px) p.set(cx + dx, cy + dy, petal);
  p.set(cx, cy, C.flowerYellow);
  // stem
  p.set(cx, cy + 5, C.grassDark);
  p.set(cx + 1, cy + 5, C.grassDark);
  return p;
}
