import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import type { RNG } from "../core/prng";

export const TREE_W = 64;
export const TREE_H = 64;

/**
 * One overlapping foliage "puff": dark ring, base fill, an upper-left light
 * crescent, and a tiny bright fleck. Authentic Gen-3 trees/bushes are built
 * from several of these nested circles overlapping into a cauliflower-like
 * dome, not a single smooth ellipse with angular shading bands — studied
 * from the public pokeemerald tileset rip (spriters-resource.com) to get
 * the silhouette and shading technique right; colors are this project's own
 * (pokeruby-disassembly-derived) palette, already a near-exact match.
 */
export function puff(p: Pixmap, cx: number, cy: number, r: number, swayX = 0): void {
  cx += swayX;
  p.fillCircle(cx, cy, r, C.black);
  p.fillCircle(cx, cy, r - 1.2, C.treeDark);
  p.fillCircle(cx - 0.5, cy - 0.5, r - 2.6, C.tree);
  p.fillCircle(cx - r * 0.32, cy - r * 0.38, r * 0.42, C.treeLight);
  p.fillCircle(cx - r * 0.4, cy - r * 0.46, r * 0.16, C.treeBright);
}

/**
 * One canopy lobe, in 64×64 sprite space. Broadleaf: a puff's centre and
 * radius. Conifer: one tier of boughs — apex x, bottom y, half-width at
 * the bottom (the apex y is derived from the tier above, see `coniferApex`).
 */
type Lobe = [x: number, y: number, size: number];

export type TreeKind = "broadleaf" | "conifer";

/**
 * Everything that makes one tree look like itself — canopy lobes, trunk
 * lean and girth, root flare. Rolled once per placed tree (`treeSpec`) and
 * kept on its spot, so the renderer can redraw the *same* tree swaying
 * each frame. Replaces the old three hand-authored lobe layouts, which
 * repeated visibly across a forest.
 */
export interface TreeSpec {
  kind: TreeKind;
  lobes: Lobe[];
  /** Horizontal offset of the trunk top relative to its base. */
  lean: number;
  /** Trunk half-width at the top; it flares wider toward the ground. */
  girth: number;
  /** Root lengths, negative to the left, positive to the right. */
  roots: number[];
}

const TRUNK_BASE_X = 32;
const TRUNK_BASE_Y = 61;

/** Roll a tree of the given kind (see `broadleafSpec` / `coniferSpec`). */
export function treeSpec(rng: RNG, kind: TreeKind = "broadleaf"): TreeSpec {
  return kind === "conifer" ? coniferSpec(rng) : broadleafSpec(rng);
}

/**
 * A broadleaf: a rough dome of 6–10 lobes in three loose rows (narrow
 * crown, wider middle, widest skirt), each lobe jittered in position and
 * size, the whole canopy nudged off-centre to match the trunk's lean.
 * Lobes are kept inside the sprite so nothing clips.
 */
function broadleafSpec(rng: RNG): TreeSpec {
  const lean = Math.round((rng() * 2 - 1) * 3);
  const span = 38 + rng() * 16;
  const top = 11 + rng() * 5;
  const bottom = 30 + rng() * 5;
  const cx = TRUNK_BASE_X + lean + (rng() * 2 - 1) * 2;
  const sizeK = span / 48;
  const rows = [
    { n: 1 + (rng() < 0.4 ? 1 : 0), widthK: 0.35, r: 10 },
    { n: 2 + (rng() < 0.5 ? 1 : 0), widthK: 0.72, r: 11.5 },
    { n: 3 + (rng() < 0.5 ? 1 : 0), widthK: 1, r: 12.5 },
  ];
  const lobes: Lobe[] = [];
  rows.forEach((row, ri) => {
    const y = top + ((bottom - top) * ri) / (rows.length - 1);
    const rowW = span * row.widthK;
    for (let i = 0; i < row.n; i++) {
      const t = row.n === 1 ? 0.5 : i / (row.n - 1);
      const r = (row.r + (rng() * 2 - 1) * 1.8) * Math.min(1.1, Math.max(0.85, sizeK));
      let lx = cx - rowW / 2 + rowW * t + (rng() * 2 - 1) * 3;
      let ly = y + (rng() * 2 - 1) * 2;
      lx = Math.max(r + 1, Math.min(TREE_W - r - 1, lx));
      ly = Math.max(r + 1, ly);
      lobes.push([lx, ly, r]);
    }
  });
  const girth = 3 + rng() * 1.5;
  const nRoots = 2 + Math.floor(rng() * 3);
  const roots: number[] = [];
  for (let i = 0; i < nRoots; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    roots.push(side * (5 + Math.floor(rng() * 7)));
  }
  return { kind: "broadleaf", lobes, lean, girth, roots };
}

