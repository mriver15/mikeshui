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
function puff(p: Pixmap, cx: number, cy: number, r: number): void {
  p.fillCircle(cx, cy, r, C.black);
  p.fillCircle(cx, cy, r - 1.2, C.treeDark);
  p.fillCircle(cx - 0.5, cy - 0.5, r - 2.6, C.tree);
  p.fillCircle(cx - r * 0.32, cy - r * 0.38, r * 0.42, C.treeLight);
  p.fillCircle(cx - r * 0.4, cy - r * 0.46, r * 0.16, C.treeBright);
}

const TREE_LAYOUTS: number[][][] = [
  // balanced dome
  [
    [32, 15, 11],
    [17, 22, 12], [32, 18, 13], [47, 22, 12],
    [14, 32, 13], [32, 30, 14], [50, 32, 13],
  ],
  // wide / flat
  [
    [32, 16, 10],
    [15, 23, 12], [32, 19, 12], [49, 23, 12],
    [10, 33, 13], [24, 32, 14], [40, 32, 14], [54, 33, 13],
  ],
  // tall / narrow
  [
    [32, 11, 10],
    [19, 19, 11], [32, 15, 12], [45, 19, 11],
    [17, 29, 12], [32, 27, 13], [47, 29, 12],
  ],
];

/**
 * A short trunk tucked under the canopy. Takes the lowest point of the
 * canopy puffs so it always reaches up far enough to overlap them — a fixed
 * trunk position left visible gaps under the taller/narrower layouts.
 */
function drawTrunk(p: Pixmap, lowestCanopyBottom: number): void {
  const top = Math.min(44, Math.round(lowestCanopyBottom - 5));
  const bottom = 62;
  p.fillRect(28, top, 8, bottom - top, C.black);
  p.fillRect(30, top, 4, bottom - top - 2, C.trunk);
  p.set(30, top, C.trunkDark);
}

/**
 * Gen-3 style tree: a cluster of overlapping foliage puffs over a short
 * trunk. `variant` picks a different lobe layout for silhouette variety.
 */
export function treePixmap(variant = 0): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  const layout = TREE_LAYOUTS[variant % TREE_LAYOUTS.length];
  for (const [cx, cy, r] of layout) puff(p, cx, cy, r);
  const lowestBottom = Math.max(...layout.map(([, cy, r]) => cy + r));
  drawTrunk(p, lowestBottom);
  return p;
}

/** A small tree bearing red berries, built from the same puff clusters as treePixmap. */
export function berryTreePixmap(): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  const puffs: Array<[number, number, number]> = [
    [22, 25, 11],
    [34, 20, 12],
    [44, 26, 10],
    [28, 33, 12],
  ];
  for (const [cx, cy, r] of puffs) puff(p, cx, cy, r);
  const spots: Array<[number, number]> = [
    [20, 20], [32, 16], [44, 21], [24, 28], [40, 28], [30, 34], [18, 26], [46, 26],
  ];
  for (const [bx, by] of spots) {
    p.set(bx, by, C.berry);
    p.set(bx - 1, by, C.berry);
    p.set(bx, by - 1, C.berry);
  }
  const lowestBottom = Math.max(...puffs.map(([, cy, r]) => cy + r));
  drawTrunk(p, lowestBottom);
  return p;
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

