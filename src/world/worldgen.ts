import { Pixmap, blit, blitScaled } from "../core/pixmap";
import { C } from "../core/palette";
import { keyRng, noise2i, hashString } from "../core/prng";
import { smoothstep } from "../core/dither";
import { fbm1D, valueNoise2D } from "../core/perlin";
import { flowerTile, grassTickTile, pathTickTile, TILE } from "../sprites/tiles";
import {
  treeTrunkPixmap,
  fernPixmap,
  logPixmap,
  reedsPixmap,
  drawLilyPad,
  FERN_W,
  FERN_H,
  LOG_H,
  REEDS_W,
  REEDS_H,
  type TreeKind,
  treeSpec,
  berryTrunkPixmap,
  drawTreeBaseClutter,
  type TreeSpec,
  berryBushPixmap,
  fencePixmap,
  trainerPixmap,
  TREE_W,
  TREE_H,
} from "../sprites/objects";
import {
  buildingPixmap,
  streetlampPixmap,
  benchPixmap,
  flowerBedPixmap,
  picketFencePixmap,
  hedgePixmap,
  mailboxPixmap,
  townSignPixmap,
  BUILDING_SIZE,
  PICKET_H,
  HEDGE_H,
  LAMP_W,
  LAMP_H,
} from "../sprites/town";
import { paintWaterColumn, paintShoreColumn, pondRows, type Pond, type WaterSpan } from "./water";
import { ITEMS } from "../sprites/items";
import { findTown, ROAD_HALF, STREET_HALF, type Town, type Lot } from "./town";

export const VIEW_H = 320;
export const CHUNK_TILES = 16;
export const CHUNK_W = CHUNK_TILES * TILE;
export const HORIZON = 128;
export const LAKE_TOP = 276;

const TRAINER_W = 32;
const TRAINER_H = 60;

/** Tree placement attempts per chunk; how many survive is set by region density and groves. */
const TREE_CANDIDATES = 44;

// --- regions ---
const REGION_ROUTE = 0;
const REGION_FOREST = 1;
const REGION_CITY = 2;

/**
 * What spawns in a region and how often — the one place to edit when
 * adding a new region, instead of hunting down `region === REGION_X`
 * checks scattered through generateChunk. Covers only the natural
 * regions: city stretches are laid out as towns (see `./town` and
 * `placeTown`), and the countryside around a town — any part of a city
 * chunk outside the town itself — uses the route config. Deliberately
 * does NOT cover ground/path color: that's a continuous blend (see
 * `regionWeights` below), a different mechanism.
 */
interface RegionConfig {
  name: string;
  hasLake: boolean;
  hasTrainer: boolean;
  treeDensityUpland: number;
  treeDensityLowland: number;
  /** Fraction of trees that are conifers, before the local pine-stand noise scales it. */
  coniferShare: number;
  /** Multiplier on forest-floor undergrowth: ferns and fallen logs. */
  undergrowth: number;
  /** Chance a chunk has a small pond out in the field. */
  pondChance: number;
  hasBerryTree: boolean;
  hasBushes: boolean;
  hasTallGrass: boolean;
  hasFlowers: boolean;
  hasFence: boolean;
}

const REGION_CONFIGS: Record<typeof REGION_ROUTE | typeof REGION_FOREST, RegionConfig> = {
  [REGION_ROUTE]: {
    name: "route",
    hasLake: true,
    hasTrainer: true,
    treeDensityUpland: 0.3,
    treeDensityLowland: 0.22,
    coniferShare: 0.12,
    undergrowth: 0.35,
    pondChance: 0.2,
    hasBerryTree: true,
    hasBushes: true,
    hasTallGrass: true,
    hasFlowers: true,
    hasFence: true,
  },
  [REGION_FOREST]: {
    name: "forest",
    hasLake: true,
    hasTrainer: false,
    treeDensityUpland: 0.55,
    treeDensityLowland: 0.4,
    coniferShare: 0.45,
    undergrowth: 1,
    pondChance: 0.3,
    hasBerryTree: true,
    hasBushes: true,
    hasTallGrass: true,
    hasFlowers: true,
    hasFence: false,
  },
};

function regionAt(x: number, seed: string): number {
  const v = fbm1D(x / 8000, seed + ":region", 3);
  if (v > 0.72) return REGION_CITY;
  if (v > 0.5) return REGION_FOREST;
  return REGION_ROUTE;
}

/** How far outside a town its influence (path widening and levelling, tidier ground) reaches. */
const TOWN_APPROACH = 160;

/** The town at (or within `margin` px of) world-x `x`, if any. */
function townNear(x: number, seed: string, margin = 0): Town | null {
  return findTown(seed, x, margin, (cx) => regionAt(cx, seed) === REGION_CITY, (cx) => wavyPathCenter(cx, seed));
}

function inTown(x: number, seed: string): boolean {
  return townNear(x, seed) !== null;
}

/**
 * Continuous region weights for smooth ground/path blending. `urban` is 1
 * inside a town, easing to 0 over `TOWN_APPROACH` px outside it — tied to
 * the town's exact extent, so the street, its approach and the edge of
 * the countryside all agree on where town begins.
 */
function regionWeights(x: number, seed: string): { urban: number; forest: number } {
  const v = fbm1D(x / 8000, seed + ":region", 3);
  const t = townNear(x, seed, TOWN_APPROACH);
  let urban = 0;
  if (t) {
    const d = x < t.start ? t.start - x : x >= t.end ? x - t.end + 1 : 0;
    urban = 1 - smoothstep(0, TOWN_APPROACH, d);
  }
  const forest = smoothstep(0.46, 0.56, v) * (1 - urban);
  return { urban, forest };
}

// --- continuous terrain curves (functions of world x, seam-free) ---

/** One named stretch of the world, for the location banner. */
export interface Area {
  /** Stable identity: the banner shows when this changes. */
  key: string;
  title: string;
  kind: "town" | "route";
}

/**
 * Countryside is divided into numbered routes of this length; towns
 * interrupt them. Long enough to feel like a journey, short enough that
 * the world between distant towns still has landmarks.
 */
const ROUTE_LEN = 8192;

/** The named area at world-x `x`: the town there, or else the route. */
export function areaAt(x: number, seed: string): Area {
  const town = townNear(x, seed);
  if (town) return { key: `town:${town.start}`, title: town.title, kind: "town" };
  const id = Math.floor(x / ROUTE_LEN);
  return { key: `route:${id}`, title: `ROUTE ${101 + (((id % 34) + 34) % 34)}`, kind: "route" };
}

/** The weather at a stretch of the world: rain and fog, each 0..1. */
export interface Weather {
  rain: number;
  fog: number;
}

/**
 * Weather is part of the place: slow noise across the world decides
 * where it rains (a little more often over forest) and where fog lies,
 * each easing in and out over a few hundred px, so walking into a rainy
 * stretch brings the rain on gradually and walking out clears it.
 */
export function weatherAt(x: number, seed: string): Weather {
  const { forest } = regionWeights(x, seed);
  const rain = smoothstep(0.6, 0.7, fbm1D(x / 7000, seed + ":rain", 2) + forest * 0.06);
  const fog = smoothstep(0.62, 0.72, fbm1D(x / 5200, seed + ":fog", 2)) * (1 - rain * 0.6);
  return { rain, fog };
}

/** The route path's natural meander. */
function wavyPathCenter(x: number, seed: string): number {
  return 200 + fbm1D(x / 320, seed + ":path", 2) * 28;
}

/**
 * The path's centre line: the natural meander out in the country, eased
 * onto a town's dead-straight street as the route approaches it.
 */
function pathCenter(x: number, seed: string): number {
  const wavy = wavyPathCenter(x, seed);
  const t = townNear(x, seed, TOWN_APPROACH);
  if (!t) return wavy;
  return wavy + (t.roadY - wavy) * regionWeights(x, seed).urban;
}

/** Below this half-width the path has petered out entirely. */
const PATH_MIN_HALF = 3;

