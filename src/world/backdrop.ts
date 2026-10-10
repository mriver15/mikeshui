import { Pixmap, blit } from "../core/pixmap";
import { C } from "../core/palette";
import { fbm1D, valueNoise1D } from "../core/perlin";
import { hashString, noise2i } from "../core/prng";
import { ditherPick, smoothstep } from "../core/dither";

/**
 * The landscape behind the field: distant mountains, hazy far hills,
 * forested mid hills and rolling meadow foothills, each its own parallax
 * layer so nearer ridges slide past farther ones as you wander. Layers
 * are rendered in fixed-width strips of their own scrolling space and
 * cached, the way the world is cached in chunks.
 */

/** Strip width, in a layer's own scrolling space; strips span the view from the top down to the horizon. */
const STRIP_W = 256;
const MAX_STRIPS = 96;

type StripPainter = (p: Pixmap, u0: number, seed: string, horizon: number) => void;

interface BackdropLayer {
  parallax: number;
  paint: StripPainter;
}

/** Height of a column of a layer, given its layer-space x. */
function mountainTop(u: number, seed: string): number {
  const presence = smoothstep(0.42, 0.64, fbm1D(u / 1400, seed + ":mtn", 2));
  if (presence <= 0) return Infinity;
  const r1 = 1 - Math.abs(2 * valueNoise1D(u / 150, seed + ":ridge1") - 1);
  const r2 = 1 - Math.abs(2 * valueNoise1D(u / 47, seed + ":ridge2") - 1);
  const ridge = Math.pow(r1, 1.6) * 0.78 + r2 * 0.22;
  return Math.round(112 - presence * (22 + ridge * 72));
}

function farTop(u: number, seed: string): number {
  return Math.round(60 + fbm1D(u / 110, seed + ":far", 3) * 34);
}

function midTop(u: number, seed: string): number {
  return Math.round(82 + fbm1D(u / 68, seed + ":mid", 3) * 34);
}

function nearTop(u: number, seed: string): number {
  return Math.round(106 + fbm1D(u / 58, seed + ":near", 2) * 20);
}

/**
 * Whether a column faces the light (upper left): the ground rises to its
 * right, so the slope faces left. Mountains and hills are shaded per
 * column by this — lit faces and shadowed faces in flat bands, the way
 * pixel-art ranges are drawn — rather than one flat silhouette color.
 */
function litAt(top: (u: number) => number, u: number, span = 1): boolean {
  return top(u + span) <= top(u - span);
}

/**
 * Mountains: jagged ridged-noise peaks that rise only in some stretches.
 * Lit faces are mid blue-gray with a pale ridge line, shadowed faces
 * darker — judged over a few columns of slope, so small wiggles in the
 * ridge don't flip the shading column by column into barcode stripes.
 * Peaks above the snow line carry snow caps with a smoothly wandering
 * lower edge, and a few broad gullies run down from them on lit faces.
 */
const paintMountains: StripPainter = (p, u0, seed) => {
  const top = (u: number) => mountainTop(u, seed);
  const gullySeed = hashString(seed + ":gully");
  const snowLine = 52;
  for (let x = 0; x < p.w; x++) {
    const u = u0 + x;
    const t = top(u);
    if (!Number.isFinite(t)) continue;
    const lit = litAt(top, u, 3);
    const wander = (valueNoise1D(u / 7, seed + ":snow") * 2 - 1) * 3;
    const snowEnd = t < snowLine ? t + Math.round((snowLine - t) * 0.5 + wander) : t;
    const g = u >> 2;
    const gully = lit && noise2i(gullySeed, g, 0) < 0.12;
    const gullyEnd = snowEnd + 6 + Math.floor(noise2i(gullySeed, g, 2) * 16);
    for (let y = Math.max(0, t); y < p.h; y++) {
      let c: number;
      if (y < snowEnd) c = lit ? (y === t ? C.cloud : C.cloudMid) : C.cloudShade;
      else if (y === t) c = lit ? C.mountainLight : C.mountain;
      else if (gully && y < gullyEnd) c = C.mountainDark;
      else c = lit ? C.mountain : C.mountainDark;
      p.set(x, y, c);
    }
  }
};

/**
 * Far hills: soft rolling ridges in haze greens. A lit rim along slopes
 * facing the light, a darker one on shadowed slopes, and very sparse
 * specks of distant trees.
 */
const paintFarHills: StripPainter = (p, u0, seed) => {
  const top = (u: number) => farTop(u, seed);
  const speckSeed = hashString(seed + ":farspeck");
  for (let x = 0; x < p.w; x++) {
    const u = u0 + x;
    const t = top(u);
    const lit = litAt(top, u);
    for (let y = t; y < p.h; y++) {
      let c = C.treelineHaze;
      if (y - t < 2) c = lit ? C.treelineHazeLight : C.treelineHazeDark;
      else if (y > t + 3 && noise2i(speckSeed, u, y) < 0.012) c = C.treelineHazeDark;
      p.set(x, y, c);
    }
  }
};

/**
 * Forested mid hills: the slopes are covered in rows of small shaded
 * treetops (a dark crescent to the lower right, lit body), staggered and
 * jittered, with the top row standing proud of the ridge so the
 * silhouette is a bumpy line of crowns rather than a smooth curve.
 * Shadowed slopes get darker crowns.
 */