/** A puffy flat-bottomed cloud with a soft under-shadow. */
export function cloudPixmap(rng: RNG): Pixmap {
  const w = 80 + Math.floor(rng() * 40);
  const h = 30 + Math.floor(rng() * 16);
  const p = new Pixmap(w, h);
  const cy = Math.floor(h * 0.5);
  const blobs: Array<[number, number, number]> = [];
  let x = 12;
  while (x < w - 8) {
    const r = 10 + Math.floor(rng() * 8);
    blobs.push([x, cy, r]);
    x += Math.max(8, r - 2);
  }
  for (const [bx, by, br] of blobs) p.fillCircle(bx, by + 4, br, C.cloudShade);
  for (const [bx, by, br] of blobs) p.fillCircle(bx, by, br, C.cloud);
  for (let i = 0; i < w; i++) p.set(i, cy + 8, C.cloudShade);
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

export const BUILDING_W = 96;
export const BUILDING_H = 72;

interface HouseStyle {
  roof: number;
  roofDark: number;
  roofLight: number;
  wall: number;
  wallShade: number;
}

/**
 * House color palettes, each sampled from a different real Gen-3 building
 * style (the red-tile suburban house, an orange wood cabin, a mossy green
 * roof, a cool gray-slate building) so procedurally-varied houses still
 * look like they belong to the same game instead of random hue-shifts.
 */
const HOUSE_STYLES: HouseStyle[] = [
  { roof: C.houseRoof, roofDark: C.houseRoofDark, roofLight: C.houseRoofLight, wall: C.houseWall, wallShade: C.houseWallShade },
  { roof: C.roofOrange, roofDark: C.roofOrangeDark, roofLight: C.roofOrangeLight, wall: C.wallTan, wallShade: C.wallTanShade },
  { roof: C.roofGreen, roofDark: C.roofGreenDark, roofLight: C.treeLight, wall: C.houseWall, wallShade: C.houseWallShade },
  { roof: C.houseWallShade, roofDark: C.trunkDark, roofLight: C.houseWall, wall: C.wallTan, wallShade: C.wallTanShade },
];

/**
 * A city building: gabled roof, wall with windows and a door, optional sign.
 * `type`: 0 = house, 1 = Poké Center, 2 = Poké Mart. Houses (type 0) are
 * procedurally varied from `rng` — color style, window count, and whether
 * there's a chimney or a flower box — so a street of them doesn't read as
 * the same building copy-pasted; Center/Mart keep a fixed, recognizable
 * look since their color is also their in-game signage.
 */
export function buildingPixmap(type = 0, rng?: RNG): Pixmap {
  const houseStyle = HOUSE_STYLES[type === 0 && rng ? Math.floor(rng() * HOUSE_STYLES.length) : 0];
  const styles = [
    { ...houseStyle, sign: null as number | null, dome: false },
    { roof: C.houseRoof, roofDark: C.houseRoofDark, roofLight: C.houseRoofLight, wall: C.houseWall, wallShade: C.houseWallShade, sign: C.houseRoof as number | null, dome: true },
    { roof: C.water, roofDark: C.waterDeep, roofLight: C.waterLight, wall: C.houseWall, wallShade: C.houseWallShade, sign: C.water as number | null, dome: true },
  ];
  const s = styles[type % styles.length];
  const p = new Pixmap(BUILDING_W, BUILDING_H);
  const cx = 48;
  const roofBaseY = 30;
  const checkerRoof = type !== 0 || !rng || rng() > 0.3;
  const chimney = type === 0 && rng && rng() < 0.35;
  const flowerBox = type === 0 && rng && rng() < 0.4;
  const twoWindows = type !== 0 || !rng || rng() < 0.7;

  if (s.dome) {
    // Poke Center / Mart: a rounded dome roof (an outlined ellipse, clipped
    // to its top arc by the opaque wall drawn below) with a pokeball
    // emblem — Gen-3 service buildings use an arched roof, not a gable.
    const domeRx = 46;
    const domeRy = 27;
    p.fillEllipse(cx, roofBaseY, domeRx + 2, domeRy + 2, s.roofDark);
    p.fillEllipse(cx, roofBaseY, domeRx, domeRy, s.roof);
    p.fillEllipse(cx, roofBaseY - 5, domeRx * 0.6, domeRy * 0.55, s.roofLight);
    const ex = cx;
    const ey = roofBaseY - 10;
    p.fillCircle(ex, ey, 9, C.black);
    p.fillCircle(ex, ey, 8, C.houseTrim);
    p.fillRect(ex - 8, ey - 1, 16, 2, C.black);
    p.fillCircle(ex, ey, 3, C.black);
    p.fillCircle(ex, ey, 2, C.houseTrim);
  } else {
    // house: a triangular gable, optionally with a diamond-checker shingle
    // texture (two alternating roof shades in a brick-offset grid, per-row
    // offset so it reads as diamonds rather than a plain grid).
    const roofApexY = 3;
    const roofHalf = 44;
    p.fillTriangle(cx, roofApexY - 1, cx - roofHalf - 2, roofBaseY + 2, cx + roofHalf + 2, roofBaseY + 2, s.roofDark);
    if (checkerRoof) {
      for (let y = roofApexY; y < roofBaseY; y++) {
        const t = (y - roofApexY) / (roofBaseY - roofApexY);
        const halfW = roofHalf * t;
        const rowOffset = y % 4 < 2 ? 0 : 2;
        for (let x = Math.ceil(cx - halfW); x <= Math.floor(cx + halfW); x++) {
          const block = Math.floor((x + rowOffset) / 4);
          p.set(x, y, block % 2 === 0 ? s.roof : s.roofLight);
        }
      }
    } else {
      p.fillTriangle(cx, roofApexY, cx - roofHalf, roofBaseY, cx + roofHalf, roofBaseY, s.roof);
    }
    p.fillTriangle(cx, roofApexY, cx - roofHalf, roofBaseY, cx - roofHalf * 0.2, roofBaseY, s.roofDark);
    p.fillRect(cx - 1, roofApexY, 2, roofBaseY - roofApexY, s.roofDark);

    if (chimney) {
      const dx = 22;
      const t = dx / roofHalf;
      const roofY = Math.round(roofApexY + t * (roofBaseY - roofApexY));
      p.fillRect(cx - dx - 3, roofY - 12, 7, 15, s.roofDark);
      p.fillRect(cx - dx - 2, roofY - 11, 5, 12, C.wood);
      p.fillRect(cx - dx - 3, roofY - 13, 8, 3, C.woodDark);
    }
  }
  p.fillRect(6, roofBaseY - 1, 84, 2, s.roofDark);

  // body
  const bx0 = 14;
  const bx1 = 82;
  const by0 = 30;
  const by1 = 70;
  p.fillRect(bx0 - 1, by0 - 1, bx1 - bx0 + 2, by1 - by0 + 2, s.roofDark);
  p.fillRect(bx0, by0, bx1 - bx0, by1 - by0, s.wall);
  p.fillRect(bx1 - 10, by0, 10, by1 - by0, s.wallShade);
  p.fillRect(bx0, by1 - 3, bx1 - bx0, 3, s.wallShade);

  // sign (for Center / Mart)
  if (s.sign !== null) {
    p.fillRect(37, 34, 22, 11, s.roofDark);
    p.fillRect(39, 36, 18, 7, s.sign);
  }

  // door
  p.fillRect(43, by1 - 20, 10, 20, s.roofDark);
  p.fillRect(44, by1 - 19, 8, 19, C.trunk);
  p.set(50, by1 - 9, C.houseTrim);

  // windows
  const windowXs = twoWindows ? [20, 66] : [20];
  for (const wx of windowXs) {
    p.fillRect(wx - 1, 40, 10, 10, s.roofDark);
    p.fillRect(wx, 41, 8, 8, C.houseWindow);
    p.fillRect(wx + 3, 41, 2, 8, s.wall);
    p.fillRect(wx, 44, 8, 2, s.wall);
  }

  // flower box beneath the first window
  if (flowerBox) {
    const fx = windowXs[0];
    p.fillRect(fx - 2, 51, 12, 4, C.woodDark);
    p.fillRect(fx - 1, 50, 10, 3, C.wood);
    const petals = [C.flowerRed, C.flowerYellow, C.flowerWhite];
    for (let i = 0; i < 4; i++) {
      p.set(fx + i * 2, 49, petals[i % petals.length]);
    }
  }

  return p;
}

/** A tall streetlamp with a glowing head — warm or cool glow for variety. */
export function streetlampPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(24, 56);
  const glow = rng() < 0.6 ? C.flowerYellow : C.houseWindow;
  p.fillRect(6, 8, 12, 9, C.woodDark);
  p.fillRect(7, 9, 10, 7, glow);
  p.fillRect(8, 10, 8, 5, C.houseTrim);
  p.fillRect(4, 17, 16, 3, C.woodDark);
  p.fillRect(10, 20, 4, 33, C.woodDark);
  p.fillRect(11, 20, 2, 33, C.wood);
  p.fillRect(7, 52, 10, 4, C.woodDark);
  return p;
}

