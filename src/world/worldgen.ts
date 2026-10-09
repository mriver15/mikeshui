import { Pixmap, blit, blitScaled } from "../core/pixmap";
import { C } from "../core/palette";
import { keyRng, noise2i, hashString } from "../core/prng";
import { ditherPick, smoothstep } from "../core/dither";
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
  buildingPixmap,
  streetlampPixmap,
  benchPixmap,
  flowerBedPixmap,
  TREE_W,
  TREE_H,
  BUILDING_W,
  BUILDING_H,
} from "../sprites/objects";

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
 * checks scattered through generateChunk. Deliberately does NOT cover
 * ground/path color: that's a continuous 2-axis blend (see
 * `regionWeights` below), a different mechanism, and today route and
 * forest already share identical ground colors — only city differs,
 * already handled by the urban blend. A region whose ground color needs
 * to differ (sand, snow, ...) is a real follow-up, not solved here.
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
  hasBerryTree: boolean;
  hasBushes: boolean;
  hasTallGrass: boolean;
  hasFlowers: boolean;
  hasFence: boolean;
  hasBuildings: boolean;
  hasStreetFurniture: boolean;
}

const REGION_CONFIGS: Record<number, RegionConfig> = {
  [REGION_ROUTE]: {
    name: "route",
    hasLake: true,
    hasTrainer: true,
    treeDensityUpland: 0.3,
    treeDensityLowland: 0.22,
    coniferShare: 0.12,
    undergrowth: 0.35,
    hasBerryTree: true,
    hasBushes: true,
    hasTallGrass: true,
    hasFlowers: true,
    hasFence: true,
    hasBuildings: false,
    hasStreetFurniture: false,
  },
  [REGION_FOREST]: {
    name: "forest",
    hasLake: true,
    hasTrainer: false,
    treeDensityUpland: 0.55,
    treeDensityLowland: 0.4,
    coniferShare: 0.45,
    undergrowth: 1,
    hasBerryTree: true,
    hasBushes: true,
    hasTallGrass: true,
    hasFlowers: true,
    hasFence: false,
    hasBuildings: false,
    hasStreetFurniture: false,
  },
  [REGION_CITY]: {
    name: "city",
    hasLake: false,
    hasTrainer: false,
    treeDensityUpland: 0,
    treeDensityLowland: 0,
    coniferShare: 0,
    undergrowth: 0,
    hasBerryTree: false,
    hasBushes: false,
    hasTallGrass: false,
    hasFlowers: false,
    hasFence: false,
    hasBuildings: true,
    hasStreetFurniture: true,
  },
};

function regionAt(x: number, seed: string): number {
  const v = fbm1D(x / 8000, seed + ":region", 3);
  if (v > 0.72) return REGION_CITY;
  if (v > 0.5) return REGION_FOREST;
  return REGION_ROUTE;
}

/** Continuous region weights for smooth ground/path blending. */
function regionWeights(x: number, seed: string): { urban: number; forest: number } {
  const v = fbm1D(x / 8000, seed + ":region", 3);
  const urban = smoothstep(0.67, 0.77, v);
  const forest = smoothstep(0.46, 0.56, v) * (1 - urban);
  return { urban, forest };
}

// --- continuous terrain curves (functions of world x, seam-free) ---

/** Distant hazy hills behind everything. */
function farHillTop(x: number, seed: string): number {
  return 40 + fbm1D(x / 90, seed + ":far", 2) * 30;
}

/** Mid-distance forested hills. */
function midHillTop(x: number, seed: string): number {
  return 70 + fbm1D(x / 50, seed + ":mid", 3) * 40;
}

function pathCenter(x: number, seed: string): number {
  return 200 + fbm1D(x / 320, seed + ":path", 2) * 28;
}

/** Below this half-width the path has petered out entirely. */
const PATH_MIN_HALF = 3;

/**
 * The path's [top, bottom] rows at world-x `x` — the one definition both
 * drawing and placement use. Wider as it becomes a city street; as forest
 * takes over it narrows to a thin trail and then ends, instead of being
 * dithered away and stopping at a hard vertical edge. Each edge wobbles a
 * pixel or two in the woods, where nobody keeps the verges straight.
 * Returns null where there's no path.
 */
