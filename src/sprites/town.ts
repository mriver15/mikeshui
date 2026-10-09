import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import type { RNG } from "../core/prng";
import { puff } from "./objects";

/**
 * Town sprites: buildings and the street furniture around them. Sized
 * against the trees (a house stands roughly 1.5× a tree's height, as in
 * Gen-3 towns) and built with the same outlined, top-left-lit technique
 * as the rest of the sprite set.
 */

export type BuildingKind = "house" | "bighouse" | "center" | "mart";

/** A building sprite plus where its front door is, for laying a walkway to it. */
export interface BuildingSprite {
  pixmap: Pixmap;
  /** Door centre x, in sprite space. */
  doorX: number;
}

/** Sprite width per building kind — what a lot needs to fit it. */
export const BUILDING_SIZE: Record<BuildingKind, { w: number; h: number }> = {
  house: { w: 104, h: 84 },
  bighouse: { w: 120, h: 104 },
  center: { w: 128, h: 92 },
  mart: { w: 112, h: 84 },
};

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
 * A building of the given kind. Houses (one- and two-storey) are varied
 * from `rng` — palette, door position, window layout, chimney, flower
 * box — so a street of them doesn't read as one building copy-pasted; the
 * Poké Center and Mart keep their fixed, recognizable looks since their
 * colors are their signage.
 */
export function buildingPixmap(kind: BuildingKind, rng: RNG): BuildingSprite {
  if (kind === "center") return centerPixmap();
  if (kind === "mart") return martPixmap();
  return housePixmap(kind === "bighouse", rng);
}

const WALL_INSET = 8;
const FOOT_H = 5;

/**
 * Wall box from `top` down to the foundation: outlined, a band of shadow
 * under the eaves, a shaded right-hand side, then a stone foundation the
 * building actually sits on.
 */
function drawWalls(p: Pixmap, top: number, s: HouseStyle): void {
  const l = WALL_INSET;
  const r = p.w - WALL_INSET;
  const foot = p.h - FOOT_H;
  p.fillRect(l - 1, top, r - l + 2, foot - top, s.roofDark);
  p.fillRect(l, top + 1, r - l, foot - top - 1, s.wall);
  p.fillRect(l, top + 1, r - l, 3, s.wallShade);
  p.fillRect(r - 9, top + 1, 9, foot - top - 1, s.wallShade);
  p.fillRect(l - 2, foot, r - l + 4, FOOT_H, C.black);
  p.fillRect(l - 1, foot + 1, r - l + 2, FOOT_H - 2, C.roadDark);
  p.fillRect(l - 1, foot + 1, r - l + 2, 1, C.roadLight);
  for (let x = l + 3; x < r - 2; x += 8) p.set(x, foot + 2, C.road);
}

/** A panelled front door with a frame and knob, plus a pale stone step in front. */
function drawDoor(p: Pixmap, cx: number, s: HouseStyle, w = 12, h = 22): void {
  const foot = p.h - FOOT_H;
  const x = Math.round(cx - w / 2);
  p.fillRect(x - 1, foot - h - 1, w + 2, h + 1, s.roofDark);
  p.fillRect(x, foot - h, w, h, C.trunk);
  p.fillRect(x + 2, foot - h + 2, w / 2 - 3, h / 2 - 3, C.trunkDark);
  p.fillRect(x + w / 2 + 1, foot - h + 2, w / 2 - 3, h / 2 - 3, C.trunkDark);
  p.set(x + w - 3, foot - h / 2, C.houseTrim);
  p.fillRect(x - 4, foot, w + 8, 3, C.black);
  p.fillRect(x - 3, foot, w + 6, 2, C.roadLight);
}

/** A four-pane window with a frame, a sill and a glint in the top-left pane. */
function drawWindow(p: Pixmap, x: number, y: number, s: HouseStyle, w = 12, h = 12): void {
  p.fillRect(x - 1, y - 1, w + 2, h + 2, s.roofDark);
  p.fillRect(x, y, w, h, C.houseWindow);
  p.fillRect(x + w / 2 - 1, y, 2, h, s.wall);
  p.fillRect(x, y + h / 2 - 1, w, 2, s.wall);
  p.set(x + 1, y + 1, C.houseTrim);
  p.set(x + 2, y + 1, C.houseTrim);
  p.fillRect(x - 2, y + h + 1, w + 4, 2, s.wallShade);
}

