import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import type { RNG } from "../core/prng";

export const TREE_W = 64;
export const TREE_H = 64;

/**
 * Rounded Gen-3 style tree with directional canopy shading, a crisp dark
 * outline, and a short trunk. `variant` changes the silhouette for variety.
 */
export function treePixmap(variant = 0): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  const cx = 32;
  const cy = variant === 2 ? 25 : 26;
  const rx = variant === 1 ? 28 : variant === 2 ? 24 : 26;
  const ry = variant === 1 ? 22 : variant === 2 ? 26 : 24;
  for (let y = 0; y < TREE_H; y++) {
    for (let x = 0; x < TREE_W; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const d = Math.sqrt(d2);
      const l = (-dx - dy) / Math.SQRT2;
      let c;
      if (d > 0.94) c = C.black;
      else if (d > 0.87) c = C.treeDark;
      else if (l > 0.5) c = C.treeBright;
      else if (l > 0.1) c = C.treeLight;
      else if (l > -0.45) c = C.tree;
      else c = C.treeDark;
      p.set(x, y, c);
    }
  }
  p.fillRect(28, 44, 8, 18, C.black);
  p.fillRect(30, 44, 4, 16, C.trunk);
  p.set(30, 44, C.trunkDark);
  return p;
}

/** A small tree bearing red berries. */
export function berryTreePixmap(): Pixmap {
  const p = new Pixmap(TREE_W, TREE_H);
  const cx = 32;
  const cy = 28;
  const r = 20;
  for (let y = 0; y < TREE_H; y++) {
    for (let x = 0; x < TREE_W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      const d = Math.sqrt(d2);
      const l = (-dx - dy) / Math.SQRT2;
      let c;
      if (d > r - 0.8) c = C.black;
      else if (d > r - 2.4) c = C.treeDark;
      else if (l > 0.35) c = C.treeLight;
      else if (l > -0.3) c = C.tree;
      else c = C.treeDark;
      p.set(x, y, c);
    }
  }
  const spots: Array<[number, number]> = [
    [20, 20], [32, 16], [44, 21], [24, 28], [40, 28], [30, 34], [18, 26], [46, 26],
  ];
  for (const [bx, by] of spots) {
    p.set(bx, by, C.berry);
    p.set(bx - 1, by, C.berry);
    p.set(bx, by - 1, C.berry);
  }
  p.fillRect(28, 44, 8, 18, C.black);
  p.fillRect(30, 44, 4, 16, C.trunk);
  return p;
}

/** A low rounded berry bush. */
export function berryBushPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(32, 32);
  p.fillCircle(16, 20, 11, C.black);
  p.fillCircle(16, 20, 10, C.treeDark);
  p.fillCircle(16, 19, 9, C.tree);
  p.fillCircle(13, 16, 5, C.treeLight);
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

/** A horizontal wooden rail fence segment. */
export function fencePixmap(_rng: RNG): Pixmap {
  const p = new Pixmap(32, 32);
  p.fillRect(4, 4, 6, 24, C.woodDark);
  p.fillRect(22, 4, 6, 24, C.woodDark);
  p.fillRect(6, 4, 2, 24, C.wood);
  p.fillRect(24, 4, 2, 24, C.wood);
  p.fillRect(0, 8, 32, 6, C.wood);
  p.fillRect(0, 20, 32, 6, C.wood);
  p.fillRect(0, 8, 32, 2, C.woodDark);
  p.fillRect(0, 20, 32, 2, C.woodDark);
  return p;
}

