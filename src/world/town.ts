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
  /** Generated place name, e.g. "Brambleford", and with its rank, "BRAMBLEFORD TOWN". */
  name: string;
  title: string;
  /** The street's straight centre line (the wavy route path eases onto it). */
  roadY: number;
  lots: Lot[];
  people: Walker[];
}

/**
 * A townsperson pacing a stretch of sidewalk: out from `x0` to `x1` and
 * back, pausing at each end. Where they are is a pure function of time
 * (see `walkerAt`), so they cross chunk boundaries freely and every frame
 * agrees on where they are.
 */
export interface Walker {
  x0: number;
  x1: number;
  side: "north" | "south";
  /** px per second, and seconds spent standing at each end. */
  speed: number;
  pause: number;
  /** Where in their round trip they are at time 0, as a fraction. */
  phase: number;
  /** Seed for their look. */
  id: number;
}

/** Where a walker is at `time` (ms), which way they face, and how far they've walked (for the stride). */
export function walkerAt(w: Walker, time: number): { x: number; right: boolean; moving: boolean; walked: number } {
  const len = w.x1 - w.x0;
  const leg = len / w.speed;
  const cycle = 2 * (leg + w.pause);
  const u = (((time / 1000 + w.phase * cycle) % cycle) + cycle) % cycle;
  if (u < leg) return { x: w.x0 + u * w.speed, right: true, moving: true, walked: u * w.speed };
  if (u < leg + w.pause) return { x: w.x1, right: true, moving: false, walked: 0 };
  if (u < 2 * leg + w.pause) {
    const d = (u - leg - w.pause) * w.speed;
    return { x: w.x1 - d, right: false, moving: true, walked: d };
  }
  return { x: w.x0, right: false, moving: false, walked: 0 };
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
    const name = townName(seed, start);
    const title = `${name.toUpperCase()} ${end - start > 4000 ? "CITY" : "TOWN"}`;
    const town: Town = { start, end, name, title, roadY, lots: planLots(seed, start, end), people: planPeople(seed, start, end) };
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

/**
 * Place names are built from a nature word and a place-ending ("Bramble"
 * + "ford"), in the spirit of the games' gentle, pastoral town names but
 * never one of them: any candidate that matches a real series town is
 * rerolled.
 */
const NAME_HEADS = [
  "Amber", "Bramble", "Briar", "Brook", "Cinder", "Clover", "Cobble", "Drift", "Elder", "Ember",
  "Fallow", "Fern", "Flint", "Gale", "Glen", "Hazel", "Heather", "Iris", "Ivy", "Juniper",
  "Kestrel", "Lark", "Linden", "Maple", "Marsh", "Mist", "Moss", "Nettle", "Oak", "Pebble",
  "Pine", "Quill", "Reed", "Rush", "Sage", "Sorrel", "Thistle", "Tide", "Umber", "Wren",
  "Willow", "Yarrow",
];
const NAME_TAILS = [
  "bury", "brook", "cliff", "dale", "field", "gate", "haven", "hollow", "holm", "mere",
  "moor", "port", "ridge", "shire", "stead", "ton", "vale", "wick", "wood", "ford",
];

/** Town and city names from the games, lowercased: generated names must never be one of these. */
const SERIES_TOWNS = new Set([
  "pallet", "viridian", "pewter", "cerulean", "vermilion", "lavender", "celadon", "fuchsia", "saffron", "cinnabar",
  "new bark", "cherrygrove", "violet", "azalea", "goldenrod", "ecruteak", "olivine", "cianwood", "mahogany", "blackthorn",
  "littleroot", "oldale", "petalburg", "rustboro", "dewford", "slateport", "mauville", "verdanturf", "fallarbor",
  "lavaridge", "fortree", "lilycove", "mossdeep", "sootopolis", "pacifidlog", "twinleaf", "sandgem", "jubilife",
  "oreburgh", "floaroma", "eterna", "hearthome", "solaceon", "veilstone", "pastoria", "celestic", "canalave",
  "snowpoint", "sunyshore", "nuvema", "accumula", "striaton", "nacrene", "castelia", "nimbasa", "driftveil",
  "mistralton", "icirrus", "opelucid", "lacunosa", "undella", "aspertia", "floccesy", "virbank", "humilau",
  "lentimas", "vaniville", "aquacorde", "santalune", "lumiose", "camphrier", "ambrette", "cyllage", "geosenge",
  "shalour", "coumarine", "laverre", "dendemille", "anistar", "couriway", "snowbelle", "kiloude",
]);

/** A town's generated name, rolled from its seed and position. */
export function townName(seed: string, start: number): string {
  const rng = keyRng(seed, "townname", start);
  for (;;) {
    const name = NAME_HEADS[Math.floor(rng() * NAME_HEADS.length)] + NAME_TAILS[Math.floor(rng() * NAME_TAILS.length)];
    if (!SERIES_TOWNS.has(name.toLowerCase())) return name;
  }
}

/** About one townsperson per 150px of street, each pacing their own stretch of one sidewalk. */
function planPeople(seed: string, start: number, end: number): Walker[] {
  const rng = keyRng(seed, "people", start);
  const people: Walker[] = [];
  const n = 1 + Math.floor((end - start) / 150);
  for (let i = 0; i < n; i++) {
    const len = 60 + rng() * 140;
    const x0 = start + 30 + rng() * Math.max(1, end - start - 60 - len);
    people.push({
      x0,
      x1: Math.min(end - 30, x0 + len),
      side: rng() < 0.55 ? "north" : "south",
      speed: 10 + rng() * 7,
      pause: 1 + rng() * 2.5,
      phase: rng(),
      id: Math.floor(rng() * 1e9),
    });
  }
  return people;
}