/**
 * Window x positions across the wall, evenly spread but keeping clear of
 * the door — the door may sit off-centre, so windows fill whichever side
 * has room rather than mirroring a fixed layout.
 */
function windowSlots(wallL: number, wallR: number, doorX: number, ww: number): number[] {
  const slots: number[] = [];
  for (let x = wallL + 8; x + ww <= wallR - 12; x += ww + 14) {
    if (x + ww > doorX - 12 && x < doorX + 12) continue;
    slots.push(x);
  }
  return slots;
}

function housePixmap(big: boolean, rng: RNG): BuildingSprite {
  const { w, h } = BUILDING_SIZE[big ? "bighouse" : "house"];
  const s = HOUSE_STYLES[Math.floor(rng() * HOUSE_STYLES.length)];
  const p = new Pixmap(w, h);
  const cx = w / 2;
  const roofBase = big ? 38 : 34;
  const apexY = 2;
  const checker = rng() > 0.3;
  const chimney = rng() < 0.4;
  const flowerBox = rng() < 0.45;

  // chimney first, so the roof slope overlaps its base
  if (chimney) {
    const chx = Math.round(cx + (rng() < 0.5 ? -1 : 1) * w * 0.22);
    p.fillRect(chx - 4, 4, 9, roofBase - 8, C.black);
    p.fillRect(chx - 3, 5, 7, roofBase - 9, C.wood);
    p.fillRect(chx - 5, 2, 11, 4, C.black);
    p.fillRect(chx - 4, 3, 9, 2, C.woodDark);
  }

  // gable roof with a few px of overhang past the walls, optional
  // diamond-checker shingles, a shaded left face and a ridge line
  const roofHalf = cx - 1;
  p.fillTriangle(cx, apexY - 1, 0, roofBase + 2, w - 1, roofBase + 2, s.roofDark);
  if (checker) {
    for (let y = apexY; y < roofBase; y++) {
      const halfW = (roofHalf - 2) * ((y - apexY) / (roofBase - apexY));
      const rowOffset = y % 4 < 2 ? 0 : 2;
      for (let x = Math.ceil(cx - halfW); x <= Math.floor(cx + halfW); x++) {
        p.set(x, y, Math.floor((x + rowOffset) / 4) % 2 === 0 ? s.roof : s.roofLight);
      }
    }
  } else {
    p.fillTriangle(cx, apexY, 2, roofBase, w - 3, roofBase, s.roof);
  }
  p.fillTriangle(cx, apexY, 2, roofBase, cx - roofHalf * 0.25, roofBase, s.roofDark);
  p.fillRect(Math.round(cx) - 1, apexY, 2, roofBase - apexY, s.roofDark);
  p.fillRect(0, roofBase, w, 2, s.roofDark);

  drawWalls(p, roofBase + 1, s);
  if (big) p.fillRect(WALL_INSET, roofBase + 30, w - 2 * WALL_INSET, 2, s.wallShade);

  const doorX = Math.round(cx + (rng() * 2 - 1) * w * 0.18);
  drawDoor(p, doorX, s);
  const ww = 12;
  const rows = big ? [roofBase + 10, roofBase + 38] : [roofBase + 12];
  rows.forEach((y, ri) => {
    // the upper storey isn't interrupted by the door, so it gets a full row
    const slots = ri === 0 && big ? windowSlots(WALL_INSET, w - WALL_INSET, -100, ww) : windowSlots(WALL_INSET, w - WALL_INSET, doorX, ww);
    for (const x of slots) drawWindow(p, x, y, s);
  });

  if (flowerBox) {
    const lower = rows[rows.length - 1];
    const slots = windowSlots(WALL_INSET, w - WALL_INSET, doorX, ww);
    const fx = slots[0] ?? WALL_INSET + 8;
    p.fillRect(fx - 2, lower + 14, ww + 4, 4, C.woodDark);
    p.fillRect(fx - 1, lower + 14, ww + 2, 2, C.wood);
    const petals = [C.flowerRed, C.flowerYellow, C.flowerWhite];
    for (let i = 0; i < 6; i++) p.set(fx + i * 2, lower + 13, petals[i % petals.length]);
  }
  return { pixmap: p, doorX };
}