/** A young trainer. `variant` switches outfit colors for variety. */
export function trainerPixmap(variant = 0): Pixmap {
  const schemes = [
    { cap: C.houseRoof, capDark: C.houseRoofDark, shirt: C.houseWall, shirtShade: C.houseWallShade, pants: C.waterDeep },
    { cap: C.water, capDark: C.waterDeep, shirt: C.treeLight, shirtShade: C.tree, pants: C.trunkDark },
    { cap: C.tree, capDark: C.treeDark, shirt: C.flowerRed, shirtShade: C.houseRoofDark, pants: C.waterDeep },
  ];
  const s = schemes[variant % schemes.length];
  const p = new Pixmap(32, 60);
  // cap
  p.fillRect(6, 0, 20, 8, s.capDark);
  p.fillRect(7, 1, 18, 7, s.cap);
  p.fillRect(5, 8, 22, 3, s.capDark);
  p.fillRect(6, 9, 20, 2, s.cap);
  // face
  p.fillRect(8, 11, 16, 12, C.skin);
  p.fillRect(7, 13, 2, 8, C.skinShade);
  p.fillRect(23, 13, 2, 8, C.skinShade);
  p.set(12, 16, C.black);
  p.set(19, 16, C.black);
  // neck
  p.fillRect(13, 23, 6, 3, C.skinShade);
  // torso
  p.fillRect(7, 26, 18, 15, s.shirt);
  p.fillRect(6, 26, 3, 14, s.shirtShade);
  p.fillRect(23, 26, 3, 14, s.shirtShade);
  p.set(6, 39, C.skin);
  p.set(25, 39, C.skin);
  p.fillRect(13, 26, 6, 2, s.cap);
  // pants
  p.fillRect(9, 41, 6, 14, s.pants);
  p.fillRect(17, 41, 6, 14, s.pants);
  p.fillRect(15, 41, 2, 14, C.black);
  // shoes
  p.fillRect(8, 55, 8, 5, C.trunkDark);
  p.fillRect(16, 55, 8, 5, C.trunkDark);
  return p;
}

export const BUILDING_W = 96;
export const BUILDING_H = 72;

/**
 * A city building: gabled roof, wall with windows and a door, optional sign.
 * `type`: 0 = house, 1 = Poké Center, 2 = Poké Mart.
 */
export function buildingPixmap(type = 0): Pixmap {
  const styles = [
    { roof: C.roadDark, roofDark: C.houseRoofDark, wall: C.houseWall, wallShade: C.houseWallShade, sign: null as number | null },
    { roof: C.houseRoof, roofDark: C.houseRoofDark, wall: C.houseWall, wallShade: C.houseWallShade, sign: C.houseRoof },
    { roof: C.water, roofDark: C.waterDeep, wall: C.houseWall, wallShade: C.houseWallShade, sign: C.water },
  ];
  const s = styles[type % styles.length];
  const p = new Pixmap(BUILDING_W, BUILDING_H);
  const cx = 48;
  const roofApexY = 3;
  const roofBaseY = 30;
  const roofHalf = 44;

  // roof (outline + fill + left shade)
  p.fillTriangle(cx, roofApexY - 1, cx - roofHalf - 2, roofBaseY + 2, cx + roofHalf + 2, roofBaseY + 2, s.roofDark);
  p.fillTriangle(cx, roofApexY, cx - roofHalf, roofBaseY, cx + roofHalf, roofBaseY, s.roof);
  p.fillTriangle(cx, roofApexY, cx - roofHalf, roofBaseY, cx - roofHalf * 0.2, roofBaseY, s.roofDark);
  p.fillRect(cx - 1, roofApexY, 2, roofBaseY - roofApexY, s.roofDark);
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

  // windows (two)
  for (const wx of [20, 66]) {
    p.fillRect(wx - 1, 40, 10, 10, s.roofDark);
    p.fillRect(wx, 41, 8, 8, C.houseWindow);
    p.fillRect(wx + 3, 41, 2, 8, s.wall);
    p.fillRect(wx, 44, 8, 2, s.wall);
  }

  return p;
}

/** A tall streetlamp with a glowing head. */
export function streetlampPixmap(_rng: RNG): Pixmap {
  const p = new Pixmap(24, 56);
  p.fillRect(6, 8, 12, 9, C.woodDark);
  p.fillRect(7, 9, 10, 7, C.flowerYellow);
  p.fillRect(8, 10, 8, 5, C.houseTrim);
  p.fillRect(4, 17, 16, 3, C.woodDark);
  p.fillRect(10, 20, 4, 33, C.woodDark);
  p.fillRect(11, 20, 2, 33, C.wood);
  p.fillRect(7, 52, 10, 4, C.woodDark);
  return p;
}

/** A wooden park bench. */
export function benchPixmap(_rng: RNG): Pixmap {
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