/**
 * A conifer: 4–6 stacked tiers of boughs, each wider than the one above,
 * tapering to a pointed tip — a narrow, dark, upright silhouette against
 * the round broadleaf domes. Straighter and slimmer-trunked, with short
 * roots.
 */
function coniferSpec(rng: RNG): TreeSpec {
  const lean = Math.round((rng() * 2 - 1) * 1);
  const tiers = 4 + Math.floor(rng() * 3);
  const tipY = 2 + rng() * 5;
  const foliageBottom = 45 + rng() * 5;
  const maxHalf = 13 + rng() * 5;
  const cx = TRUNK_BASE_X + lean;
  const lobes: Lobe[] = [];
  for (let i = 0; i < tiers; i++) {
    const t = (i + 1) / tiers;
    const bottom = tipY + (foliageBottom - tipY) * t + (rng() * 2 - 1);
    const half = 5 + (maxHalf - 5) * Math.pow(t, 0.8) + (rng() * 2 - 1) * 1.2;
    lobes.push([cx + (rng() * 2 - 1) * 0.8, bottom, half]);
  }
  const girth = 2 + rng() * 0.6;
  const roots = [-(3 + Math.floor(rng() * 3)), 3 + Math.floor(rng() * 3)];
  return { kind: "conifer", lobes, lean, girth, roots };
}

/**
 * Top y of conifer tier `i`. The crown tier rises nearly two tier-spacings
 * to the tip; each tier below starts halfway down the one above, so the
 * tiers overlap like stacked boughs.
 */
function coniferApex(lobes: Lobe[], i: number): number {
  let apex = Math.max(1, lobes[0][1] - 1.8 * (lobes[1][1] - lobes[0][1]));
  for (let j = 1; j <= i; j++) apex += (lobes[j - 1][1] - apex) * 0.5;
  return apex;
}

/** Lowest pixel row the canopy covers — where the visible trunk begins. */
function canopyBottom(spec: TreeSpec): number {
  return spec.kind === "conifer"
    ? Math.max(...spec.lobes.map(([, y]) => y))
    : Math.max(...spec.lobes.map(([, cy, r]) => cy + r));
}

/** How many canopy lobes a tree has — the length a caller's `sway` array should be. */
export function treeLobeCount(spec: TreeSpec): number {
  return spec.lobes.length;
}

/** The fixed look of the berry tree, sharing the trunk/root drawing of regular trees. */
const BERRY_TREE_SPEC: TreeSpec = {
  kind: "broadleaf",
  lobes: [
    [22, 25, 11],
    [34, 20, 12],
    [44, 26, 10],
    [28, 33, 12],
  ],
  lean: -1,
  girth: 3,
  roots: [-5, 4, -3],
};

/** How many canopy lobes `berryCanopyPixmap` has. */
export const BERRY_TREE_LOBE_COUNT = BERRY_TREE_SPEC.lobes.length;

/**
 * Trunk and roots, drawn into `p` (normally before the canopy). The trunk
 * is rasterized row by row: it leans from its base toward `spec.lean` at
 * the top, and its half-width swells quadratically over the bottom third
 * into a root flare, rather than a straight-sided post standing on the
 * grass. Right side is shaded, with a few short bark marks. Roots then
 * snake outward and down into the ground from the flare.
 */