/**
 * The path's [top, bottom] rows at world-x `x` — the one definition both
 * drawing and placement use. In town it's the full street (road plus
 * sidewalks), and it widens to match on the approach; as forest
 * takes over it narrows to a thin trail and then ends, instead of being
 * dithered away and stopping at a hard vertical edge. Each edge wobbles a
 * pixel or two in the woods, where nobody keeps the verges straight.
 * Returns null where there's no path.
 */
function pathBand(x: number, seed: string): [number, number] | null {
  const t = townNear(x, seed);
  if (t) return [t.roadY - STREET_HALF, t.roadY + STREET_HALF];
  const { urban, forest } = regionWeights(x, seed);
  const half = (26 + urban * (STREET_HALF - 26)) * (1 - smoothstep(0.3, 0.85, forest));
  if (half < PATH_MIN_HALF) return null;
  const c = Math.round(pathCenter(x, seed));
  const ragged = Math.min(1, forest * 2);
  const pathSeed = hashString(seed + ":pathedge");
  const jt = Math.round((noise2i(pathSeed, x >> 2, 0) * 2 - 1) * 1.5 * ragged);
  const jb = Math.round((noise2i(pathSeed, x >> 2, 1) * 2 - 1) * 1.5 * ragged);
  return [c - Math.round(half) + jt, c + Math.round(half) + jb];
}

/**
 * Continuous lake presence in [0,1]: 0 = dry land, 1 = open lake. A smooth
 * ramp (not a hard threshold) so shorelines taper in as the lake begins and
 * out as it ends, instead of the water block snapping on/off at a sharp
 * vertical edge.
 */
function lakeDepth(x: number, seed: string): number {
  return smoothstep(0.58, 0.74, fbm1D(x / 520, seed + ":lake", 2));
}

function inLake(x: number, seed: string): boolean {
  return lakeDepth(x, seed) > 0.15;
}

/** Whether a horizontal span [x0, x0+w) crosses any lake water (non-city). */
function overWater(x0: number, w: number, seed: string): boolean {
  for (let sx = x0; sx <= x0 + w; sx += 24) {
    if (!inTown(sx, seed) && inLake(sx, seed)) return true;
  }
  return false;
}

/**
 * Lake surface y for a world-x column. Tapers toward the bottom of the
 * screen (vanishingly thin water) as the shore approaches, matching the
 * `lakeDepth` ramp used to fill it, so start/end edges blend rather than
 * cutting off as a flat-walled block.
 */
function waterSurfaceY(x: number, seed: string): number {
  const depth = lakeDepth(x, seed);
  const base = LAKE_TOP + Math.sin(x * 0.06) * 4;
  return Math.round(base + (1 - depth) * (VIEW_H - base));
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A placed tall-grass tile, in world-space, with the exact keyRng args
 * used to generate it — enough for the renderer to regenerate the same
 * blade layout each frame with a different sway, without having to
 * replay chunk generation.
 */
export interface TallGrassSpot {
  x: number;
  y: number;
  k: number;
  i: number;
  t: number;
  /** Draw-order depth in the chunk's depth buffer (see `ChunkResult.depth`). */
  depth: number;
}

/** A placed tree, in world-space, with what's needed to redraw it swaying. */
export interface TreeSpot {
  x: number;
  y: number;
  scale: number;
  spec: TreeSpec;
  /** Draw-order depth in the chunk's depth buffer (see `ChunkResult.depth`). */
  depth: number;
}

/** A placed berry tree (fixed look) — a position and its draw-order depth. */
export interface BerryTreeSpot {
  x: number;
  y: number;
  depth: number;
}

/** A street lamp, for the renderer's light pools after dark (chunk-local x). */
export interface LampLight {
  x: number;
  /** Lantern centre and the ground row the lamp stands on. */
  headY: number;
  baseY: number;
}

/** Something hidden in the grass, found by tapping its glint (chunk-local x). */
export interface HiddenItem {
  x: number;
  y: number;
  /** Index into ITEMS (sprites/items.ts). */
  kind: number;
}

export interface ChunkResult {
  pixmap: Pixmap;
  items: HiddenItem[];
  lights: LampLight[];
  /**
   * Open water per column (index = chunk-local x): lake and pond spans,
   * for the renderer's per-frame reflections, ripples and foam.
   */
  water: WaterSpan[][];
  /**
   * Per-pixel draw-order depth, same size as `pixmap`: 0 for ground, else
   * the 1-based sort index of the object that last painted that pixel.
   * Tree canopies and tall grass aren't baked into `pixmap` — they sway,
   * so the renderer draws them every frame, in depth order, writing only
   * pixels whose depth is <= their own, so a canopy behind a nearer tree
   * or bush can't paint over it.
   */
  depth: Uint16Array;
  /**
   * Base y of the object behind each depth value (`GROUND_BASE` for 0):
   * how near it stands, comparable between chunks — used to light only
   * what's behind a street lamp.
   */
  depthBase: Int16Array;
  tallGrass: TallGrassSpot[];
  trees: TreeSpot[];
  berryTrees: BerryTreeSpot[];
}

/**
 * Something standing on the ground, drawn in base-y order with everything
 * else in the chunk so nearer things overlap farther ones. `ground` (if
 * any) runs in a pre-pass before every `draw`, for shadows: they belong to
 * the ground, so no object should end up drawn underneath another's shadow.
 * `bounds` must cover every pixel `draw` can touch — it's the region diffed
 * to fill the depth buffer. `spot`, if given, receives the object's depth.
 */
interface Drawable {
  baseY: number;
  bounds: Rect;
  ground?: () => void;
  /** Omitted for things drawn entirely per frame (tall grass), which only need a depth. */
  draw?: () => void;
  spot?: { depth: number };
}

/**
 * Draw `items` back to front (by base y; ties keep insertion order) and
 * return a depth buffer recording which item last painted each pixel —
 * found by diffing each item's bounds before and after it draws, which
 * keeps every sprite routine oblivious to depth — plus each depth's base
 * y, which (unlike the depth itself) compares across chunks.
 */
function drawSorted(pm: Pixmap, items: Drawable[]): { depth: Uint16Array; depthBase: Int16Array } {
  const depth = new Uint16Array(pm.w * pm.h);
  const depthBase = new Int16Array(items.length + 1);
  depthBase[0] = GROUND_BASE;
  for (const item of items) item.ground?.();
  const order = items.map((item, i) => ({ item, i })).sort((a, b) => a.item.baseY - b.item.baseY || a.i - b.i);
  order.forEach(({ item }, n) => {
    const d = n + 1;
    depthBase[d] = item.baseY;
    const x0 = Math.max(0, Math.floor(item.bounds.x));
    const y0 = Math.max(0, Math.floor(item.bounds.y));
    const x1 = Math.min(pm.w, Math.ceil(item.bounds.x + item.bounds.w));
    const y1 = Math.min(pm.h, Math.ceil(item.bounds.y + item.bounds.h));
    if (x1 <= x0 || y1 <= y0) {
      // wholly outside this chunk (a town object belonging to a
      // neighbour): nothing here to record, though it still gets a depth
      item.draw?.();
      if (item.spot) item.spot.depth = d;
      return;
    }
    const bw = x1 - x0;
    const before = new Uint8Array(bw * (y1 - y0));
    for (let y = y0; y < y1; y++) before.set(pm.data.subarray(y * pm.w + x0, y * pm.w + x1), (y - y0) * bw);
    item.draw?.();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (pm.data[y * pm.w + x] !== before[(y - y0) * bw + (x - x0)]) depth[y * pm.w + x] = d;
      }
    }
    if (item.spot) item.spot.depth = d;
  });
  return { depth, depthBase };
}

/** `depthBase` entry for bare ground: behind everything that stands on it. */
export const GROUND_BASE = -32768;

/** `groveAt` runs per ground pixel in forest, so its noise seed is hashed once per world seed, not per call. */
const groveSeeds = new Map<string, number>();

/**
 * Local grove strength at a ground point: low-frequency 2-D noise mapped
 * so most of the field sits near 0.2 (open, sparse trees) and the peaks
 * reach 2 (a grove dense enough to saturate the region's tree density).
 * Stretched wider than tall, since the view is a wide, shallow strip.
 */