function pathBand(x: number, seed: string): [number, number] | null {
  const { urban, forest } = regionWeights(x, seed);
  const half = (26 + urban * 10) * (1 - smoothstep(0.3, 0.85, forest));
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
    if (regionAt(sx, seed) !== REGION_CITY && inLake(sx, seed)) return true;
  }
  return false;
}

/** Whether a world-x column is open lake water (for the animated shimmer). */
export function isWaterAt(x: number, seed: string): boolean {
  return regionAt(x, seed) !== REGION_CITY && inLake(x, seed);
}

/**
 * Lake surface y for a world-x column. Tapers toward the bottom of the
 * screen (vanishingly thin water) as the shore approaches, matching the
 * `lakeDepth` ramp used to fill it, so start/end edges blend rather than
 * cutting off as a flat-walled block.
 */
export function waterSurfaceY(x: number, seed: string): number {
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

export interface ChunkResult {
  pixmap: Pixmap;
  /**
   * Per-pixel draw-order depth, same size as `pixmap`: 0 for ground, else
   * the 1-based sort index of the object that last painted that pixel.
   * Tree canopies and tall grass aren't baked into `pixmap` — they sway,
   * so the renderer draws them every frame, in depth order, writing only
   * pixels whose depth is <= their own, so a canopy behind a nearer tree
   * or bush can't paint over it.
   */
  depth: Uint16Array;
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
 * keeps every sprite routine oblivious to depth.
 */
function drawSorted(pm: Pixmap, items: Drawable[]): Uint16Array {
  const depth = new Uint16Array(pm.w * pm.h);
  for (const item of items) item.ground?.();
  const order = items.map((item, i) => ({ item, i })).sort((a, b) => a.item.baseY - b.item.baseY || a.i - b.i);
  order.forEach(({ item }, n) => {
    const d = n + 1;
    const x0 = Math.max(0, Math.floor(item.bounds.x));
    const y0 = Math.max(0, Math.floor(item.bounds.y));
    const x1 = Math.min(pm.w, Math.ceil(item.bounds.x + item.bounds.w));
    const y1 = Math.min(pm.h, Math.ceil(item.bounds.y + item.bounds.h));
    const bw = x1 - x0;
    const before = new Uint8Array(Math.max(0, bw * (y1 - y0)));
    for (let y = y0; y < y1; y++) before.set(pm.data.subarray(y * pm.w + x0, y * pm.w + x1), (y - y0) * bw);
    item.draw?.();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (pm.data[y * pm.w + x] !== before[(y - y0) * bw + (x - x0)]) depth[y * pm.w + x] = d;
      }
    }
    if (item.spot) item.spot.depth = d;
  });
  return depth;
}

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
    const region = regionAt(wx, seed);
    const band = pathBand(wx, seed);
    if (band && band[0] < r.y + r.h && band[1] > r.y) return false;
    if (region !== REGION_CITY && inLake(wx, seed) && r.y + r.h > LAKE_TOP) {
      return false;
    }
  }
  for (const o of occupied) {
    if (overlaps(r, o)) return false;
  }
  return true;
}

/**
 * Path / road: flat dirt or flat pavement base (a clean switch at the
 * urban midpoint, like a real road-surface change at a town's edge,
 * rather than a per-pixel dither across the whole range), with a dark
 * edge line and a lit inner line. Where it narrows into a forest trail,
 * grass blades creep in across it. Topped with sparse authored
 * pebble/seam ticks (tile-grid, like the grass ticks) clipped to the
 * path itself so none land on the verge.
 */
function drawPath(pm: Pixmap, x0: number, seed: string): void {
  const creepSeed = hashString(seed + ":pathcreep");
  const bands: Array<[number, number] | null> = [];
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = x0 + lx;
    const band = pathBand(wx, seed);
    bands.push(band);
    if (!band) continue;
    const [pt, pb] = band;
    const { urban, forest } = regionWeights(wx, seed);
    const paved = urban > 0.5;
    const creep = paved ? 0 : smoothstep(0.15, 0.8, forest) * 0.18;
    for (let y = pt; y <= pb; y++) {
      if (y < HORIZON || y >= VIEW_H) continue;
      let c: number = paved ? C.road : C.path;
      if (y === pt || y === pb) c = paved ? C.roadDark : C.pathEdge;
      else if (y === pt + 1 || y === pb - 1) c = paved ? C.roadLight : C.pathLight;
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
      const mid = bands[tx * TILE + TILE / 2];
      if (!mid) continue;
      const tileTop = ty * TILE;
      if (tileTop + TILE <= mid[0] + 3 || tileTop >= mid[1] - 3) continue;
      const urban = regionWeights(x0 + tx * TILE + TILE / 2, seed).urban;
      const tick = pathTickTile(keyRng(seed, "pathtick", x0 + tx * TILE, ty), urban > 0.5);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const c = tick.get(x, y);
          const band = bands[tx * TILE + x];
          if (!c || !band || tileTop + y <= band[0] + 1 || tileTop + y >= band[1] - 1) continue;
          pm.set(tx * TILE + x, tileTop + y, c);
        }
      }
    }
  }
}