function drawTrunk(p: Pixmap, spec: TreeSpec): void {
  const top = Math.round(canopyBottom(spec) - 8);
  const base = TRUNK_BASE_Y;
  const span = base - top;
  const centreAt = (y: number) => TRUNK_BASE_X + spec.lean * ((base - y) / span);
  const halfAt = (y: number) => {
    const t = (y - top) / span;
    const flare = Math.max(0, (t - 0.65) / 0.35);
    return spec.girth + flare * flare * 4.5;
  };

  for (let y = top; y <= base; y++) {
    const c = centreAt(y);
    const h = halfAt(y);
    const x0 = Math.round(c - h);
    const x1 = Math.round(c + h);
    p.set(x0 - 1, y, C.black);
    p.set(x1 + 1, y, C.black);
    for (let x = x0; x <= x1; x++) {
      p.set(x, y, x >= x1 - Math.max(1, Math.round(h * 0.6)) ? C.trunkDark : C.trunk);
    }
  }
  // bark: short vertical dark strokes, fixed per trunk shape so they don't flicker
  for (let y = top + 4; y < base - 6; y += 5) {
    const c = centreAt(y);
    const bx = Math.round(c - spec.girth * 0.4 + ((y * 7) % 3) - 1);
    p.set(bx, y, C.trunkDark);
    p.set(bx, y + 1, C.trunkDark);
  }
  p.fillRect(Math.round(centreAt(base)) - 6, base + 1, 13, 1, C.black);

  // roots: 2px-thick tendrils that run outward and sink into the ground,
  // thinning to 1px at the tip, outlined top and bottom
  for (const len of spec.roots) {
    const side = Math.sign(len);
    const n = Math.abs(len);
    const sx = Math.round(centreAt(base) + side * (halfAt(base) - 1));
    const sy = base - 4;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = sx + side * i;
      const y = sy + Math.round(Math.sqrt(t) * 4);
      const thick = t < 0.6;
      p.set(x, y - 1, C.black);
      p.set(x, y, thick ? C.trunk : C.trunkDark);
      if (thick) p.set(x, y + 1, C.trunkDark);
      p.set(x, y + (thick ? 2 : 1), C.black);
    }
    p.set(sx + side * (n + 1), sy + 4, C.black);
  }
}

function drawCanopy(p: Pixmap, spec: TreeSpec, sway?: number[]): void {
  if (spec.kind === "conifer") {
    // bottom tier first: each tier's serrated skirt overlaps the top of
    // the wider tier below it, as boughs hang over the ones beneath
    for (let idx = spec.lobes.length - 1; idx >= 0; idx--) {
      const [cx, bottom, half] = spec.lobes[idx];
      coniferTier(p, cx + (sway?.[idx] ?? 0), coniferApex(spec.lobes, idx), bottom, half);
    }
  } else {
    spec.lobes.forEach(([cx, cy, r], idx) => puff(p, cx, cy, r, sway?.[idx] ?? 0));
  }
}

/**
 * One tier of conifer boughs: a slightly convex triangle from `apexY` to
 * `bottomY`, outlined, lit down its left flank (light from the upper left,
 * like the puffs) and shaded on the right, with a serrated lower edge so
 * it reads as bough tips rather than a smooth cone.
 */
function coniferTier(p: Pixmap, cx: number, apexY: number, bottomY: number, half: number): void {
  const top = Math.round(apexY);
  const bottom = Math.round(bottomY);
  const h = Math.max(1, bottom - top);
  let prevX0 = Math.round(cx);
  let prevX1 = Math.round(cx);
  for (let y = top; y <= bottom; y++) {
    const hw = half * Math.pow((y - top) / h, 0.85);
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw);
    // outline spans back to the previous row's edge, so shallow slopes
    // (more than 1px of run per row) stay closed instead of stepping open
    for (let x = x0 - 1; x <= Math.min(prevX0 - 1, x1); x++) p.set(x, y, C.black);
    for (let x = Math.max(prevX1 + 1, x0); x <= x1 + 1; x++) p.set(x, y, C.black);
    const lit = x0 + Math.max(1, Math.round((x1 - x0) * 0.35));
    for (let x = x0; x <= x1; x++) {
      if (y === bottom) {
        p.set(x, y, C.black);
        continue;
      }
      if (x < prevX0 || x > prevX1) continue;
      let c = x <= lit ? C.tree : C.treeDark;
      if (x === prevX0 && y > top + 1) c = C.treeLight;
      // bough gaps: small notches cut up into the serrated lower edge
      if (y === bottom - 1 && (x - x0) % 4 === 1 && x > x0 + 1 && x < x1 - 1) c = C.black;
      p.set(x, y, c);
    }
    prevX0 = x0;
    prevX1 = x1;
  }
  p.set(Math.round(cx), top - 1, C.black);
}