function groveAt(wx: number, y: number, seed: string): number {
  let groveSeed = groveSeeds.get(seed);
  if (groveSeed === undefined) {
    groveSeed = hashString(seed + ":grove");
    groveSeeds.set(seed, groveSeed);
  }
  const n = valueNoise2D(wx / 110, y / 48, groveSeed);
  return 0.2 + 1.8 * smoothstep(0.4, 0.78, n);
}

/**
 * Broadleaf or conifer for a tree at (wx, y). Conifers come in stands —
 * a slow 2-D noise scales the region's base share up to ~1.7× in some
 * stretches and down to ~0.3× in others — rather than being sprinkled
 * evenly through every grove.
 */
function treeKindAt(wx: number, y: number, share: number, rng: () => number, seed: string): TreeKind {
  const stand = valueNoise2D(wx / 240, y / 90, hashString(seed + ":pines"));
  const local = share * (0.3 + 1.4 * smoothstep(0.35, 0.7, stand));
  return rng() < local ? "conifer" : "broadleaf";
}

/** The patch of ground a tree's trunk and roots take up: what must be clear of the path, water and other trunks. */
function treeFootprint(cx: number, baseY: number, scale: number): Rect {
  const w = 26 * scale;
  return { x: cx - w / 2, y: baseY - 8, w, h: 10 };
}

/** Every pixel a grounded tree (sprite plus base clutter) can paint. */
function groundedTreeBounds(x: number, y: number, scale: number): Rect {
  return { x: x - 2, y, w: TREE_W * scale + 4, h: TREE_H * scale + 6 * scale };
}

/**
 * A tree's shadow: pooled slightly right of the trunk (light comes from
 * the upper left, like the canopy highlights), built from a few
 * overlapping ellipses rather than one clean oval. (x, y) is the tree
 * sprite's top-left in `pm`. Consumes `rng` before `drawGroundedTree`
 * does, so pass both the same stream in that order.
 */
function drawTreeShadow(pm: Pixmap, x: number, y: number, scale: number, rng: () => number): void {
  const cx = x + (TREE_W * scale) / 2;
  const baseY = y + Math.round(61 * scale);
  pm.fillEllipse(cx + 3 * scale, baseY - 1, 17 * scale, 3.5 * scale, C.grassDark);
  for (let i = 0; i < 2; i++) {
    const ox = (rng() * 2 - 1) * 10 * scale;
    pm.fillEllipse(cx + ox + 2 * scale, baseY + (rng() - 0.3) * 2 * scale, (6 + rng() * 6) * scale, 2.5 * scale, C.grassDark);
  }
}

/**
 * The tree's trunk and roots (its canopy is drawn per frame by the
 * renderer, see `treeCanopyPixmap`), then grass tufts and odd bits of clutter drawn over
 * its roots so it reads as growing out of the field, not stamped onto it.
 */
function drawGroundedTree(pm: Pixmap, x: number, y: number, scale: number, spec: TreeSpec, rng: () => number): void {
  const cx = x + (TREE_W * scale) / 2;
  const baseY = y + Math.round(61 * scale);
  blitScaled(pm, treeTrunkPixmap(spec), x, y, scale);
  drawTreeBaseClutter(pm, cx, baseY + Math.round(scale), scale, rng);
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function groundFree(
  r: Rect,
  x0: number,
  seed: string,
  occupied: Rect[],
): boolean {
  if (r.x < 0 || r.y < 0 || r.x + r.w > CHUNK_W || r.y + r.h > VIEW_H) {
    return false;
  }
  for (let lx = r.x; lx < r.x + r.w; lx += 16) {
    const wx = x0 + lx;
    const band = pathBand(wx, seed);
    if (band && band[0] < r.y + r.h && band[1] > r.y) return false;
    if (!inTown(wx, seed) && inLake(wx, seed) && r.y + r.h > LAKE_TOP) {
      return false;
    }
  }
  for (const o of occupied) {
    if (overlaps(r, o)) return false;
  }
  return true;
}

/**
 * Path / road. Out in the country: flat dirt with a dark edge line and a
 * lit inner line; where it narrows into a forest trail, grass blades
 * creep in across it. Topped with sparse authored pebble ticks
 * (tile-grid, like the grass ticks) clipped to the path itself so none
 * land on the verge. In town it's a paved street instead (see
 * `drawStreetColumn`), switching surface cleanly at the town limits,
 * where the approaching path has already widened and levelled to meet it.
 */
function drawPath(pm: Pixmap, x0: number, seed: string): void {
  const creepSeed = hashString(seed + ":pathcreep");
  const asphaltSeed = hashString(seed + ":asphalt");
  const dirtBands: Array<[number, number] | null> = [];
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = x0 + lx;
    const town = townNear(wx, seed);
    if (town) {
      dirtBands.push(null);
      drawStreetColumn(pm, lx, wx, town, asphaltSeed);
      continue;
    }
    const band = pathBand(wx, seed);
    dirtBands.push(band);
    if (!band) continue;
    const [pt, pb] = band;
    const { forest } = regionWeights(wx, seed);
    const creep = smoothstep(0.15, 0.8, forest) * 0.18;
    for (let y = pt; y <= pb; y++) {
      if (y < HORIZON || y >= VIEW_H) continue;
      let c: number = C.path;
      if (y === pt || y === pb) c = C.pathEdge;
      else if (y === pt + 1 || y === pb - 1) c = C.pathLight;
      pm.set(lx, y, c);
    }
    if (creep > 0) {
      for (let y = pt + 1; y < pb; y++) {
        if (noise2i(creepSeed, wx, y) < creep) {
          pm.set(lx, y, C.grassDark);
          if (y - 1 > pt) pm.set(lx, y - 1, C.grass);
        }
      }
    }
  }

  for (let ty = Math.floor(HORIZON / TILE); ty * TILE < VIEW_H; ty++) {
    for (let tx = 0; tx * TILE < CHUNK_W; tx++) {
      const mid = dirtBands[tx * TILE + TILE / 2];
      if (!mid) continue;
      const tileTop = ty * TILE;
      if (tileTop + TILE <= mid[0] + 3 || tileTop >= mid[1] - 3) continue;
      const tick = pathTickTile(keyRng(seed, "pathtick", x0 + tx * TILE, ty));
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const c = tick.get(x, y);
          const band = dirtBands[tx * TILE + x];
          if (!c || !band || tileTop + y <= band[0] + 1 || tileTop + y >= band[1] - 1) continue;
          pm.set(tx * TILE + x, tileTop + y, c);
        }
      }
    }
  }
}

/**
 * One column of town street, top to bottom: far sidewalk (paving slabs
 * with seams every 16px), the far curb seen face-on, asphalt with a few
 * scuffs and a dashed centre line, the near curb seen from above, and
 * the near sidewalk. The outer edges of both sidewalks are lined, and at
 * the town limits the sidewalks end in a clean vertical edge.
 */
function drawStreetColumn(pm: Pixmap, lx: number, wx: number, town: Town, asphaltSeed: number): void {
  const c = town.roadY;
  const top = c - STREET_HALF;
  const bottom = c + STREET_HALF;
  const atLimit = wx === town.start || wx === town.end - 1;
  const seam = wx % 16 === 0;
  for (let y = top; y <= bottom; y++) {
    let col: number;
    if (y === top || y === bottom) col = C.roadDark;
    else if (y < c - ROAD_HALF - 1) col = seam || y === top + 6 ? C.road : C.roadLight;
    else if (y === c - ROAD_HALF - 1) col = C.houseWall;
    else if (y === c - ROAD_HALF) col = C.road;
    else if (y === c + ROAD_HALF) col = C.road;
    else if (y === c + ROAD_HALF + 1) col = C.houseWall;
    else if (y > c + ROAD_HALF + 1) col = seam || y === bottom - 6 ? C.road : C.roadLight;
    else {
      col = noise2i(asphaltSeed, wx, y) < 0.04 ? C.road : C.roadDark;
      if ((y === c - 1 || y === c) && ((wx % 24) + 24) % 24 < 12) col = C.houseWall;
    }
    if (atLimit && (y < c - ROAD_HALF || y > c + ROAD_HALF)) col = C.roadDark;
    pm.set(lx, y, col);
  }
}