/** Poké Center: an outlined red dome with a pokeball emblem over a wide glass-doored front. */
function centerPixmap(): BuildingSprite {
  const { w, h } = BUILDING_SIZE.center;
  const s: HouseStyle = { roof: C.houseRoof, roofDark: C.houseRoofDark, roofLight: C.houseRoofLight, wall: C.houseWall, wallShade: C.houseWallShade };
  const p = new Pixmap(w, h);
  const cx = w / 2;
  const roofBase = 40;
  p.fillEllipse(cx, roofBase, cx - 1, 38, s.roofDark);
  p.fillEllipse(cx, roofBase, cx - 3, 36, s.roof);
  p.fillEllipse(cx - 6, roofBase - 12, cx * 0.55, 16, s.roofLight);
  const ey = roofBase - 18;
  p.fillCircle(cx, ey, 11, C.black);
  p.fillCircle(cx, ey, 10, C.houseTrim);
  p.fillRect(cx - 10, ey - 1, 20, 2, C.black);
  p.fillCircle(cx, ey, 4, C.black);
  p.fillCircle(cx, ey, 3, C.houseTrim);
  drawWalls(p, roofBase, s);
  // sign band over the doors
  p.fillRect(cx - 18, roofBase + 6, 36, 10, s.roofDark);
  p.fillRect(cx - 17, roofBase + 7, 34, 8, s.roof);
  p.fillRect(cx - 2, roofBase + 8, 4, 6, C.houseTrim);
  p.fillRect(cx - 4, roofBase + 10, 8, 2, C.houseTrim);
  drawGlassDoors(p, cx, s);
  for (const x of [WALL_INSET + 8, WALL_INSET + 28, w - WALL_INSET - 44, w - WALL_INSET - 24]) drawWindow(p, x, roofBase + 18, s);
  return { pixmap: p, doorX: cx };
}

/** Poké Mart: a flat blue roof with a stripe, a blue sign band and wide shop windows. */
function martPixmap(): BuildingSprite {
  const { w, h } = BUILDING_SIZE.mart;
  const s: HouseStyle = { roof: C.water, roofDark: C.waterDeep, roofLight: C.waterLight, wall: C.houseWall, wallShade: C.houseWallShade };
  const p = new Pixmap(w, h);
  const cx = w / 2;
  const roofBase = 30;
  p.fillRect(2, 10, w - 4, roofBase - 8, s.roofDark);
  p.fillRect(3, 11, w - 6, roofBase - 11, s.roof);
  p.fillRect(3, 11, w - 6, 3, s.roofLight);
  p.fillRect(3, roofBase - 6, w - 6, 2, s.roofDark);
  p.fillRect(0, roofBase, w, 2, s.roofDark);
  drawWalls(p, roofBase + 1, s);
  p.fillRect(cx - 24, roofBase + 5, 48, 11, s.roofDark);
  p.fillRect(cx - 23, roofBase + 6, 46, 9, s.roof);
  for (let i = 0; i < 4; i++) p.fillRect(cx - 18 + i * 10, roofBase + 8, 6, 5, C.houseTrim);
  drawGlassDoors(p, cx, s);
  for (const x of [WALL_INSET + 6, w - WALL_INSET - 30]) {
    p.fillRect(x - 1, roofBase + 21, 22, 22, s.roofDark);
    p.fillRect(x, roofBase + 22, 20, 20, C.houseWindow);
    p.fillRect(x, roofBase + 22, 20, 2, C.houseTrim);
    p.fillRect(x + 3, roofBase + 34, 4, 8, C.flowerYellow);
    p.fillRect(x + 9, roofBase + 36, 4, 6, C.flowerRed);
    p.fillRect(x + 14, roofBase + 33, 4, 9, C.berryGreen);
  }
  return { pixmap: p, doorX: cx };
}