/**
 * Just the canopy of a tree, on a transparent 64×64 sprite, as a cluster
 * of overlapping foliage puffs. `sway`, if given, is one x-offset per lobe
 * (same order as `spec.lobes`) — each ball nudges independently, not the
 * whole tree shifting as one rigid block. Canopies aren't baked into the
 * world chunk: the renderer draws them fresh every frame, so a swayed
 * canopy never leaves its rest pose showing underneath.
 */
export function treeCanopyPixmap(spec: TreeSpec, sway?: number[]): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  drawCanopy(p, spec, sway);
  return p;
}

/** The static part of a tree — leaning, root-flared trunk — that gets baked into the chunk. */
export function treeTrunkPixmap(spec: TreeSpec): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  drawTrunk(p, spec);
  return p;
}

const BERRY_SPOTS: Array<[number, number]> = [
  [20, 20], [32, 16], [44, 21], [24, 28], [40, 28], [30, 34], [18, 26], [46, 26],
];

/** Berry tree canopy only (see `treeCanopyPixmap`). */
export function berryCanopyPixmap(sway?: number[]): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  drawCanopy(p, BERRY_TREE_SPEC, sway);
  for (const [bx, by] of BERRY_SPOTS) {
    p.set(bx, by, C.berry);
    p.set(bx - 1, by, C.berry);
    p.set(bx, by - 1, C.berry);
  }
  return p;
}

/** Berry tree trunk only (see `treeTrunkPixmap`). */
export function berryTrunkPixmap(): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  drawTrunk(p, BERRY_TREE_SPEC);
  return p;
}

/**
 * Ground clutter around a tree's base, drawn into a chunk *after* the tree
 * so it overlaps the root flare: grass tufts (some between the roots), and
 * now and then a mushroom or a couple of pebbles. `cx`/`baseY` are the
 * trunk base in `p`'s coordinates; `scale` matches the tree's draw scale
 * so a big foreground tree gets proportionally bigger tufts.
 */
export function drawTreeBaseClutter(p: Pixmap, cx: number, baseY: number, scale: number, rng: RNG): void {
  const spread = 16 * scale;
  const nTufts = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < nTufts; i++) {
    // most tufts sit off to the sides, among the root tips, so they don't
    // bury the flare; the odd one lands right against the trunk
    const side = i % 2 === 0 ? -1 : 1;
    const off = rng() < 0.2 ? rng() * 4 : 5 + rng() * (16 - 5);
    const tx = Math.round(cx + side * off * scale);
    const ty = Math.round(baseY + rng() * 3 * scale);
    grassTuft(p, tx, ty, scale, rng);
  }
  if (rng() < 0.18) {
    const side = rng() < 0.5 ? -1 : 1;
    mushroom(p, Math.round(cx + side * (6 + rng() * 6) * scale), Math.round(baseY + scale), scale);
  }
  if (rng() < 0.25) {
    const px = Math.round(cx + (rng() * 2 - 1) * spread);
    const py = Math.round(baseY + 2 * scale);
    pebble(p, px, py, scale);
    if (rng() < 0.5) pebble(p, px + Math.round(3 * scale), py + 1, scale * 0.7);
  }
}

/** A small fan of 3–5 grass blades rooted at (x, y), light-tipped. */
function grassTuft(p: Pixmap, x: number, y: number, scale: number, rng: RNG): void {
  const blades = 3 + Math.floor(rng() * 3);
  const bw = Math.max(1, Math.round(scale));
  for (let b = 0; b < blades; b++) {
    const dir = b - (blades - 1) / 2;
    const h = Math.round((4 + rng() * 4) * scale);
    for (let yy = 0; yy < h; yy++) {
      const bx = x + Math.round(dir * bw + (dir * yy) / (3 * scale));
      const tip = h - yy <= Math.max(1, Math.round(scale));
      const c = tip ? C.grassBright : yy >= h / 2 ? C.grassLight : C.grassDark;
      for (let k = 0; k < bw; k++) p.set(bx + k, y - yy, c);
    }
  }
}