/**
 * Everything standing in the town (if any) that overlaps this chunk:
 * each lot's building, yard and fence, street lamps along both sidewalks,
 * and the signs at the town limits. Lots are planned in world space (see
 * `./town`), so a building straddling two chunks is drawn — clipped —
 * by both, from the same plan.
 */
function placeTown(
  pm: Pixmap,
  x0: number,
  seed: string,
  drawables: Drawable[],
  trees: TreeSpot[],
  lights: LampLight[],
): void {
  const town = townNear(x0 + CHUNK_W / 2, seed, CHUNK_W);
  if (!town) return;
  const near = (wx: number, w: number) => wx < x0 + CHUNK_W + 128 && wx + w > x0 - 128;
  const sidewalkTop = town.roadY - STREET_HALF;
  const sidewalkBottom = town.roadY + STREET_HALF;

  /** A static sprite standing with its bottom row on `baseY`. */
  const stand = (sprite: Pixmap, wx: number, baseY: number, ground?: () => void) => {
    const x = wx - x0;
    const y = baseY - sprite.h + 1;
    drawables.push({ baseY, bounds: { x, y, w: sprite.w, h: sprite.h }, ground, draw: () => blit(pm, sprite, x, y) });
  };

  /**
   * A yard tree with its trunk centred near world-x `cx`. Its sprite is
   * nudged to sit wholly inside one chunk — the renderer draws swaying
   * canopies against a single chunk's depth buffer — and only that chunk
   * places it.
   */
  const plantTree = (cx: number, baseY: number, scale: number, key: string) => {
    const w = Math.round(TREE_W * scale);
    let tx = Math.round(cx - w / 2);
    const home = Math.floor((tx + w / 2) / CHUNK_W) * CHUNK_W;
    tx = Math.max(home, Math.min(home + CHUNK_W - w, tx));
    if (home !== x0 || baseY >= VIEW_H - 1) return;
    const x = tx - x0;
    const y = baseY - Math.round(61 * scale);
    const kind: TreeKind = keyRng(seed, "towntreekind", key)() < 0.2 ? "conifer" : "broadleaf";
    const spec = treeSpec(keyRng(seed, "towntree", key), kind);
    const baseRng = keyRng(seed, "towntreebase", key);
    const spot: TreeSpot = { x: tx, y, scale, spec, depth: 0 };
    trees.push(spot);
    drawables.push({
      baseY,
      bounds: groundedTreeBounds(x, y, scale),
      ground: () => drawTreeShadow(pm, x, y, scale, baseRng),
      draw: () => drawGroundedTree(pm, x, y, scale, spec, baseRng),
      spot,
    });
  };

  /** A fence or hedge run along `baseY` from world-x `a` to `b`. */
  const fenceRun = (a: number, b: number, baseY: number, hedge: boolean, key: string) => {
    const w = Math.round(b - a);
    if (w < 8) return;
    stand(hedge ? hedgePixmap(w, keyRng(seed, "hedge", key)) : picketFencePixmap(w), a, baseY);
  };

  for (const lot of town.lots) {
    if (!near(lot.x, lot.w)) continue;
    const key = `${town.start}:${lot.index}`;
    const rng = keyRng(seed, "lot", key);
    if (lot.side === "north") placeNorthLot(lot, key, rng);
    else placeSouthLot(lot, key, rng);
  }

  // street lamps at a steady rhythm along both sidewalks, staggered
  const lamp = (wx: number, baseY: number) => {
    if (!near(wx, LAMP_W)) return;
    stand(streetlampPixmap(keyRng(seed, "lamp", wx)), wx - LAMP_W / 2, baseY);
    lights.push({ x: wx - x0, headY: baseY - LAMP_H + 11, baseY });
  };
  for (let wx = town.start + 64; wx < town.end - 32; wx += 240) {
    lamp(wx, sidewalkTop + 3);
    if (wx + 120 < town.end - 32) lamp(wx + 120, sidewalkBottom - 1);
  }

  // town-limits signs with the town's name, beside the approaching path at each end
  const sign = townSignPixmap(town.name);
  for (const sx of [town.start - 36 - sign.w, town.end + 36]) {
    if (!near(sx, sign.w)) continue;
    const band = pathBand(sx + sign.w / 2, seed);
    if (band) stand(sign, sx, band[0] - 3);
  }


  function placeNorthLot(lot: Extract<Lot, { side: "north" }>, key: string, rng: () => number): void {
    if (lot.kind === "park") {
      // a hedged pocket park: trees, a bench facing the street, flowers,
      // and a gravel path in from a gap in the hedge
      const gapX = lot.x + Math.round(lot.w / 2);
      fenceRun(lot.x, gapX - 9, sidewalkTop - 1, true, key + "a");
      fenceRun(gapX + 9, lot.x + lot.w, sidewalkTop - 1, true, key + "b");
      const nTrees = 1 + Math.floor(lot.w / 70);
      for (let i = 0; i < nTrees; i++) {
        const cx = lot.x + ((i + 0.5) / nTrees) * lot.w + (rng() * 2 - 1) * 8;
        plantTree(cx, sidewalkTop - 18 - Math.floor(rng() * 24), 0.8 + rng() * 0.15, key + ":t" + i);
      }
      const bench = benchPixmap(rng);
      stand(bench, gapX - 20, sidewalkTop - 8, () =>
        pm.fillRect(gapX - 7 - x0, sidewalkTop - 10, 14, 10, C.pathLight),
      );
      if (lot.w > 120) stand(flowerBedPixmap(rng, 28), lot.x + 6, sidewalkTop - 30);
      return;
    }

    const kind = lot.kind;
    const size = BUILDING_SIZE[kind];
    const service = kind === "center" || kind === "mart";
    const yard = service ? 18 : 12 + Math.floor(rng() * 8);
    const base = sidewalkTop - yard;
    const slack = lot.w - size.w;
    const bx = lot.x + Math.round(slack * (service ? 0.5 : 0.15 + rng() * 0.7));
    const by = base - size.h;
    const sprite = buildingPixmap(kind, rng);
    const doorX = bx + sprite.doorX;
    const lx = bx - x0;

    drawables.push({
      baseY: base - 1,
      bounds: { x: lx, y: by, w: size.w, h: size.h },
      ground: () => {
        // contact shadow along the foundation and a cast shadow off the
        // shaded right-hand wall (light from the upper left)
        pm.fillRect(lx + 6, base, size.w - 12, 1, C.grassDark);
        pm.fillRect(lx + size.w - 9, base - 5, 12, 6, C.grassDark);
        if (service) {
          // paved forecourt from the doors to the sidewalk
          const fx = lot.x - x0;
          pm.fillRect(fx, base, lot.w, sidewalkTop - base, C.roadLight);
          pm.fillRect(fx, base, lot.w, 1, C.roadDark);
          pm.fillRect(fx, base, 1, sidewalkTop - base, C.roadDark);
          pm.fillRect(fx + lot.w - 1, base, 1, sidewalkTop - base, C.roadDark);
          for (let x = fx + 16; x < fx + lot.w - 1; x += 16) pm.fillRect(x, base + 1, 1, sidewalkTop - base - 1, C.road);
        } else {
          // a paved walk from the door down to the sidewalk
          const wx = doorX - 6 - x0;
          pm.fillRect(wx, base, 13, sidewalkTop - base, C.roadLight);
          pm.fillRect(wx - 1, base, 1, sidewalkTop - base, C.roadDark);
          pm.fillRect(wx + 13, base, 1, sidewalkTop - base, C.roadDark);
          for (let y = base + 4; y < sidewalkTop; y += 4) pm.fillRect(wx, y, 13, 1, C.road);
        }
      },
      draw: () => blit(pm, sprite.pixmap, lx, by),
    });

    if (service) {
      stand(flowerBedPixmap(rng, 28), lot.x + 4, sidewalkTop - 2);
      stand(flowerBedPixmap(rng, 28), lot.x + lot.w - 32, sidewalkTop - 2);
      return;
    }

    // front fence or hedge with a gate at the walk, a mailbox by the gate
    const hedge = rng() < 0.35;
    fenceRun(lot.x, doorX - 9, sidewalkTop - 1, hedge, key + "a");
    fenceRun(doorX + 9, lot.x + lot.w, sidewalkTop - 1, hedge, key + "b");
    stand(mailboxPixmap(rng), doorX + 11, sidewalkTop + 1);

    // a flower bed against the front wall, on whichever side of the door has room
    if (rng() < 0.65) {
      const bw = 24 + Math.floor(rng() * 3) * 8;
      const leftRoom = doorX - 10 - (bx + 10);
      const rightRoom = bx + size.w - 18 - (doorX + 10);
      const fx = leftRoom >= bw ? doorX - 10 - bw : rightRoom >= bw ? doorX + 10 : null;
      if (fx !== null) stand(flowerBedPixmap(rng, bw), fx, base + 3);
    }

    // a tree in the roomier side yard
    const leftYard = bx - lot.x;
    const rightYard = lot.x + lot.w - (bx + size.w);
    if (Math.max(leftYard, rightYard) >= 28 && rng() < 0.8) {
      const cx = leftYard > rightYard ? lot.x + leftYard / 2 : bx + size.w + rightYard / 2;
      plantTree(cx, sidewalkTop - 4 - Math.floor(rng() * 8), 0.75 + rng() * 0.15, key + ":t");
    }
  }

  function placeSouthLot(lot: Extract<Lot, { side: "south" }>, key: string, rng: () => number): void {
    const fenceBase = sidewalkBottom + PICKET_H + 1;
    switch (lot.kind) {
      case "garden": {
        // a hedge along the sidewalk, then rows of flowers planted in
        // dug soil beds rather than floating on the lawn
        fenceRun(lot.x, lot.x + lot.w, sidewalkBottom + HEDGE_H + 1, true, key);
        for (const row of [34, 54]) {
          const by = sidewalkBottom + row;
          if (by >= VIEW_H - 1) continue;
          const px = lot.x + 4 - x0;
          const pw = lot.w - 8;
          drawables.push({
            baseY: by - 12,
            bounds: { x: px, y: by - 12, w: pw, h: 14 },
            ground: () => {
              pm.fillRect(px, by - 9, pw, 11, C.trunkDark);
              pm.fillRect(px + 1, by - 8, pw - 2, 9, C.trunk);
              for (let x = px + 3; x < px + pw - 2; x += 5) pm.set(x, by - 4, C.trunkDark);
            },
          });
          for (let x = lot.x + 6; x + 32 <= lot.x + lot.w - 4; x += 40) stand(flowerBedPixmap(rng, 32), x, by - 2);
        }
        break;
      }
      case "trees": {
        fenceRun(lot.x, lot.x + lot.w, fenceBase, false, key);
        const n = lot.w > 110 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const cx = lot.x + ((i + 0.5) / n) * lot.w + (rng() * 2 - 1) * 10;
          plantTree(cx, sidewalkBottom + 30 + Math.floor(rng() * 22), 0.95 + rng() * 0.15, key + ":t" + i);
        }
        break;
      }
      case "nook": {
        const cx = lot.x + Math.round(lot.w / 2);
        const bench = benchPixmap(rng);
        stand(bench, cx - 20, sidewalkBottom + 22, () =>
          pm.fillRect(cx - 24 - x0, sidewalkBottom + 1, 48, 24, C.roadLight),
        );
        stand(flowerBedPixmap(rng, 24), cx - 52, sidewalkBottom + 18);
        stand(flowerBedPixmap(rng, 24), cx + 28, sidewalkBottom + 18);
        break;
      }
      case "lawn": {
        fenceRun(lot.x, lot.x + lot.w, fenceBase, false, key);
        stand(mailboxPixmap(rng), lot.x + Math.round(lot.w * (0.2 + rng() * 0.6)), sidewalkBottom - 1);
        break;
      }
    }
  }
}

