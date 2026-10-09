import type { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import { noise2i } from "../core/prng";
import { valueNoise2D } from "../core/perlin";

/**
 * Open water in one column: [first row, last row]. The first row sits
 * just below the shoreline, which is also the line the renderer mirrors
 * reflections about.
 */
export type WaterSpan = [top: number, bottom: number];

/**
 * Fill one column of open water, banded by depth: pale shallows along the
 * shore (wobbling in width), mid water, and darker deep water further
 * out, each with a noise-shaped edge — flat, hard-edged bands like a
 * tileset's, instead of per-pixel speckle. `nearEdge` gives a pond's
 * near bank too, so it shoals at both edges; a lake has none (it runs
 * off the bottom of the view).
 */
export function paintWaterColumn(
  pm: Pixmap,
  lx: number,
  wx: number,
  top: number,
  bottom: number,
  toneSeed: number,
  nearEdge = false,
): void {
  for (let y = Math.max(0, top); y <= bottom && y < pm.h; y++) {
    const far = y - top;
    const d = nearEdge ? Math.min(far, (bottom - y) * 2) : far;
    const n = valueNoise2D(wx / 18, y / 5, toneSeed);
    const shallow = 3 + n * 4;
    const deep = 13 + valueNoise2D(wx / 40, y / 9, toneSeed + 1) * 12;
    pm.set(lx, y, d < shallow ? C.waterLight : d > deep ? C.waterDark : C.water);
  }
}

/**
 * A sandy shore from `sandTop` down to `waterTop - 1`: a dark grass lip
 * above, pale sand flecked with pebbles, and a band of darker wet sand
 * right at the water. `sandTop` may sit well above `waterTop` where the
 * shoreline is steep (the tapering ends of a lake or pond), so the bank
 * runs down the side instead of leaving the water's edge bare.
 */
export function paintShoreColumn(pm: Pixmap, lx: number, wx: number, sandTop: number, waterTop: number, pebbleSeed: number): void {
  pm.set(lx, sandTop - 1, C.grassDark);
  for (let y = sandTop; y < waterTop; y++) {
    if (y === waterTop - 1) {
      pm.set(lx, y, C.pathDark);
      continue;
    }
    const n = noise2i(pebbleSeed, wx, y);
    pm.set(lx, y, n < 0.05 ? C.roadDark : n > 0.96 ? C.pathLight : C.shore);
  }
}

/** A field pond: a wide, shallow, noise-wobbled oval seen in perspective. */
export interface Pond {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  seed: number;
}

/**
 * The pond's [top, bottom] rows at chunk-local column `x`, or null where
 * it has no water. The far shore sits closer to the centre than the near
 * one (it's foreshortened), and the outline wobbles with low noise so no
 * two ponds are the same oval.
 */
export function pondRows(p: Pond, x: number): [number, number] | null {
  const dx = (x + 0.5 - p.cx) / p.rx;
  if (Math.abs(dx) >= 1) return null;
  const wobble = 0.82 + 0.36 * valueNoise2D(x / 11, 0, p.seed);
  const h = p.ry * Math.sqrt(1 - dx * dx) * wobble;
  const top = Math.round(p.cy - h * 0.7);
  const bottom = Math.round(p.cy + h);
  return bottom - top >= 4 ? [top, bottom] : null;
}