/** Double automatic glass doors, as on the Center and Mart. */
function drawGlassDoors(p: Pixmap, cx: number, s: HouseStyle): void {
  const foot = p.h - FOOT_H;
  const w = 22;
  const h = 24;
  const x = Math.round(cx - w / 2);
  p.fillRect(x - 1, foot - h - 1, w + 2, h + 1, s.roofDark);
  p.fillRect(x, foot - h, w, h, C.houseWindow);
  p.fillRect(x + w / 2 - 1, foot - h, 2, h, s.roofDark);
  p.fillRect(x + 2, foot - h + 2, 2, h - 6, C.houseTrim);
  p.fillRect(x + w / 2 + 2, foot - h + 2, 2, h - 6, C.houseTrim);
  p.fillRect(x - 6, foot, w + 12, 3, C.black);
  p.fillRect(x - 5, foot, w + 10, 2, C.roadLight);
}

export const PICKET_H = 12;

/**
 * A run of white picket fence `w` wide: pointed pickets every 4px on two
 * rails, outlined so it reads against both grass and pavement.
 */
export function picketFencePixmap(w: number): Pixmap {
  const p = new Pixmap(w, PICKET_H);
  p.fillRect(0, 4, w, 3, C.black);
  p.fillRect(0, 8, w, 3, C.black);
  p.fillRect(0, 5, w, 1, C.houseTrim);
  p.fillRect(0, 9, w, 1, C.houseTrim);
  for (let x = 1; x < w - 1; x += 4) {
    p.fillRect(x - 1, 1, 4, PICKET_H - 1, C.black);
    p.fillRect(x, 2, 2, PICKET_H - 3, C.houseTrim);
    p.set(x + 1, 2, C.houseWallShade);
    p.set(x, 1, C.black);
    p.set(x + 1, 1, C.black);
    p.fillRect(x, PICKET_H - 2, 2, 1, C.houseWallShade);
  }
  return p;
}

export const HEDGE_H = 16;

/** A trimmed hedge `w` wide: a flat-topped row of small foliage puffs. */
export function hedgePixmap(w: number, rng: RNG): Pixmap {
  const p = new Pixmap(w, HEDGE_H);
  for (let x = 5; x < w - 2; x += 6) puff(p, x + (rng() * 2 - 1), 9, 6);
  p.fillRect(2, 11, w - 4, 4, C.treeDark);
  p.fillRect(1, HEDGE_H - 2, w - 2, 1, C.black);
  return p;
}

export const MAILBOX_W = 10;
export const MAILBOX_H = 16;

/** A mailbox on a post — red or blue — with its little flag up now and then. */
export function mailboxPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(MAILBOX_W, MAILBOX_H);
  const red = rng() < 0.6;
  const body = red ? C.houseRoof : C.water;
  const dark = red ? C.houseRoofDark : C.waterDeep;
  p.fillRect(3, 7, 4, MAILBOX_H - 7, C.black);
  p.fillRect(4, 7, 2, MAILBOX_H - 8, C.wood);
  p.fillRect(0, 1, 9, 7, C.black);
  p.fillRect(1, 2, 7, 5, body);
  p.fillRect(1, 5, 7, 2, dark);
  p.set(1, 2, C.houseTrim);
  if (rng() < 0.5) {
    p.fillRect(8, 0, 2, 4, C.black);
    p.set(8, 1, C.flowerYellow);
  }
  return p;
}

export const SIGN_W = 28;
export const SIGN_H = 26;