/** Generate a full-height chunk (world x in [k*CHUNK_W, (k+1)*CHUNK_W)). */
export function generateChunk(seed: string, k: number): ChunkResult {
  const pm = new Pixmap(CHUNK_W, VIEW_H);
  const x0 = k * CHUNK_W;
  // the countryside config for this chunk; a city chunk's non-town edges
  // are ordinary route
  const region = regionAt(x0 + CHUNK_W / 2, seed);
  const cfg = REGION_CONFIGS[region === REGION_FOREST ? REGION_FOREST : REGION_ROUTE];
  const waterSeed = hashString(seed + ":water");

  // ground: flat grass, broken up by flat-colored, hard-edged patches of
  // shade (grassDark) and sun (grassLight) whose outlines come from a
  // two-octave 2-D noise field rather than drawn ellipses — so they're
  // irregular, and seamless across chunk edges instead of clipped there.
  // (Not dithered: at this view scale ordered dithering reads as a blotchy
  // checker rather than a gradient, and GBA tile art varies open ground
  // with distinct flat patches, not continuous blends.) Shade spreads with
  // forest weight *and* local grove strength, so it pools under the trees
  // rather than blanketing the forest floor, while open route keeps only
  // the odd shady or sunny patch.
  // Towns keep tidy lawns: no patches inside them or on the approach.
  const toneSeedA = hashString(seed + ":toneA");
  const toneSeedB = hashString(seed + ":toneB");
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = x0 + lx;
    const { urban, forest } = regionWeights(wx, seed);
    const sunAbove = forest < 0.3 && urban < 0.3 ? 0.78 : 2;
    for (let y = HORIZON; y < VIEW_H; y++) {
      let c = C.grass;
      if (urban < 0.35) {
        const tone = 0.8 * valueNoise2D(wx / 64, y / 22, toneSeedA) + 0.2 * valueNoise2D(wx / 12, y / 5, toneSeedB);
        const grove = forest > 0 ? (groveAt(wx, y, seed) - 0.2) / 1.8 : 0;
        const shadeBelow = 0.18 + forest * (0.04 + 0.3 * grove);
        if (tone < shadeBelow) c = C.grassDark;
        else if (tone > sunAbove) c = C.grassLight;
      }
      pm.set(lx, y, c);
    }
  }

  // grass ticks: sparse, per-tile-authored 1-2px blade marks (the "fine
  // pixel lines" texture a GBA tileset actually uses) in place of continuous
  // per-pixel noise. Denser in forest for an undergrowth feel.
  for (let ty = Math.floor(HORIZON / TILE); ty * TILE < VIEW_H; ty++) {
    for (let tx = 0; tx * TILE < CHUNK_W; tx++) {
      const wx = x0 + tx * TILE + TILE / 2;
      const wy = ty * TILE;
      const { forest } = regionWeights(wx, seed);
      if (!inTown(wx, seed) && inLake(wx, seed) && wy + TILE > LAKE_TOP) continue;
      const tileRng = keyRng(seed, "grasstick", x0 + tx * TILE, ty);
      blit(pm, grassTickTile(tileRng, forest > 0.3), tx * TILE, wy);
    }
  }

  // lake (bottom water, non-city only): a sandy shore that follows the
  // waterline all the way round — down the steep sides where the lake
  // tapers off, rather than dithering into the grass — then open water
  // banded shallow to deep. Animated detail (reflections, ripples, foam)
  // is the renderer's, over the spans recorded here.
  const water: WaterSpan[][] = Array.from({ length: CHUNK_W }, () => []);
  const toneSeed = hashString(seed + ":watertone");
  const lakeSurf = (lx: number): number => {
    const wx = x0 + lx;
    if (!cfg.hasLake || inTown(wx, seed) || lakeDepth(wx, seed) <= 0.02) return VIEW_H;
    return waterSurfaceY(wx, seed);
  };
  if (cfg.hasLake) {
    let prev = lakeSurf(-1);
    let cur = lakeSurf(0);
    for (let lx = 0; lx < CHUNK_W; lx++) {
      const next = lakeSurf(lx + 1);
      const wx = x0 + lx;
      const lowestNeighbour = Math.min(prev, next);
      if (cur < VIEW_H || lowestNeighbour < VIEW_H) {
        const rise = Math.max(0, Math.round(fbm1D(wx / 14, seed + ":beach", 2) * 5) - 1);
        const waterTop = Math.min(cur + 3, VIEW_H);
        paintShoreColumn(pm, lx, wx, Math.min(cur, lowestNeighbour) - rise, waterTop, waterSeed);
        if (waterTop < VIEW_H) {
          paintWaterColumn(pm, lx, wx, waterTop, VIEW_H - 1, toneSeed);
          water[lx].push([waterTop, VIEW_H - 1]);
        }
      }
      prev = cur;
      cur = next;
    }

    // lily pads drifting on the open water (not in the tapering shallows)
    const padRng = keyRng(seed, "lilypad", k);
    const pads = Math.floor(padRng() * 6);
    for (let i = 0; i < pads; i++) {
      const lx = 8 + Math.floor(padRng() * (CHUNK_W - 16));
      const wx = x0 + lx;
      const frac = padRng();
      if (inTown(wx, seed) || lakeDepth(wx, seed) < 0.6) continue;
      const surf = waterSurfaceY(wx, seed);
      if (VIEW_H - surf < 16) continue;
      const cy = surf + 9 + Math.floor(frac * (VIEW_H - surf - 13));
      drawLilyPad(pm, lx, cy, padRng, C.water);
    }
  }

  // a pond out in the field, now and then: same shore and banding as the
  // lake, plus a grassy near bank, kept wholly inside the chunk and clear
  // of the path, towns and the lake
  const ponds: Pond[] = [];
  const pondRng = keyRng(seed, "pond", k);
  if (pondRng() < cfg.pondChance) {
    for (let attempt = 0; attempt < 3 && ponds.length === 0; attempt++) {
      const rx = 30 + pondRng() * 34;
      const ry = 9 + pondRng() * 9;
      const cx = rx + 8 + pondRng() * (CHUNK_W - 2 * rx - 16);
      const cy = HORIZON + 26 + ry + pondRng() * (LAKE_TOP - 24 - ry - (HORIZON + 26 + ry));
      const pond: Pond = { cx, cy, rx, ry, seed: hashString(`${seed}:pond:${k}:${attempt}`) };
      let ok = true;
      for (let lx = Math.floor(cx - rx); lx <= cx + rx && ok; lx += 6) {
        const wx = x0 + lx;
        const band = pathBand(wx, seed);
        if (band && band[0] < cy + ry + 8 && band[1] > cy - ry - 8) ok = false;
        if (townNear(wx, seed, 48)) ok = false;
        if (lakeSurf(lx) < cy + ry + 14) ok = false;
      }
      if (ok) ponds.push(pond);
    }
  }
  for (const pond of ponds) {
    const rows = (lx: number) => pondRows(pond, lx);
    for (let lx = Math.floor(pond.cx - pond.rx) - 1; lx <= pond.cx + pond.rx + 1; lx++) {
      const wx = x0 + lx;
      const here = rows(lx);
      const neighbours = [rows(lx - 1), rows(lx + 1)].filter((r): r is [number, number] => r !== null);
      if (!here && neighbours.length === 0) continue;
      const top = here ? here[0] : Math.min(...neighbours.map((r) => r[1]));
      const farTop = Math.min(top, ...neighbours.map((r) => r[0]));
      const waterTop = here ? here[0] + 2 : top;
      paintShoreColumn(pm, lx, wx, farTop - 1, waterTop, waterSeed);
      if (!here) continue;
      const bottom = here[1];
      if (waterTop < bottom) {
        paintWaterColumn(pm, lx, wx, waterTop, bottom - 1, toneSeed, true);
        water[lx].push([waterTop, bottom - 1]);
      }
      pm.set(lx, bottom, C.grassDark);
    }
    const padRng = keyRng(seed, "pondpad", k);
    for (let i = Math.floor(padRng() * 3); i > 0; i--) {
      const lx = Math.round(pond.cx + (padRng() * 2 - 1) * pond.rx * 0.6);
      const r = rows(lx);
      if (r && r[1] - r[0] > 10) drawLilyPad(pm, lx, Math.round(r[0] + 5 + padRng() * (r[1] - r[0] - 9)), padRng, C.water);
    }
  }

  // path / road, before any objects: everything standing on the ground is
  // depth-sorted and drawn over it, so a tree just below the path can hang
  // its canopy over the dirt instead of being kept clear of it.
  drawPath(pm, x0, seed);

  // objects (region-dependent). Each placement pushes a Drawable; they're
  // drawn together at the end in base-y order (see `drawSorted`).
  const occupied: Rect[] = ponds.map((p) => ({ x: p.cx - p.rx - 6, y: p.cy - p.ry - 8, w: 2 * p.rx + 12, h: 2 * p.ry + 12 }));
  const drawables: Drawable[] = [];
  const tallGrass: TallGrassSpot[] = [];
  const trees: TreeSpot[] = [];
  const berryTrees: BerryTreeSpot[] = [];
  const items: HiddenItem[] = [];
  const fieldTop = HORIZON + 6;
  const fieldBottom = VIEW_H - 2;

  // countryside decorations, kept clear of towns and, with a wide margin,
  // of the named town-limits sign standing just outside each end
  const notUrbanAt = (wx: number) => townNear(wx, seed, 112) === null;

  // trainer (route only), standing on the path
  const trainerRng = keyRng(seed, "trainer", k);
  if (cfg.hasTrainer && trainerRng() < 0.35) {
    const variant = Math.floor(trainerRng() * 3);
    const tx = 32 + Math.floor(trainerRng() * (CHUNK_W - 96));
    const wx = x0 + tx + TRAINER_W / 2;
    const base = Math.round(pathCenter(wx, seed));
    const ty = base - TRAINER_H;
    const band = pathBand(wx, seed);
    const onPath = band !== null && band[1] - band[0] >= 20;
    if (onPath && notUrbanAt(wx) && ty > HORIZON && base + 4 < VIEW_H) {
      const r: Rect = { x: tx, y: ty, w: TRAINER_W, h: TRAINER_H };
      occupied.push({ x: tx, y: base - 8, w: TRAINER_W, h: 10 });
      drawables.push({
        baseY: base,
        bounds: r,
        ground: () => pm.fillEllipse(tx + TRAINER_W / 2, ty + TRAINER_H - 2, 12, 3, C.pathDark),
        draw: () => blit(pm, trainerPixmap(variant), tx, ty),
      });
    }
  }

  // trees: candidates scattered over the whole field, kept with a
  // probability of (region density × local grove strength), so they
  // gather into groves with clearings between rather than sitting on
  // fixed rows. Only the trunk footprint needs clear ground — canopies
  // may overlap each other and the path, sorted by depth. Trees lower on
  // screen (nearer the viewer) are drawn a little larger.
  const treeRng = keyRng(seed, "trees", k);
  for (let i = 0; i < TREE_CANDIDATES; i++) {
    const lx = Math.floor(treeRng() * CHUNK_W);
    const baseY = fieldTop + Math.floor(treeRng() * (fieldBottom - fieldTop));
    const roll = treeRng();
    const sizeJitter = treeRng();
    const near = (baseY - HORIZON) / (VIEW_H - HORIZON);
    const density = cfg.treeDensityUpland + (cfg.treeDensityLowland - cfg.treeDensityUpland) * near;
    if (roll >= density * groveAt(x0 + lx, baseY, seed)) continue;
    const scale = (0.72 + near * 0.4) * (0.9 + sizeJitter * 0.2);
    const w = Math.round(TREE_W * scale);
    const x = Math.max(0, Math.min(CHUNK_W - w, lx - Math.round(w / 2)));
    const y = baseY - Math.round(61 * scale);
    const foot = treeFootprint(x + w / 2, baseY, scale);
    if (!notUrbanAt(x0 + x + w / 2) || !groundFree(foot, x0, seed, occupied)) continue;
    occupied.push(foot);
    const kind = treeKindAt(x0 + x + w / 2, baseY, cfg.coniferShare, keyRng(seed, "treekind", x0 + x, y), seed);
    const spec = treeSpec(keyRng(seed, "treespec", x0 + x, y), kind);
    const baseRng = keyRng(seed, "treebase", x0 + x, y);
    const spot: TreeSpot = { x: x0 + x, y, scale, spec, depth: 0 };
    trees.push(spot);
    drawables.push({
      baseY,
      bounds: groundedTreeBounds(x, y, scale),
      ground: () => drawTreeShadow(pm, x, y, scale, baseRng),
      draw: () => drawGroundedTree(pm, x, y, scale, spec, baseRng),
      spot,
    });
  }

  // berry tree: at most one, anywhere a trunk fits
  if (cfg.hasBerryTree) {
    const berryRng = keyRng(seed, "berry", k);
    if (berryRng() < 0.3) {
      const bx = 16 + Math.floor(berryRng() * (CHUNK_W - TREE_W - 32));
      const baseY = fieldTop + Math.floor(berryRng() * (fieldBottom - fieldTop));
      const by = baseY - 61;
      const foot = treeFootprint(bx + TREE_W / 2, baseY, 1);
      if (notUrbanAt(x0 + bx + TREE_W / 2) && by >= 0 && groundFree(foot, x0, seed, occupied)) {
        occupied.push(foot);
        const baseRng = keyRng(seed, "berrybase", k);
        const spot: BerryTreeSpot = { x: x0 + bx, y: by, depth: 0 };
        berryTrees.push(spot);
        drawables.push({
          baseY,
          bounds: groundedTreeBounds(bx, by, 1),
          ground: () => drawTreeShadow(pm, bx, by, 1, baseRng),
          draw: () => {
            blit(pm, berryTrunkPixmap(), bx, by);
            drawTreeBaseClutter(pm, bx + TREE_W / 2, baseY + 1, 1, baseRng);
          },
          spot,
        });
      }
    }
  }

  // berry bushes: favour grove edges, where undergrowth would be
  if (cfg.hasBushes) {
    const bushRng = keyRng(seed, "bush", k);
    const bushes = 3 + Math.floor(bushRng() * 4);
    for (let i = 0; i < bushes; i++) {
      const bx = Math.floor(bushRng() * (CHUNK_W - 32));
      const baseY = fieldTop + Math.floor(bushRng() * (fieldBottom - fieldTop));
      const keep = bushRng() < 0.25 + 0.4 * Math.min(1, groveAt(x0 + bx + 16, baseY, seed));
      if (!keep) continue;
      const by = baseY - 29;
      const foot: Rect = { x: bx + 4, y: baseY - 6, w: 24, h: 8 };
      if (!notUrbanAt(x0 + bx + 16) || !groundFree(foot, x0, seed, occupied)) continue;
      occupied.push(foot);
      const sprite = berryBushPixmap(keyRng(seed, "bushtile", k, i));
      drawables.push({
        baseY,
        bounds: { x: bx, y: by, w: 32, h: 32 },
        ground: () => pm.fillEllipse(bx + 17, baseY, 12, 3, C.grassDark),
        draw: () => blit(pm, sprite, bx, by),
      });
    }
  }

  // tall grass: irregular patches of 2–5 tufts scattered around a centre
  // (staggered in x and y), not one or two tiles squared off on a band
  if (cfg.hasTallGrass) {
    const tallRng = keyRng(seed, "tall", k);
    const patches = 2 + Math.floor(tallRng() * 3);
    for (let i = 0; i < patches; i++) {
      const cx = Math.floor(tallRng() * (CHUNK_W - TILE));
      const cy = fieldTop + Math.floor(tallRng() * (fieldBottom - fieldTop - TILE));
      const n = 2 + Math.floor(tallRng() * 4);
      for (let t = 0; t < n; t++) {
        const tx = Math.max(0, Math.min(CHUNK_W - TILE, cx + Math.round((tallRng() * 2 - 1) * TILE)));
        const ty = Math.max(HORIZON, Math.min(VIEW_H - TILE, cy + Math.round((tallRng() * 2 - 1) * 12)));
        const foot: Rect = { x: tx + 2, y: ty + 20, w: TILE - 4, h: 10 };
        if (!notUrbanAt(x0 + tx + TILE / 2) || !groundFree(foot, x0, seed, occupied)) continue;
        occupied.push(foot);
        const spot: TallGrassSpot = { x: x0 + tx, y: ty, k, i, t, depth: 0 };
        tallGrass.push(spot);
        drawables.push({
          baseY: ty + 30,
          bounds: { x: tx, y: ty, w: TILE, h: TILE },
          spot,
        });
      }
    }
  }

  // flower clusters, preferring open ground away from groves
  if (cfg.hasFlowers) {
    const flowerRng = keyRng(seed, "flower", k);
    const clusters = 2 + Math.floor(flowerRng() * 3);
    for (let i = 0; i < clusters; i++) {
      const cx = Math.floor(flowerRng() * CHUNK_W);
      const cy = fieldTop + Math.floor(flowerRng() * (fieldBottom - fieldTop - TILE));
      const n = 2 + Math.floor(flowerRng() * 3);
      const open = groveAt(x0 + cx, cy, seed) < 1;
      for (let f = 0; f < n; f++) {
        const fx = Math.max(0, Math.min(CHUNK_W - TILE, cx + (Math.floor(flowerRng() * 48) - 24)));
        const fy = Math.max(HORIZON, Math.min(VIEW_H - TILE, cy + (Math.floor(flowerRng() * 32) - 16)));
        if (!open) continue;
        const r: Rect = { x: fx, y: fy, w: TILE, h: TILE };
        if (!notUrbanAt(x0 + fx + TILE / 2) || !groundFree(r, x0, seed, occupied)) continue;
        const sprite = flowerTile(keyRng(seed, "flowertile", k, i, f));
        drawables.push({ baseY: fy + TILE - 2, bounds: r, draw: () => blit(pm, sprite, fx, fy) });
      }
    }
  }

  // ferns: forest-floor undergrowth, mostly in and around groves
  if (cfg.undergrowth > 0) {
    const fernRng = keyRng(seed, "fern", k);
    const ferns = Math.round(cfg.undergrowth * (4 + fernRng() * 6));
    for (let i = 0; i < ferns; i++) {
      const fx = Math.floor(fernRng() * (CHUNK_W - FERN_W));
      const baseY = fieldTop + Math.floor(fernRng() * (fieldBottom - fieldTop));
      const g = (groveAt(x0 + fx + FERN_W / 2, baseY, seed) - 0.2) / 1.8;
      if (fernRng() >= 0.2 + 0.7 * g) continue;
      const foot: Rect = { x: fx + 4, y: baseY - 4, w: FERN_W - 8, h: 5 };
      if (!notUrbanAt(x0 + fx + FERN_W / 2) || !groundFree(foot, x0, seed, occupied)) continue;
      occupied.push(foot);
      const by = baseY - FERN_H + 1;
      const sprite = fernPixmap(keyRng(seed, "ferntile", k, i));
      drawables.push({ baseY, bounds: { x: fx, y: by, w: FERN_W, h: FERN_H }, draw: () => blit(pm, sprite, fx, by) });
    }

    // a fallen log, now and then, lying in a grove
    const logRng = keyRng(seed, "log", k);
    if (logRng() < 0.5 * cfg.undergrowth) {
      const w = 36 + Math.floor(logRng() * 16);
      const lx = Math.floor(logRng() * (CHUNK_W - w));
      const baseY = fieldTop + 4 + Math.floor(logRng() * (fieldBottom - fieldTop - 4));
      const ly = baseY - LOG_H + 2;
      const foot: Rect = { x: lx, y: baseY - 10, w, h: 12 };
      if (notUrbanAt(x0 + lx + w / 2) && groundFree(foot, x0, seed, occupied)) {
        occupied.push(foot);
        const sprite = logPixmap(keyRng(seed, "logtile", k), w);
        const clutterRng = keyRng(seed, "logbase", k);
        drawables.push({
          baseY,
          bounds: { x: lx - 2, y: ly - 4, w: w + 4, h: LOG_H + 8 },
          ground: () => pm.fillEllipse(lx + w / 2 + 2, baseY - 1, w / 2 + 2, 3, C.grassDark),
          draw: () => {
            blit(pm, sprite, lx, ly);
            drawTreeBaseClutter(pm, lx + w / 2, baseY + 1, 0.8, clutterRng);
          },
        });
      }
    }
  }

  // hidden items: about half of countryside chunks hide one somewhere on
  // open ground (forests sometimes two), marked only by a glint
  const itemRng = keyRng(seed, "items", k);
  const itemCount = (itemRng() < 0.5 ? 1 : 0) + (cfg === REGION_CONFIGS[REGION_FOREST] && itemRng() < 0.3 ? 1 : 0);
  for (let n = 0, tries = 0; n < itemCount && tries < 8; tries++) {
    const x = 12 + Math.floor(itemRng() * (CHUNK_W - 24));
    const y = fieldTop + 10 + Math.floor(itemRng() * (fieldBottom - fieldTop - 16));
    const kind = Math.floor(itemRng() * ITEMS.length);
    if (!notUrbanAt(x0 + x) || !groundFree({ x: x - 4, y: y - 4, w: 9, h: 6 }, x0, seed, occupied)) continue;
    items.push({ x, y, kind });
    n++;
  }

  // reeds standing in the shallows along the lake shore
  if (cfg.hasLake) {
    const reedRng = keyRng(seed, "reeds", k);
    for (let lx = 4 + Math.floor(reedRng() * 12); lx < CHUNK_W - REEDS_W; lx += 10 + Math.floor(reedRng() * 26)) {
      const wx = x0 + lx + REEDS_W / 2;
      const keep = reedRng() < 0.55;
      const sink = 5 + Math.floor(reedRng() * 6);
      if (!keep || inTown(wx, seed) || lakeDepth(wx, seed) < 0.3) continue;
      const surf = waterSurfaceY(wx, seed);
      const baseY = surf + sink;
      if (baseY + 3 > VIEW_H) continue;
      const ry = baseY - REEDS_H + 3;
      const sprite = reedsPixmap(keyRng(seed, "reedtile", k, lx));
      drawables.push({ baseY, bounds: { x: lx, y: ry, w: REEDS_W, h: REEDS_H }, draw: () => blit(pm, sprite, lx, ry) });
    }
  }

  // reeds along the far shore of each pond
  for (const pond of ponds) {
    const reedRng = keyRng(seed, "pondreeds", k);
    for (let lx = Math.round(pond.cx - pond.rx); lx < pond.cx + pond.rx - REEDS_W; lx += 8 + Math.floor(reedRng() * 22)) {
      const keep = reedRng() < 0.5;
      const r = pondRows(pond, lx + REEDS_W / 2);
      if (!keep || !r || r[1] - r[0] < 8) continue;
      const baseY = r[0] + 4 + Math.floor(reedRng() * 3);
      const ry = baseY - REEDS_H + 3;
      const sprite = reedsPixmap(keyRng(seed, "pondreedtile", k, lx));
      drawables.push({ baseY, bounds: { x: lx, y: ry, w: REEDS_W, h: REEDS_H }, draw: () => blit(pm, sprite, lx, ry) });
    }
  }

  // fence run (route only), along the near edge of the path
  if (cfg.hasFence) {
    const fenceRng = keyRng(seed, "fence", k);
    if (fenceRng() < 0.4) {
      const start = Math.floor(fenceRng() * 8) * TILE;
      const segs = 4 + Math.floor(fenceRng() * 6);
      for (let s = 0; s < segs; s++) {
        const lx = start + s * TILE;
        if (lx + TILE > CHUNK_W) break;
        const wx = x0 + lx + 16;
        const band = pathBand(wx, seed);
        if (!band) continue;
        const [, pb] = band;
        const fy = pb + 8;
        if (fy + TILE > VIEW_H) continue;
        const r: Rect = { x: lx, y: fy, w: TILE, h: TILE };
        if (!notUrbanAt(wx) || !groundFree(r, x0, seed, occupied)) continue;
        occupied.push(r);
        const sprite = fencePixmap(keyRng(seed, "ft", k, s));
        drawables.push({ baseY: fy + 28, bounds: r, draw: () => blit(pm, sprite, lx, fy) });
      }
    }
  }

  const lights: LampLight[] = [];
  placeTown(pm, x0, seed, drawables, trees, lights);

  const { depth, depthBase } = drawSorted(pm, drawables);

  return { pixmap: pm, depth, depthBase, water, lights, items, tallGrass, trees, berryTrees };
}