/** A tiny red-capped mushroom. */
function mushroom(p: Pixmap, x: number, y: number, scale: number): void {
  const s = Math.max(1, Math.round(scale));
  p.fillRect(x, y - 2 * s, s, 2 * s, C.pathLight);
  p.fillRect(x - s, y - 3 * s, 3 * s, s, C.flowerRed);
  p.fillRect(x - s, y - 3 * s - s, 3 * s, s, C.black);
  p.fillRect(x - 2 * s, y - 3 * s, s, s, C.black);
  p.fillRect(x + 2 * s, y - 3 * s, s, s, C.black);
  p.fillRect(x, y - 3 * s, s, s, C.flowerWhite);
}

/** A small grey stone with a lit top edge. */
function pebble(p: Pixmap, x: number, y: number, scale: number): void {
  const s = Math.max(1, Math.round(scale));
  p.fillRect(x, y - s, 3 * s, 2 * s, C.roadDark);
  p.fillRect(x, y - s, 2 * s, s, C.roadLight);
}

/** A low rounded berry bush: three small puffs plus scattered berry dots. */
export function berryBushPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(32, 32);
  puff(p, 12, 21, 8);
  puff(p, 20, 19, 9);
  puff(p, 16, 25, 8);
  for (let i = 0; i < 5; i++) {
    const bx = 9 + Math.floor(rng() * 14);
    const by = 12 + Math.floor(rng() * 12);
    const col = rng() < 0.5 ? C.berry : C.berryGreen;
    p.set(bx, by, col);
    p.set(bx - 1, by, col);
  }
  return p;
}

/** A horizontal wooden rail fence segment, with an occasional knot mark for variety. */
export function fencePixmap(rng: RNG): Pixmap {
  const p = new Pixmap(32, 32);
  p.fillRect(4, 4, 6, 24, C.woodDark);
  p.fillRect(22, 4, 6, 24, C.woodDark);
  p.fillRect(6, 4, 2, 24, C.wood);
  p.fillRect(24, 4, 2, 24, C.wood);
  p.fillRect(0, 8, 32, 6, C.wood);
  p.fillRect(0, 20, 32, 6, C.wood);
  p.fillRect(0, 8, 32, 2, C.woodDark);
  p.fillRect(0, 20, 32, 2, C.woodDark);
  if (rng() < 0.5) {
    const kx = 2 + Math.floor(rng() * 28);
    const ky = rng() < 0.5 ? 10 : 22;
    p.set(kx, ky, C.woodDark);
  }
  return p;
}

/**
 * A young trainer. `variant` switches outfit colors for variety. Built with
 * the same outlined/rounded technique as the rest of the sprite set (a
 * darker shape behind a slightly smaller colored one — see `puff` above and
 * the building dome) instead of flat unoutlined rectangles, so it doesn't
 * read as a different, cruder art style standing next to the trees.
 */
export function trainerPixmap(variant = 0): Pixmap {
  const schemes = [
    { cap: C.houseRoof, capDark: C.houseRoofDark, shirt: C.houseWall, shirtShade: C.houseWallShade, pants: C.waterDeep },
    { cap: C.water, capDark: C.waterDeep, shirt: C.treeLight, shirtShade: C.tree, pants: C.trunkDark },
    { cap: C.tree, capDark: C.treeDark, shirt: C.flowerRed, shirtShade: C.houseRoofDark, pants: C.waterDeep },
  ];
  const s = schemes[variant % schemes.length];
  const p = new Pixmap(32, 60);

  // head: rounded and outlined, not a flat rectangle
  p.fillEllipse(16, 16, 10, 10, C.black);
  p.fillEllipse(16, 16, 9, 9, C.skin);
  p.fillRect(7, 13, 2, 7, C.skinShade);
  p.fillRect(23, 13, 2, 7, C.skinShade);
  p.set(12, 16, C.black);
  p.set(19, 16, C.black);

  // cap: a rounded dome with a brim, outlined, instead of a boxy rectangle
  p.fillEllipse(16, 8, 11, 9, C.black);
  p.fillEllipse(16, 8, 10, 8, s.capDark);
  p.fillEllipse(16, 7, 9, 7, s.cap);
  p.fillRect(4, 10, 24, 4, C.black);
  p.fillRect(5, 10, 22, 3, s.capDark);

  // neck
  p.fillRect(13, 23, 6, 3, C.skinShade);

  // torso, outlined, with rounded hands at the cuffs
  p.fillRect(6, 25, 20, 17, C.black);
  p.fillRect(7, 26, 18, 15, s.shirt);
  p.fillRect(6, 26, 3, 14, s.shirtShade);
  p.fillRect(23, 26, 3, 14, s.shirtShade);
  p.fillRect(13, 26, 6, 2, s.cap);
  p.fillCircle(6, 40, 2, C.black);
  p.fillCircle(6, 40, 1, C.skin);
  p.fillCircle(26, 40, 2, C.black);
  p.fillCircle(26, 40, 1, C.skin);

  // pants, outlined
  p.fillRect(8, 40, 16, 16, C.black);
  p.fillRect(9, 41, 6, 14, s.pants);
  p.fillRect(17, 41, 6, 14, s.pants);
  p.fillRect(15, 41, 2, 14, C.black);

  // shoes
  p.fillRect(7, 54, 9, 6, C.black);
  p.fillRect(16, 54, 9, 6, C.black);
  p.fillRect(8, 55, 7, 4, C.trunkDark);
  p.fillRect(17, 55, 7, 4, C.trunkDark);

  return p;
}

