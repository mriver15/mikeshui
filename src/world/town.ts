import { keyRng } from "../core/prng";
import { BUILDING_SIZE, type BuildingKind } from "../sprites/town";

/**
 * Town planning, in world space. A town is a contiguous stretch of city
 * region; it's found by walking memoized fixed-size cells outward from
 * any x, so every chunk that touches a town agrees on exactly where it
 * starts and ends — and so on one deterministic plan of lots along its
 * street, instead of each chunk scattering its own buildings.
 */

/** Granularity of the city/not-city scan. */
const TOWN_CELL = 32;

/** Street cross-section, from the road's centre line out. */
export const ROAD_HALF = 18;
export const SIDEWALK = 12;
export const STREET_HALF = ROAD_HALF + SIDEWALK;

/** Open margin kept at each end of town before the first lot. */
const TOWN_END_MARGIN = 40;

export type NorthLotKind = BuildingKind | "park";
export type SouthLotKind = "garden" | "trees" | "nook" | "lawn";

/**
 * One plot along the street. North lots sit behind the road (buildings,
 * parks); south lots sit in front of it, nearest the viewer, and hold
 * only low things — gardens, hedges, trees, benches — so they frame the
 * street without hiding it.
 */
export type Lot =
  | { side: "north"; kind: NorthLotKind; x: number; w: number; index: number }
  | { side: "south"; kind: SouthLotKind; x: number; w: number; index: number };

export interface Town {
  /** World x of the first and one-past-last column of town. */
  start: number;
  end: number;
  /** The street's straight centre line (the wavy route path eases onto it). */
  roadY: number;
  lots: Lot[];
}

interface SeedCache {
  cells: Map<number, boolean>;
  towns: Town[];
}

const caches = new Map<string, SeedCache>();

/**
 * The town containing world-x `x`, or within `margin` px of it; null if
 * none. `isCity` classifies a world x; `roadYAt` gives the wavy path
 * centre the town's straight street is levelled to.
 */
export function findTown(
  seed: string,
  x: number,
  margin: number,
  isCity: (x: number) => boolean,
  roadYAt: (x: number) => number,
): Town | null {
  let cache = caches.get(seed);
  if (!cache) {
    cache = { cells: new Map(), towns: [] };
    caches.set(seed, cache);
  }
  for (const t of cache.towns) {
    if (x >= t.start - margin && x < t.end + margin) return t;
  }
  const cells = cache.cells;
  const city = (c: number): boolean => {
    let v = cells.get(c);
    if (v === undefined) {
      v = isCity(c * TOWN_CELL + TOWN_CELL / 2);
      cells.set(c, v);
    }
    return v;
  };
  const c0 = Math.floor((x - margin) / TOWN_CELL);
  const c1 = Math.floor((x + margin) / TOWN_CELL);
  for (let c = c0; c <= c1; c++) {
    if (!city(c)) continue;
    let l = c;
    while (city(l - 1)) l--;
    let r = c;
    while (city(r + 1)) r++;
    const start = l * TOWN_CELL;
    const end = (r + 1) * TOWN_CELL;
    const roadY = Math.round(roadYAt((start + end) / 2));
    const town: Town = { start, end, roadY, lots: planLots(seed, start, end) };
    cache.towns.push(town);
    if (x >= start - margin && x < end + margin) return town;
  }
  return null;
}

/**
 * Lay out a town's lots left to right. North side: mostly houses (one-
 * and two-storey) with the odd park, and — in any town long enough — one
 * healing center and one Mart placed side by side at the first lot past the
 * middle of town. Each building lot gets a yard margin beside the
 * building (room for a tree) and small gaps between lots. South side: a
 * looser rhythm of gardens, trees, bench nooks and plain fenced lawns.
 */
function planLots(seed: string, start: number, end: number): Lot[] {
  const rng = keyRng(seed, "town", start);
  const lots: Lot[] = [];
  const mid = (start + end) / 2;
  const services: BuildingKind[] = end - start > 560 ? ["center", "mart"] : [];

  let x = start + TOWN_END_MARGIN;
  let index = 0;
  for (;;) {
    let kind: NorthLotKind;
    if (services.length > 0 && x + 140 > mid) kind = services.shift()!;
    else {
      const r = rng();
      kind = r < 0.45 ? "house" : r < 0.78 ? "bighouse" : "park";
    }
    const w = kind === "park" ? 96 + Math.floor(rng() * 64) : BUILDING_SIZE[kind].w + 16 + Math.floor(rng() * 44);
    if (x + w > end - TOWN_END_MARGIN) break;
    lots.push({ side: "north", kind, x, w, index: index++ });
    x += w + 6 + Math.floor(rng() * 14);
  }

  x = start + TOWN_END_MARGIN / 2;
  for (;;) {
    const r = rng();
    const kind: SouthLotKind = r < 0.3 ? "garden" : r < 0.6 ? "trees" : r < 0.8 ? "nook" : "lawn";
    const w = 72 + Math.floor(rng() * 72);
    if (x + w > end - TOWN_END_MARGIN / 2) break;
    lots.push({ side: "south", kind, x, w, index: index++ });
    x += w + 12 + Math.floor(rng() * 40);
  }
  return lots;
}