/**
 * Foreground parallax layer: oversized near objects along the bottom edge,
 * rendered transparent elsewhere. Scrolled faster than the background by the
 * renderer for depth.
 */
export interface ForegroundResult {
  pixmap: Pixmap;
  /** Same meaning as `ChunkResult.depth` and `ChunkResult.depthBase`. */
  depth: Uint16Array;
  depthBase: Int16Array;
  trees: TreeSpot[];
}

/**
 * A low grassy knoll along the bottom edge for a foreground object to
 * stand on. The foreground scrolls at a different rate from the world, so
 * where it will pass over a lake can't be known when it's generated —
 * giving each near object its own patch of bank means it reads as the
 * near shore in front of the water rather than a tree planted in it.
 */
function drawNearBank(pm: Pixmap, cx: number, halfW: number): void {
  pm.fillEllipse(cx, VIEW_H + 3, halfW + 1, 12, C.grassDark);
  pm.fillEllipse(cx, VIEW_H + 4, halfW, 11, C.grass);
  for (let x = Math.round(cx - halfW * 0.7); x < cx + halfW * 0.7; x += 3) {
    const dx = (x - cx) / halfW;
    pm.set(x, Math.round(VIEW_H + 4 - 11 * Math.sqrt(1 - dx * dx)) + 1, C.grassLight);
  }
}

