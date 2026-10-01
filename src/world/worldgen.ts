import { Pixmap, blit, blitScaled } from "../core/pixmap";
import { C } from "../core/palette";
import { keyRng, noise2i, hashString } from "../core/prng";
import { ditherPick, smoothstep } from "../core/dither";
import { fbm1D } from "../core/perlin";
import { tallGrassTile, flowerTile, grassTickTile, TILE } from "../sprites/tiles";
import {
  treePixmap,
  berryTreePixmap,
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

// --- regions ---
const REGION_ROUTE = 0;
const REGION_FOREST = 1;
const REGION_CITY = 2;

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

function pathBand(x: number, seed: string, region: number): [number, number] {
  const c = Math.round(pathCenter(x, seed));
  const half = region === REGION_CITY ? 36 : 26;
  return [c - half, c + half];
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
    const [pt, pb] = pathBand(wx, seed, region);
    if (pt < r.y + r.h && pb > r.y) return false;
    if (region !== REGION_CITY && inLake(wx, seed) && r.y + r.h > LAKE_TOP) {
      return false;
    }
  }
  for (const o of occupied) {
    if (overlaps(r, o)) return false;
  }
  return true;
}

/** Generate a full-height chunk (world x in [k*CHUNK_W, (k+1)*CHUNK_W)). */
export function generateChunk(seed: string, k: number): Pixmap {
  const pm = new Pixmap(CHUNK_W, VIEW_H);
  const x0 = k * CHUNK_W;
  const region = regionAt(x0 + CHUNK_W / 2, seed);
  const grassSeed = hashString(seed + ":grass");
  const waterSeed = hashString(seed + ":water");
  const roadSeed = hashString(seed + ":road");

  // far hills (hazy)
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const top = Math.round(farHillTop(x0 + lx, seed));
    for (let y = top; y < HORIZON; y++) pm.set(lx, y, C.treelineHaze);
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

  // ground: flat per-region base color with broad (coarse-grained, not
  // per-pixel) tone blending, so open fields read as a material rather than
  // static. `forest` never fully saturates to a single flat index — it
  // dithers toward a dark-but-still-varied floor, preserving texture even in
  // dense woods (previously a worldgen bug: solid-color dead patches).
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = x0 + lx;
    const { urban, forest } = regionWeights(wx, seed);
    const tone = fbm1D(wx / 1800, seed + ":tone", 2);
    for (let y = HORIZON; y < VIEW_H; y++) {
      let c = C.grass;
      if (tone > 0.62) c = ditherPick(C.grassLight, c, (tone - 0.62) * 1.8, wx >> 2, y >> 2);
      else if (tone < 0.38) c = ditherPick(C.grassDark, c, (0.38 - tone) * 1.8, wx >> 2, y >> 2);
      if (forest > 0) {
        const n = noise2i(grassSeed, wx >> 2, y >> 2);
        const floor = n > 0.85 ? C.grass : C.grassDark;
        c = ditherPick(floor, c, Math.min(forest, 0.9), wx >> 2, y >> 2);
      }
      // fine-grained (not coarsened) and skipped once forest is established,
      // so a trace of residual urban weight near a forest chunk can't paint
      // visible gray blocks inside the woods (forest already excludes urban
      // via regionWeights, but not all the way to exactly 0).
      if (urban > 0 && forest < 0.3) c = ditherPick(C.roadLight, c, urban, wx, y);
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
      if (urban > 0.2 || regionAt(wx, seed) === REGION_CITY) continue;
      if (regionAt(wx, seed) !== REGION_CITY && inLake(wx, seed) && wy + TILE > LAKE_TOP) continue;
      const tileRng = keyRng(seed, "grasstick", x0 + tx * TILE, ty);
      blit(pm, grassTickTile(tileRng, forest > 0.3), tx * TILE, wy);
    }
  }

  // lake (bottom water, non-city only)
  if (region !== REGION_CITY) {
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
      if (edge > 0.5) {
        pm.set(lx, surf, C.shore);
        pm.set(lx, surf + 1, C.shore);
        pm.set(lx, surf + 2, C.pathDark);
        pm.set(lx, surf + 3, C.waterBright);
      }
    }
  }

  // objects (region-dependent)
  const occupied: Rect[] = [];
  let trainerRect: Rect | null = null;
  let trainerVariant = 0;

  if (region === REGION_CITY) {
    // buildings along the sidewalk above the road
    const bRng = keyRng(seed, "city", k);
    const n = 2 + Math.floor(bRng() * 3);
    for (let i = 0; i < n; i++) {
      const bx = 8 + Math.floor(bRng() * (CHUNK_W - BUILDING_W - 16));
      const wx = x0 + bx + BUILDING_W / 2;
      const [pt] = pathBand(wx, seed, REGION_CITY);
      const by = pt - BUILDING_H - 10;
      const r: Rect = { x: bx, y: by, w: BUILDING_W, h: BUILDING_H };
      if (!groundFree(r, x0, seed, occupied)) continue;
      occupied.push(r);
      pm.fillEllipse(bx + BUILDING_W / 2, by + BUILDING_H - 3, 34, 5, C.roadDark);
      blit(pm, buildingPixmap(Math.floor(bRng() * 3)), bx, by);
    }
  } else {
    // trainer (route only)
    const trainerRng = keyRng(seed, "trainer", k);
    if (region === REGION_ROUTE && trainerRng() < 0.35) {
      trainerVariant = Math.floor(trainerRng() * 3);
      const tx = 32 + Math.floor(trainerRng() * (CHUNK_W - 96));
      const wx = x0 + tx + TRAINER_W / 2;
      const base = Math.round(pathCenter(wx, seed));
      const ty = base - TRAINER_H;
      if (ty > HORIZON && base + 4 < VIEW_H) {
        trainerRect = { x: tx, y: ty, w: TRAINER_W, h: TRAINER_H };
        occupied.push(trainerRect);
      }
    }

    // trees (denser in forest; irregular spacing, position, and size so the
    // treeline doesn't read as a ruled-off row of identical stamps)
    const treeRng = keyRng(seed, "trees", k);
    for (const band of [
      { y: 96, jitter: 16 },
      { y: 256, jitter: 16 },
    ]) {
      const prob = band.y === 96 ? (region === REGION_FOREST ? 0.55 : 0.3) : (region === REGION_FOREST ? 0.4 : 0.22);
      let tx = 0;
      while (tx <= CHUNK_TILES - 2) {
        const step = 1 + Math.floor(treeRng() * 3);
        if (treeRng() <= prob) {
          const scale = 0.82 + treeRng() * 0.36;
          const w = Math.round(TREE_W * scale);
          const h = Math.round(TREE_H * scale);
          const jx = tx * TILE + Math.floor((treeRng() * 2 - 1) * 10);
          const jy = band.y + Math.floor((treeRng() * 2 - 1) * band.jitter);
          const r: Rect = {
            x: Math.max(0, Math.min(CHUNK_W - w, jx)),
            y: jy,
            w,
            h,
          };
          if (groundFree(r, x0, seed, occupied)) {
            occupied.push(r);
            pm.fillEllipse(r.x + w / 2, r.y + h - 3, 20 * scale, 4, C.grassDark);
            blitScaled(pm, treePixmap(Math.floor(treeRng() * 3)), r.x, r.y, scale);
          }
        }
        tx += step;
      }
    }

    // berry trees
    const berryRng = keyRng(seed, "berry", k);
    if (berryRng() < 0.3) {
      const bx = 16 + Math.floor(berryRng() * (CHUNK_W - TREE_W - 32));
      const r: Rect = { x: bx, y: 96, w: TREE_W, h: TREE_H };
      if (groundFree(r, x0, seed, occupied)) {
        occupied.push(r);
        pm.fillEllipse(r.x + TREE_W / 2, r.y + TREE_H - 3, 20, 4, C.grassDark);
        blit(pm, berryTreePixmap(), r.x, r.y);
      }
    }

    // berry bushes
    const bushRng = keyRng(seed, "bush", k);
    const bushes = 2 + Math.floor(bushRng() * 3);
    for (let i = 0; i < bushes; i++) {
      const bx = Math.floor(bushRng() * (CHUNK_W - 32));
      const by = bushRng() < 0.5 ? 96 : 224;
      const r: Rect = { x: bx, y: by, w: 32, h: 32 };
      if (!groundFree(r, x0, seed, occupied)) continue;
      occupied.push(r);
      pm.fillEllipse(r.x + 16, r.y + 29, 12, 3, C.grassDark);
      blit(pm, berryBushPixmap(keyRng(seed, "bushtile", k, i)), r.x, r.y);
    }

    // tall grass patches
    const tallRng = keyRng(seed, "tall", k);
    const patches = 2 + Math.floor(tallRng() * 3);
    for (let i = 0; i < patches; i++) {
      const tx = Math.floor(tallRng() * (CHUNK_TILES - 2));
      const wy = tallRng() < 0.5 ? 128 : 256;
      const wide = tallRng() < 0.4 ? 2 : 1;
      const r: Rect = { x: tx * TILE, y: wy, w: TILE * wide, h: TILE };
      if (!groundFree(r, x0, seed, occupied)) continue;
      occupied.push(r);
      for (let t = 0; t < wide; t++) {
        blit(pm, tallGrassTile(keyRng(seed, "talltile", k, i, t)), r.x + t * TILE, r.y);
      }
    }

    // flower clusters
    const flowerRng = keyRng(seed, "flower", k);
    const clusters = 2 + Math.floor(flowerRng() * 3);
    for (let i = 0; i < clusters; i++) {
      const cx = Math.floor(flowerRng() * CHUNK_W);
      const cy = flowerRng() < 0.5 ? 144 : 240;
      const n = 2 + Math.floor(flowerRng() * 3);
      for (let f = 0; f < n; f++) {
        const fx = Math.max(0, Math.min(CHUNK_W - TILE, cx + (Math.floor(flowerRng() * 48) - 24)));
        const fy = Math.max(HORIZON, Math.min(VIEW_H - TILE, cy + (Math.floor(flowerRng() * 32) - 16)));
        const r: Rect = { x: fx, y: fy, w: TILE, h: TILE };
        if (!groundFree(r, x0, seed, occupied)) continue;
        blit(pm, flowerTile(keyRng(seed, "flowertile", k, i, f)), r.x, r.y);
      }
    }

    // fence run (route only)
    if (region === REGION_ROUTE) {
      const fenceRng = keyRng(seed, "fence", k);
      if (fenceRng() < 0.4) {
        const start = Math.floor(fenceRng() * 8) * TILE;
        const segs = 4 + Math.floor(fenceRng() * 6);
        for (let s = 0; s < segs; s++) {
          const lx = start + s * TILE;
          if (lx + TILE > CHUNK_W) break;
          const wx = x0 + lx + 16;
          const [, pb] = pathBand(wx, seed, REGION_ROUTE);
          const fy = pb + 8;
          if (fy + TILE > VIEW_H) continue;
          const r: Rect = { x: lx, y: fy, w: TILE, h: TILE };
          if (!groundFree(r, x0, seed, occupied)) continue;
          occupied.push(r);
          blit(pm, fencePixmap(keyRng(seed, "ft", k, s)), lx, fy);
        }
      }
    }
  }

  // path / road (smooth dirt↔road blend, wider in cities, fades in forest)
  const pathSeed = hashString(seed + ":path");
  for (let lx = 0; lx < CHUNK_W; lx++) {
    const wx = x0 + lx;
    const { urban, forest } = regionWeights(wx, seed);
    if (forest > 0.8) continue;
    const center = Math.round(pathCenter(wx, seed));
    const half = 26 + urban * 10;
    const pt = center - Math.round(half);
    const pb = center + Math.round(half);
    for (let y = pt; y <= pb; y++) {
      if (y < HORIZON || y >= VIEW_H) continue;
      const n = noise2i(pathSeed, wx, y);
      let c: number;
      if (y === pt || y === pb) c = C.pathEdge;
      else if (y === pt + 1 || y === pb - 1) c = C.pathLight;
      else if (n < 0.06) c = C.pathDark;
      else if (n > 0.94) c = C.pathLight;
      else c = C.path;
      if (urban > 0) {
        let r: number;
        if (y === pt || y === pb) r = C.roadDark;
        else if (y === pt + 1 || y === pb - 1) r = C.roadLight;
        else if (n < 0.06) r = C.roadDark;
        else if (n > 0.94) r = C.roadLight;
        else r = C.road;
        c = ditherPick(r, c, urban, wx, y);
      }
      if (forest > 0) c = ditherPick(C.grassDark, c, forest * 1.1, wx, y);
      pm.set(lx, y, c);
    }
  }

  // trainer drawn last, standing on the path
  if (trainerRect) {
    pm.fillEllipse(trainerRect.x + TRAINER_W / 2, trainerRect.y + TRAINER_H - 2, 12, 3, C.pathDark);
    blit(pm, trainerPixmap(trainerVariant), trainerRect.x, trainerRect.y);
  }

  // city street furniture (drawn after the road)
  if (region === REGION_CITY) {
    const lampRng = keyRng(seed, "lamp", k);
    const nLamps = 2 + Math.floor(lampRng() * 2);
    for (let i = 0; i < nLamps; i++) {
      const lx = 16 + Math.floor(lampRng() * (CHUNK_W - 48));
      const wx = x0 + lx + 12;
      const [, pb] = pathBand(wx, seed, REGION_CITY);
      const ly = pb + 2;
      if (ly + 56 > VIEW_H) continue;
      blit(pm, streetlampPixmap(keyRng(seed, "lt", k, i)), lx, ly);
    }

    const benchRng = keyRng(seed, "bench", k);
    const nBenches = Math.floor(benchRng() * 2);
    for (let i = 0; i < nBenches; i++) {
      const bx = 16 + Math.floor(benchRng() * (CHUNK_W - 72));
      const wx = x0 + bx + 20;
      const [pt] = pathBand(wx, seed, REGION_CITY);
      const by = pt - 20;
      const r: Rect = { x: bx, y: by, w: 40, h: 20 };
      if (by < HORIZON) continue;
      if (!groundFree(r, x0, seed, occupied)) continue;
      blit(pm, benchPixmap(keyRng(seed, "bt", k, i)), bx, by);
    }

    const fbRng = keyRng(seed, "flowerbed", k);
    const nFb = 1 + Math.floor(fbRng() * 2);
    for (let i = 0; i < nFb; i++) {
      const fx = 16 + Math.floor(fbRng() * (CHUNK_W - 64));
      const wx = x0 + fx + 16;
      const [pt] = pathBand(wx, seed, REGION_CITY);
      const fy = pt - 16;
      const r: Rect = { x: fx, y: fy, w: 32, h: 14 };
      if (fy < HORIZON) continue;
      if (!groundFree(r, x0, seed, occupied)) continue;
      blit(pm, flowerBedPixmap(keyRng(seed, "fbt", k, i)), fx, fy);
    }
  }

  return pm;
}