export const FERN_W = 34;
export const FERN_H = 18;

/**
 * A fern: 5–7 fronds fanning up and out from one root point at the
 * bottom centre, each arching over and drooping at the tip, with
 * leaflets alternating along it — dark near the root, lit at the tips.
 * (Skips the mid `tree` green: it's the same color as open grass, and a
 * fern drawn in it simply disappears into the field.)
 */
export function fernPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(FERN_W, FERN_H);
  const bx = FERN_W / 2;
  const by = FERN_H - 1;
  const fronds = 5 + Math.floor(rng() * 3);
  for (let f = 0; f < fronds; f++) {
    const spread = fronds === 1 ? 0.5 : f / (fronds - 1);
    const angle = Math.PI * (1.08 + spread * 0.84) + (rng() * 2 - 1) * 0.12;
    const len = 10 + rng() * 6 - Math.abs(spread - 0.5) * 4;
    const droop = 0.5 + rng() * 0.3;
    const steps = Math.ceil(len * 1.5);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(bx + Math.cos(angle) * len * t);
      const y = Math.round(by + Math.sin(angle) * len * t + droop * t * t * len * 0.6);
      const c = t < 0.4 ? C.treeDark : t < 0.85 ? C.treeLight : C.grassBright;
      p.set(x, y, c);
      if (s % 2 === 0 && t > 0.2 && t < 0.95) {
        p.set(x, y - 1, c);
        p.set(x + (Math.cos(angle) < 0 ? 1 : -1), y + 1, C.treeDark);
      }
    }
  }
  return p;
}

export const LOG_H = 16;

/**
 * A fallen, mossy log lying across the ground: an outlined bark cylinder
 * (lit top edge, shaded underside) with a cut end showing growth rings on
 * the right, moss clumps along its top and now and then a broken branch
 * stub or a pale bracket fungus. Returns a sprite `w` wide.
 */
export function logPixmap(rng: RNG, w: number): Pixmap {
  const p = new Pixmap(w, LOG_H);
  const x0 = 2;
  const x1 = w - 8;
  const top = 4;
  const bottom = 13;
  p.fillRect(x0, top - 1, x1 - x0, bottom - top + 2, C.black);
  p.fillCircle(x0 + 1, (top + bottom) / 2 + 0.5, (bottom - top) / 2 + 1, C.black);
  p.fillRect(x0, top, x1 - x0, bottom - top, C.trunk);
  p.fillCircle(x0 + 1, (top + bottom) / 2 + 0.5, (bottom - top) / 2, C.trunk);
  p.fillRect(x0, bottom - 3, x1 - x0, 3, C.trunkDark);
  for (let x = x0 + 3; x < x1 - 2; x += 3 + Math.floor(rng() * 4)) {
    p.set(x, top + 2 + Math.floor(rng() * 4), C.trunkDark);
    p.set(x + 1, top + 2 + Math.floor(rng() * 4), C.trunkDark);
  }
  for (let x = x0 + 1; x < x1; x++) if (rng() < 0.4) p.set(x, top, C.pathEdge);

  // cut end with rings
  const ex = x1 + 1;
  const ey = (top + bottom) / 2 + 0.5;
  p.fillEllipse(ex, ey, 5, 6, C.black);
  p.fillEllipse(ex, ey, 4, 5, C.pathDark);
  p.fillEllipse(ex, ey, 2.6, 3.4, C.pathEdge);
  p.fillEllipse(ex, ey, 1.6, 2.2, C.pathDark);
  p.set(Math.round(ex), Math.round(ey), C.pathLight);

  // moss along the top
  for (let x = x0 + 2; x < x1 - 2; x += 2 + Math.floor(rng() * 5)) {
    const mw = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < mw && x + i < x1; i++) {
      p.set(x + i, top - 1, C.treeDark);
      p.set(x + i, top, i === 0 || i === mw - 1 ? C.tree : C.treeLight);
    }
    p.set(x + 1, top - 2, C.treeDark);
  }

  if (rng() < 0.5) {
    const sx = x0 + 6 + Math.floor(rng() * Math.max(1, x1 - x0 - 14));
    p.fillRect(sx, top - 4, 3, 4, C.black);
    p.fillRect(sx + 1, top - 3, 1, 3, C.trunk);
  }
  if (rng() < 0.35) {
    const fx = x0 + 4 + Math.floor(rng() * Math.max(1, x1 - x0 - 10));
    p.fillRect(fx - 1, bottom - 5, 6, 2, C.black);
    p.fillRect(fx, bottom - 5, 4, 1, C.wallTan);
  }
  return p;
}