export function generateForeground(seed: string, k: number): ForegroundResult {
  const pm = new Pixmap(CHUNK_W, VIEW_H);
  const trees: TreeSpot[] = [];
  const drawables: Drawable[] = [];
  const rng = keyRng(seed, "fg", k);
  const nTrees = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < nTrees; i++) {
    const scale = 1.7 + rng() * 0.5;
    const w = Math.round(TREE_W * scale);
    const h = Math.round(TREE_H * scale);
    const tx = Math.floor(rng() * (CHUNK_W - w));
    if (overWater(k * CHUNK_W + tx, w, seed)) continue;
    // sunk just far enough that the root tips run off the bottom edge
    const ty = VIEW_H - h + Math.round(2 * scale);
    const fgForest = regionWeights(k * CHUNK_W + tx + w / 2, seed).forest;
    const kind: TreeKind = keyRng(seed, "fgkind", k, i)() < 0.3 * fgForest ? "conifer" : "broadleaf";
    const spec = treeSpec(keyRng(seed, "fgspec", k, i), kind);
    const baseRng = keyRng(seed, "fgbase", k, i);
    const spot: TreeSpot = { x: k * CHUNK_W + tx, y: ty, scale, spec, depth: 0 };
    trees.push(spot);
    drawables.push({
      baseY: ty + Math.round(61 * scale),
      bounds: groundedTreeBounds(tx, ty, scale),
      ground: () => {
        drawNearBank(pm, tx + w / 2, w * 0.42);
        drawTreeShadow(pm, tx, ty, scale, baseRng);
      },
      draw: () => drawGroundedTree(pm, tx, ty, scale, spec, baseRng),
      spot,
    });
  }
  if (rng() < 0.7) {
    const scale = 1.6 + rng() * 0.5;
    const w = Math.round(32 * scale);
    const tx = Math.floor(rng() * (CHUNK_W - w));
    if (!overWater(k * CHUNK_W + tx, w, seed)) {
      const by = VIEW_H - Math.round(32 * scale);
      drawables.push({
        baseY: VIEW_H,
        bounds: { x: tx, y: by, w, h: VIEW_H - by },
        ground: () => {
          drawNearBank(pm, tx + w / 2, w * 0.6);
          pm.fillEllipse(tx + w / 2, VIEW_H - 5, w * 0.4, 4, C.grassDark);
        },
        draw: () => blitScaled(pm, berryBushPixmap(keyRng(seed, "fgb", k)), tx, by, scale),
      });
    }
  }
  const { depth, depthBase } = drawSorted(pm, drawables);
  return { pixmap: pm, depth, depthBase, trees };
}