/**
 * Foreground parallax layer: oversized near objects along the bottom edge,
 * rendered transparent elsewhere. Scrolled faster than the background by the
 * renderer for depth.
 */
export function generateForeground(seed: string, k: number): Pixmap {
  const pm = new Pixmap(CHUNK_W, VIEW_H);
  const rng = keyRng(seed, "fg", k);
  const nTrees = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < nTrees; i++) {
    const scale = 1.7 + rng() * 0.5;
    const w = Math.round(TREE_W * scale);
    const h = Math.round(TREE_H * scale);
    const tx = Math.floor(rng() * (CHUNK_W - w));
    if (overWater(k * CHUNK_W + tx, w, seed)) continue;
    const ty = VIEW_H - h + 8;
    pm.fillEllipse(tx + w / 2, VIEW_H - 7, w * 0.3, 5, C.grassDark);
    blitScaled(pm, treePixmap(Math.floor(rng() * 3)), tx, ty, scale);
  }
  if (rng() < 0.7) {
    const scale = 1.6 + rng() * 0.5;
    const w = Math.round(32 * scale);
    const tx = Math.floor(rng() * (CHUNK_W - w));
    if (!overWater(k * CHUNK_W + tx, w, seed)) {
      pm.fillEllipse(tx + w / 2, VIEW_H - 5, w * 0.4, 4, C.grassDark);
      blitScaled(pm, berryBushPixmap(keyRng(seed, "fgb", k)), tx, VIEW_H - Math.round(32 * scale), scale);
    }
  }
  return pm;
}