export const REEDS_W = 18;
export const REEDS_H = 24;

/**
 * A clump of reeds standing in the shallows: 5–8 tall, slightly leaning
 * blades with lit tips, a couple of cattails on taller stems, and a short
 * ripple line where they meet the water.
 */
export function reedsPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(REEDS_W, REEDS_H);
  const base = REEDS_H - 3;
  const blades = 5 + Math.floor(rng() * 4);
  for (let b = 0; b < blades; b++) {
    const x = 3 + Math.floor(rng() * (REEDS_W - 6));
    const h = 8 + Math.floor(rng() * 11);
    const lean = (rng() * 2 - 1) * 0.25;
    for (let yy = 0; yy < h; yy++) {
      const c = yy > h - 3 ? C.grassBright : yy > h / 2 ? C.grassLight : C.treeDark;
      p.set(Math.round(x + lean * yy), base - yy, c);
    }
  }
  const cattails = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < cattails; i++) {
    const x = 4 + Math.floor(rng() * (REEDS_W - 8));
    const h = 15 + Math.floor(rng() * 5);
    for (let yy = 0; yy < h; yy++) p.set(x, base - yy, yy < h / 2 ? C.treeDark : C.grassLight);
    // a plump brown head with a lit left side, and a short spike above
    p.fillRect(x - 1, base - h - 6, 4, 8, C.black);
    p.fillRect(x, base - h - 5, 2, 6, C.trunk);
    p.fillRect(x, base - h - 5, 1, 6, C.pathEdge);
    p.set(x, base - h - 7, C.grassLight);
    p.set(x, base - h - 8, C.grassLight);
  }
  for (let x = 1; x < REEDS_W - 1; x++) {
    if (x % 3 !== 0) p.set(x, base + 1, C.waterBright);
  }
  return p;
}

/**
 * A lily pad floating at (cx, cy) in `p`: a flat outlined ellipse with a
 * notch cut out (refilled with `water`), a lit upper-left edge, and now
 * and then a white flower.
 */
export function drawLilyPad(p: Pixmap, cx: number, cy: number, rng: RNG, water: number): void {
  const rx = 3.5 + rng() * 2.5;
  const ry = rx * 0.42;
  p.fillEllipse(cx, cy, rx + 1, ry + 1, C.treeDark);
  p.fillEllipse(cx, cy, rx, ry, C.tree);
  p.fillEllipse(cx - rx * 0.35, cy - ry * 0.3, rx * 0.4, ry * 0.4, C.treeLight);
  const side = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < Math.round(rx); i++) p.set(Math.round(cx + side * i), Math.round(cy - i * 0.3), water);
  if (rng() < 0.3) {
    const fx = Math.round(cx - side * rx * 0.3);
    const fy = Math.round(cy - 1);
    p.set(fx, fy - 1, C.flowerWhite);
    p.set(fx - 1, fy, C.flowerWhite);
    p.set(fx + 1, fy, C.flowerWhite);
    p.set(fx, fy, C.flowerYellow);
  }
}