const paintMidHills: StripPainter = (p, u0, seed) => {
  const top = (u: number) => midTop(u, seed);
  const crownSeed = hashString(seed + ":crowns");
  for (let x = 0; x < p.w; x++) {
    const t = top(u0 + x);
    for (let y = t + 1; y < p.h; y++) p.set(x, y, C.treeline);
  }
  // crowns on a staggered grid in layer space, drawn back (high) to
  // front (low) so lower crowns overlap the ones above them; a margin of
  // columns either side so crowns straddling strip edges match up
  for (let gy = 0; gy * 4 < p.h + 4; gy++) {
    for (let gx = -2; gx * 5 < p.w + 10; gx++) {
      const cu = Math.floor(u0 / 5) * 5 + gx * 5 + ((gy & 1) * 2);
      const n = noise2i(crownSeed, cu, gy);
      const cx = cu - u0 + Math.round((n * 2 - 1) * 1.5);
      const t = top(cu);
      const cy = t + 1 + gy * 4 - (gy === 0 ? 1 : 0) + Math.round(noise2i(crownSeed + 1, cu, gy) * 2);
      if (cy < t || cy >= p.h + 2) continue;
      const lit = litAt(top, cu);
      const r = 2.2 + noise2i(crownSeed + 2, cu, gy) * 0.8;
      p.fillCircle(cx + 0.8, cy + 0.8, r, C.treelineDark);
      p.fillCircle(cx, cy, r - 0.7, lit ? C.treeline : C.treelineDark);
      if (lit) p.set(cx - 1, cy - 1, C.treelineHaze);
    }
  }
};

/**
 * Meadow foothills: rolling grass-green swells right behind the field,
 * so the horizon is a soft, uneven line rather than a ruler edge. Lit
 * slopes catch a bright rim, shadowed ones a dark rim and a dithered
 * band of shade below it, and the odd lone tree stands on a crest.
 */
const paintNearHills: StripPainter = (p, u0, seed, horizon) => {
  const top = (u: number) => nearTop(u, seed);
  const treeSeed = hashString(seed + ":foottree");
  for (let x = 0; x < p.w; x++) {
    const u = u0 + x;
    const t = top(u);
    const lit = litAt(top, u);
    for (let y = t; y < p.h; y++) {
      let c = C.grass;
      if (y === t) c = lit ? C.grassLight : C.grassDark;
      else if (!lit && y - t < 4) c = ditherPick(C.grass, C.grassDark, 0.55 - (y - t) * 0.15, u, y);
      p.set(x, y, c);
    }
  }
  for (let cu = Math.floor(u0 / 9) * 9 - 9; cu < u0 + p.w + 9; cu += 9) {
    if (noise2i(treeSeed, cu, 0) > 0.09) continue;
    const t = top(cu);
    if (t >= horizon - 4) continue;
    const x = cu - u0;
    p.fillRect(x, t - 3, 1, 4, C.trunkDark);
    p.fillCircle(x + 0.5, t - 5, 3.2, C.treeDark);
    p.fillCircle(x, t - 5.5, 2.3, C.tree);
    p.set(x - 1, t - 7, C.treeLight);
  }
};

const LAYERS: BackdropLayer[] = [
  { parallax: 0.12, paint: paintMountains },
  { parallax: 0.3, paint: paintFarHills },
  { parallax: 0.55, paint: paintMidHills },
  { parallax: 0.8, paint: paintNearHills },
];

/** The backdrop of one world seed. */
export class Backdrop {
  private cache = new Map<string, Pixmap>();

  constructor(
    private seed: string,
    private horizon: number,
  ) {}

  /** How many layers there are, back (0) to front. */
  static readonly LAYER_COUNT = LAYERS.length;

  /** How fast layer `li` scrolls relative to the world. */
  static parallax(li: number): number {
    return LAYERS[li].parallax;
  }

  /** Draw layer `li` across the view for the given world scroll. */
  drawLayer(fb: Pixmap, li: number, scrollX: number): void {
    const layer = LAYERS[li];
    const u0 = Math.round(scrollX * layer.parallax);
    for (let s = Math.floor(u0 / STRIP_W); s * STRIP_W < u0 + fb.w; s++) {
      blit(fb, this.strip(li, s), s * STRIP_W - u0, 0);
    }
  }

  /**
   * Build one missing strip just beyond the view for some layer, in the
   * direction of travel (`dir` = ±1), so it's ready before it scrolls in.
   * Returns false when every layer's buffer is already built.
   */
  prefetch(scrollX: number, viewW: number, dir: number): boolean {
    for (let li = 0; li < LAYERS.length; li++) {
      const u0 = Math.round(scrollX * LAYERS[li].parallax);
      const first = Math.floor(u0 / STRIP_W);
      const last = Math.floor((u0 + viewW) / STRIP_W);
      for (const s of dir < 0 ? [first - 1, last + 1] : [last + 1, first - 1]) {
        if (!this.cache.has(`${li}:${s}`)) {
          this.strip(li, s);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Low-lying valley mist: haze thickening toward the horizon over
   * whatever's already drawn — drawn between the far and mid layers, so
   * the mountains' and far hills' feet fade into it and it pools in the
   * gaps between the nearer hills.
   */
  drawMist(fb: Pixmap): void {
    const depth = 24;
    for (let y = this.horizon - depth; y < this.horizon; y++) {
      const t = ((y - (this.horizon - depth)) / depth) * 0.75;
      for (let x = 0; x < fb.w; x++) {
        const i = y * fb.w + x;
        fb.data[i] = ditherPick(fb.data[i], C.treelineHazeLight, t, x, y);
      }
    }
  }

  private strip(li: number, s: number): Pixmap {
    const key = `${li}:${s}`;
    let p = this.cache.get(key);
    if (!p) {
      p = new Pixmap(STRIP_W, this.horizon + 2);
      LAYERS[li].paint(p, s * STRIP_W, this.seed, this.horizon);
      this.cache.set(key, p);
      if (this.cache.size > MAX_STRIPS) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    return p;
  }
}