/** A wooden park bench, with an occasional worn plank mark for variety. */
export function benchPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(40, 20);
  p.fillRect(2, 2, 36, 2, C.wood);
  p.fillRect(2, 2, 36, 1, C.woodDark);
  p.fillRect(2, 2, 4, 10, C.wood);
  p.fillRect(34, 2, 4, 10, C.wood);
  p.fillRect(3, 2, 2, 10, C.woodDark);
  p.fillRect(35, 2, 2, 10, C.woodDark);
  p.fillRect(2, 10, 36, 4, C.wood);
  p.fillRect(2, 10, 36, 1, C.woodDark);
  p.fillRect(6, 14, 4, 6, C.woodDark);
  p.fillRect(30, 14, 4, 6, C.woodDark);
  if (rng() < 0.4) {
    const kx = 4 + Math.floor(rng() * 32);
    p.set(kx, 3, C.woodDark);
  }
  return p;
}

/** A low hedge flower bed. */
export function flowerBedPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(32, 14);
  p.fillRect(0, 7, 32, 7, C.treeDark);
  p.fillRect(1, 6, 30, 7, C.tree);
  p.fillRect(1, 6, 30, 2, C.treeLight);
  for (let i = 0; i < 5; i++) {
    const fx = 2 + Math.floor(rng() * 27);
    p.set(fx, 5, rng() < 0.5 ? C.flowerRed : C.flowerYellow);
    p.set(fx + 1, 5, C.flowerWhite);
  }
  return p;
}