/** A town-limits signboard on two posts, with a few strokes of lettering. */
export function townSignPixmap(): Pixmap {
  const p = new Pixmap(SIGN_W, SIGN_H);
  p.fillRect(4, 10, 4, 16, C.black);
  p.fillRect(20, 10, 4, 16, C.black);
  p.fillRect(5, 10, 2, 15, C.wood);
  p.fillRect(21, 10, 2, 15, C.wood);
  p.fillRect(0, 0, SIGN_W, 15, C.black);
  p.fillRect(1, 1, SIGN_W - 2, 13, C.wood);
  p.fillRect(1, 1, SIGN_W - 2, 2, C.pathEdge);
  p.fillRect(3, 4, SIGN_W - 6, 8, C.wallTan);
  for (const [x, y, w] of [[5, 5, 12], [5, 8, 18], [19, 5, 4]]) p.fillRect(x, y, w, 2, C.trunkDark);
  return p;
}

export const LAMP_W = 16;
export const LAMP_H = 64;

/**
 * A street lamp: a dark iron post on a stepped base, with a lantern head
 * glowing warm or cool under a little cap.
 */
export function streetlampPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(LAMP_W, LAMP_H);
  const glow = rng() < 0.6 ? C.flowerYellow : C.houseWindow;
  const cx = LAMP_W / 2;
  p.fillRect(cx - 5, 2, 10, 3, C.black);
  p.fillRect(cx - 4, 0, 8, 3, C.black);
  p.fillRect(cx - 4, 5, 8, 10, C.black);
  p.fillRect(cx - 3, 6, 6, 8, glow);
  p.fillRect(cx - 2, 7, 2, 5, C.houseTrim);
  p.fillRect(cx - 5, 15, 10, 2, C.black);
  p.fillRect(cx - 2, 17, 4, LAMP_H - 23, C.black);
  p.fillRect(cx - 1, 17, 1, LAMP_H - 24, C.trunk);
  p.fillRect(cx - 4, LAMP_H - 7, 8, 4, C.black);
  p.fillRect(cx - 3, LAMP_H - 6, 6, 2, C.trunk);
  p.fillRect(cx - 6, LAMP_H - 3, 12, 3, C.black);
  return p;
}

/** A wooden park bench, with an occasional worn plank mark for variety. */
export function benchPixmap(rng: RNG): Pixmap {
  const p = new Pixmap(40, 20);
  p.fillRect(1, 1, 38, 4, C.black);
  p.fillRect(2, 2, 36, 2, C.wood);
  p.fillRect(2, 2, 4, 10, C.wood);
  p.fillRect(34, 2, 4, 10, C.wood);
  p.fillRect(3, 2, 2, 10, C.woodDark);
  p.fillRect(35, 2, 2, 10, C.woodDark);
  p.fillRect(1, 9, 38, 6, C.black);
  p.fillRect(2, 10, 36, 4, C.wood);
  p.fillRect(2, 13, 36, 1, C.woodDark);
  p.fillRect(5, 14, 6, 6, C.black);
  p.fillRect(29, 14, 6, 6, C.black);
  p.fillRect(6, 14, 4, 5, C.woodDark);
  p.fillRect(30, 14, 4, 5, C.woodDark);
  if (rng() < 0.4) {
    const kx = 4 + Math.floor(rng() * 32);
    p.set(kx, 3, C.woodDark);
  }
  return p;
}

/** A low flower bed edged with clipped greenery, dotted with blooms. */
export function flowerBedPixmap(rng: RNG, w = 32): Pixmap {
  const p = new Pixmap(w, 14);
  p.fillRect(0, 6, w, 8, C.black);
  p.fillRect(1, 7, w - 2, 6, C.treeDark);
  p.fillRect(1, 7, w - 2, 2, C.treeLight);
  const petals = [C.flowerRed, C.flowerYellow, C.flowerWhite, C.flowerOrange];
  for (let i = 0; i < Math.round(w / 6); i++) {
    const fx = 2 + Math.floor(rng() * (w - 5));
    const c = petals[Math.floor(rng() * petals.length)];
    p.set(fx, 5, c);
    p.set(fx + 1, 5, c);
    p.set(fx, 4, c);
    p.set(fx + 1, 6, C.flowerYellow);
  }
  return p;
}