/** Generate a full-height chunk (world x in [k*CHUNK_W, (k+1)*CHUNK_W)). */
export function generateChunk(seed: string, k: number): ChunkResult {
  const pm = new Pixmap(CHUNK_W, VIEW_H);
  const x0 = k * CHUNK_W;
  const region = regionAt(x0 + CHUNK_W / 2, seed);
  const cfg = REGION_CONFIGS[region];
  const waterSeed = hashString(seed + ":water");
  const roadSeed = hashString(seed + ":road");

  // far hills (hazy) — a light ridge-top line and very sparse soft ticks
  // so the band isn't a single flat fill, kept subtle since this layer
  // should read as hazier/less detailed than the mid-hill band in front of it.
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const top = Math.round(farHillTop(x0 + lx, seed));
    for (let y = top; y < HORIZON; y++) {
      pm.set(lx, y, y - top < 2 ? C.treelineHazeLight : C.treelineHaze);
    }
  }
  {
    const farTickRng = keyRng(seed, "fartick", k);
    const nTicks = Math.round(CHUNK_W / 24);
    for (let i = 0; i < nTicks; i++) {
      const lx = Math.floor(farTickRng() * CHUNK_W);
      const top = Math.round(farHillTop(x0 + lx, seed));
      const y = top + 3 + Math.floor(farTickRng() * 10);
      if (y >= HORIZON) continue;
      pm.set(lx, y, C.treelineHazeDark);
    }
  }

  // mid hills (forested)
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const top = Math.round(midHillTop(x0 + lx, seed));
    for (let y = top; y < HORIZON; y++) {
      pm.set(lx, y, y - top < 4 ? C.treelineDark : C.treeline);
    }
  }
  // sparse tree-crown ticks on the mid hills — small discrete marks read as
  // individual distant trees, instead of a flat silhouette block.
  {
    const hillTickRng = keyRng(seed, "hilltick", k);
    const nTicks = Math.round(CHUNK_W / 10);
    for (let i = 0; i < nTicks; i++) {
      const lx = Math.floor(hillTickRng() * CHUNK_W);
      const top = Math.round(midHillTop(x0 + lx, seed));
      const y = top + 2 + Math.floor(hillTickRng() * 7);
      if (y >= HORIZON) continue;
      pm.set(lx, y, C.treelineDark);
    }
  }

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
  // City paving overrides it all.
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
      // flat grass below the band, flat pavement above it, dithered only
      // within a narrow transition — dithering the *entire* urban range
      // produced a wide, visibly speckled "half-paved" zone across whole
      // city chunks wherever the slow-moving region noise lingered
      // mid-transition, rather than a believable sidewalk edge. Skipped
      // once forest is established, so residual urban weight can't fleck
      // the woods.
      if (forest < 0.3) {
        if (urban > 0.65) c = C.roadLight;
        else if (urban > 0.35) c = ditherPick(C.roadLight, c, (urban - 0.35) / 0.3, wx, y);
      }
      if (urban > 0.8) {
        const pn = noise2i(roadSeed, wx >> 2, y >> 2);
        if (pn < 0.04) c = C.roadDark;
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
      const { urban, forest } = regionWeights(wx, seed);
      if (urban > 0.35 || regionAt(wx, seed) === REGION_CITY) continue;
      if (regionAt(wx, seed) !== REGION_CITY && inLake(wx, seed) && wy + TILE > LAKE_TOP) continue;
      const tileRng = keyRng(seed, "grasstick", x0 + tx * TILE, ty);
      blit(pm, grassTickTile(tileRng, forest > 0.3), tx * TILE, wy);
    }
  }

  // lake (bottom water, non-city only)
  if (cfg.hasLake) {
    for (let lx = 0; lx < CHUNK_W; lx++) {
      const wx = x0 + lx;
      if (regionAt(wx, seed) === REGION_CITY) continue;
      const depth = lakeDepth(wx, seed);
      if (depth <= 0.02) continue;
      const surf = waterSurfaceY(wx, seed);
      if (surf >= VIEW_H) continue;
      // fade the shoreline in/out over the last stretch of taper (rather
      // than a hard edge) by dithering water against the grass already
      // painted there
      const edge = smoothstep(0.02, 0.35, depth);
      for (let y = surf; y < VIEW_H; y++) {
        const n = noise2i(waterSeed, wx, y);
        const wc = n < 0.05 ? C.waterDark : C.water;
        pm.set(lx, y, edge < 1 ? ditherPick(wc, pm.get(lx, y), 1 - edge, wx, y) : wc);
      }
      // shore: a sandy bank whose width wanders (rising 0–3px up into the
      // grass above the waterline), edged by a dark grass lip, flecked
      // with pebbles, then a band of wet sand and a bright foam line
      if (edge > 0.5) {
        const rise = Math.max(0, Math.round(fbm1D(wx / 14, seed + ":beach", 2) * 5) - 1);
        const sandTop = surf - rise;
        pm.set(lx, sandTop - 1, C.grassDark);
        for (let y = sandTop; y <= surf + 1; y++) {
          const n = noise2i(waterSeed, wx, y + 9999);
          pm.set(lx, y, n < 0.05 ? C.roadDark : n > 0.96 ? C.pathLight : C.shore);
        }
        pm.set(lx, surf + 2, C.pathDark);
        pm.set(lx, surf + 3, C.waterBright);
      }
    }

    // lily pads drifting on the open water (not in the tapering shallows)
    const padRng = keyRng(seed, "lilypad", k);
    const pads = Math.floor(padRng() * 6);
    for (let i = 0; i < pads; i++) {
      const lx = 8 + Math.floor(padRng() * (CHUNK_W - 16));
      const wx = x0 + lx;
      const frac = padRng();
      if (regionAt(wx, seed) === REGION_CITY || lakeDepth(wx, seed) < 0.6) continue;
      const surf = waterSurfaceY(wx, seed);
      if (VIEW_H - surf < 16) continue;
      const cy = surf + 9 + Math.floor(frac * (VIEW_H - surf - 13));
      drawLilyPad(pm, lx, cy, padRng, C.water);
    }
  }

  // path / road, before any objects: everything standing on the ground is
  // depth-sorted and drawn over it, so a tree just below the path can hang
  // its canopy over the dirt instead of being kept clear of it.
  drawPath(pm, x0, seed);

  // objects (region-dependent). Each placement pushes a Drawable; they're
  // drawn together at the end in base-y order (see `drawSorted`).
  const occupied: Rect[] = [];
  const drawables: Drawable[] = [];
  const tallGrass: TallGrassSpot[] = [];
  const trees: TreeSpot[] = [];
  const berryTrees: BerryTreeSpot[] = [];
  const fieldTop = HORIZON + 6;
  const fieldBottom = VIEW_H - 2;

  if (cfg.hasBuildings) {
    // buildings along the sidewalk above the road
    const bRng = keyRng(seed, "city", k);
    const n = 2 + Math.floor(bRng() * 3);
    for (let i = 0; i < n; i++) {
      const bx = 8 + Math.floor(bRng() * (CHUNK_W - BUILDING_W - 16));
      const wx = x0 + bx + BUILDING_W / 2;
      // the chunk-wide `region` picks the city *branch*, but ground color is
      // a continuous blend — without this, a building could land on ground
      // that's still rendering as grass near a chunk's edge. Check the
      // actual local weight, not just the chunk's one midpoint sample.
      if (regionWeights(wx, seed).urban < 0.55) continue;
      const band = pathBand(wx, seed);
      if (!band) continue;
      const [pt] = band;
      const by = pt - BUILDING_H - 10;
      const r: Rect = { x: bx, y: by, w: BUILDING_W, h: BUILDING_H };
      if (!groundFree(r, x0, seed, occupied)) continue;
      occupied.push(r);
      const type = Math.floor(bRng() * 3);
      const sprite = buildingPixmap(type, bRng);
      drawables.push({
        baseY: by + BUILDING_H,
        bounds: r,
        ground: () => pm.fillEllipse(bx + BUILDING_W / 2, by + BUILDING_H - 3, 34, 5, C.roadDark),
        draw: () => blit(pm, sprite, bx, by),
      });
    }
  } else {
    // route/forest decorations: same "chunk-wide branch picks the mode,
    // but each candidate's own position must agree with the continuous
    // ground blend" fix as the building placement above — otherwise a
    // tree or fence post could land on ground that's locally rendering
    // as pavement near a chunk that's close to a city.
    const notUrbanAt = (wx: number) => regionWeights(wx, seed).urban < 0.4;

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

    // reeds standing in the shallows along the lake shore
    if (cfg.hasLake) {
      const reedRng = keyRng(seed, "reeds", k);
      for (let lx = 4 + Math.floor(reedRng() * 12); lx < CHUNK_W - REEDS_W; lx += 10 + Math.floor(reedRng() * 26)) {
        const wx = x0 + lx + REEDS_W / 2;
        const keep = reedRng() < 0.55;
        const sink = 5 + Math.floor(reedRng() * 6);
        if (!keep || regionAt(wx, seed) === REGION_CITY || lakeDepth(wx, seed) < 0.3) continue;
        const surf = waterSurfaceY(wx, seed);
        const baseY = surf + sink;
        if (baseY + 3 > VIEW_H) continue;
        const ry = baseY - REEDS_H + 3;
        const sprite = reedsPixmap(keyRng(seed, "reedtile", k, lx));
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
  }

  // city street furniture
  if (cfg.hasStreetFurniture) {
    const lampRng = keyRng(seed, "lamp", k);
    const nLamps = 2 + Math.floor(lampRng() * 2);
    for (let i = 0; i < nLamps; i++) {
      const lx = 16 + Math.floor(lampRng() * (CHUNK_W - 48));
      const wx = x0 + lx + 12;
      const band = pathBand(wx, seed);
      if (!band) continue;
      const [, pb] = band;
      const ly = pb + 2;
      if (ly + 56 > VIEW_H) continue;
      const sprite = streetlampPixmap(keyRng(seed, "lt", k, i));
      drawables.push({ baseY: ly + 56, bounds: { x: lx, y: ly, w: 24, h: 56 }, draw: () => blit(pm, sprite, lx, ly) });
    }

    const benchRng = keyRng(seed, "bench", k);
    const nBenches = Math.floor(benchRng() * 2);
    for (let i = 0; i < nBenches; i++) {
      const bx = 16 + Math.floor(benchRng() * (CHUNK_W - 72));
      const wx = x0 + bx + 20;
      const band = pathBand(wx, seed);
      if (!band) continue;
      const [pt] = band;
      const by = pt - 20;
      const r: Rect = { x: bx, y: by, w: 40, h: 20 };
      if (by < HORIZON) continue;
      if (!groundFree(r, x0, seed, occupied)) continue;
      const sprite = benchPixmap(keyRng(seed, "bt", k, i));
      drawables.push({ baseY: by + 20, bounds: r, draw: () => blit(pm, sprite, bx, by) });
    }

    const fbRng = keyRng(seed, "flowerbed", k);
    const nFb = 1 + Math.floor(fbRng() * 2);
    for (let i = 0; i < nFb; i++) {
      const fx = 16 + Math.floor(fbRng() * (CHUNK_W - 64));
      const wx = x0 + fx + 16;
      const band = pathBand(wx, seed);
      if (!band) continue;
      const [pt] = band;
      const fy = pt - 16;
      const r: Rect = { x: fx, y: fy, w: 32, h: 14 };
      if (fy < HORIZON) continue;
      if (!groundFree(r, x0, seed, occupied)) continue;
      const sprite = flowerBedPixmap(keyRng(seed, "fbt", k, i));
      drawables.push({ baseY: fy + 14, bounds: r, draw: () => blit(pm, sprite, fx, fy) });
    }
  }

  const depth = drawSorted(pm, drawables);

  return { pixmap: pm, depth, tallGrass, trees, berryTrees };
}

/**
 * Foreground parallax layer: oversized near objects along the bottom edge,
 * rendered transparent elsewhere. Scrolled faster than the background by the
 * renderer for depth.
 */
export interface ForegroundResult {
  pixmap: Pixmap;
  /** Same meaning as `ChunkResult.depth`. */
  depth: Uint16Array;
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
  const depth = drawSorted(pm, drawables);
  return { pixmap: pm, depth, trees };
}
