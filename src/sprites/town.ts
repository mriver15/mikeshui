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
  center: { w: 152, h: 108 },
  mart: { w: 128, h: 92 },
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
 * healing center and the mart keep their fixed, recognizable looks since their
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

/**
 * Tiny blocky pixel font for signage — just the capitals the service
 * buildings spell. Each glyph is rows of '1'/'0', 5 rows tall, variable width.
 */
const GLYPHS: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"],
  C: ["011", "100", "100", "100", "011"],
  E: ["111", "100", "110", "100", "111"],
  H: ["101", "101", "111", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["1001", "1101", "1011", "1001", "1001"],
  R: ["110", "101", "110", "101", "101"],
  T: ["111", "010", "010", "010", "010"],
  " ": ["0", "0", "0", "0", "0"],
};

/** Pixel width of `text` at `scale`, with one (scaled) pixel between letters. */
function textWidth(text: string, scale = 1): number {
  let w = 0;
  for (const ch of text) w += (GLYPHS[ch][0].length + 1) * scale;
  return w - scale;
}

/** Draw `text` centred on `cx` with its top at `y`. */
function drawText(p: Pixmap, text: string, cx: number, y: number, color: number, scale = 1): void {
  let x = Math.round(cx - textWidth(text, scale) / 2);
  for (const ch of text) {
    const g = GLYPHS[ch];
    g.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === "1") p.fillRect(x + rx * scale, y + ry * scale, scale, scale, color);
      }
    });
    x += (g[0].length + 1) * scale;
  }
}

/**
 * A hip roof seen from the front and above: a trapezoidal top surface
 * (narrower at the back) with tile courses every 4 rows, a lit left hip
 * and shaded right hip for volume, then a front fascia band along the
 * eave. Spans [x0, x1], from `top` back edge to `front` eave.
 */
function hipRoof(p: Pixmap, x0: number, x1: number, top: number, front: number, s: HouseStyle, inset = 6): void {
  const h = front - top;
  for (let y = top; y < front; y++) {
    const t = (y - top) / h;
    const l = Math.round(x0 + inset * (1 - t));
    const r = Math.round(x1 - inset * (1 - t));
    p.set(l - 1, y, C.black);
    p.set(r + 1, y, C.black);
    for (let x = l; x <= r; x++) {
      let c = y === top ? C.black : y - top <= 2 ? s.roofLight : (front - y) % 4 === 0 ? s.roofDark : s.roof;
      if (y !== top && x < l + 3) c = s.roofLight;
      if (y !== top && x > r - 3) c = s.roofDark;
      p.set(x, y, c);
    }
  }
  p.fillRect(x0 - 1, front, x1 - x0 + 3, 5, C.black);
  p.fillRect(x0, front + 1, x1 - x0 + 1, 3, s.roofDark);
  p.fillRect(x0, front + 1, x1 - x0 + 1, 1, s.roof);
}

/**
 * The healing center's emblem: an outlined white badge with a red heart
 * on it, lit at the upper left — an original mark, so the building reads
 * as "the place that heals your team" without borrowing anyone's logo.
 */
function heartBadge(p: Pixmap, cx: number, cy: number, r: number): void {
  p.fillCircle(cx, cy, r + 1, C.black);
  p.fillCircle(cx, cy, r, C.houseTrim);
  p.fillCircle(cx - r * 0.3, cy - r * 0.35, r * 0.75, C.houseTrim);
  const h = r * 0.55;
  p.fillCircle(cx - h * 0.5, cy - h * 0.25, h * 0.55, C.houseRoof);
  p.fillCircle(cx + h * 0.5, cy - h * 0.25, h * 0.55, C.houseRoof);
  p.fillTriangle(cx - h * 1.05, cy - h * 0.05, cx + h * 1.05, cy - h * 0.05, cx, cy + h * 1.05, C.houseRoof);
  p.set(Math.round(cx - h * 0.65), Math.round(cy - h * 0.5), C.houseRoofLight);
  p.set(Math.round(cx - h * 0.45), Math.round(cy - h * 0.6), C.houseRoofLight);
}

/** The mart's sign icon: a little white shopping bag with a handle. */
function bagIcon(p: Pixmap, cx: number, cy: number): void {
  const x = Math.round(cx - 4);
  const y = Math.round(cy - 3);
  p.fillRect(x - 1, y - 1, 10, 9, C.black);
  p.fillRect(x, y, 8, 7, C.houseTrim);
  p.fillRect(x, y, 8, 1, C.houseWall);
  p.fillRect(x + 2, y - 4, 4, 1, C.black);
  p.fillRect(x + 1, y - 3, 1, 3, C.black);
  p.fillRect(x + 6, y - 3, 1, 3, C.black);
}

/**
 * Healing center, after the Gen-3 look: a wide red hip-roofed hall with a
 * raised central block carrying a big heart-badge emblem, a red band
 * running along the white walls, a lettered sign over a canopy and the
 * sliding glass doors, and framed windows along both wings.
 */
function centerPixmap(): BuildingSprite {
  const { w, h } = BUILDING_SIZE.center;
  const s: HouseStyle = { roof: C.houseRoof, roofDark: C.houseRoofDark, roofLight: C.houseRoofLight, wall: C.houseWall, wallShade: C.houseWallShade };
  const p = new Pixmap(w, h);
  const cx = w / 2;
  const wallTop = 40;
  const blockL = cx - 30;
  const blockR = cx + 30;

  // wings: the long main roof, then the walls under it
  hipRoof(p, 3, w - 4, 20, wallTop - 4, s, 8);
  drawWalls(p, wallTop + 1, s);
  p.fillRect(WALL_INSET, wallTop + 6, w - 2 * WALL_INSET, 4, C.black);
  p.fillRect(WALL_INSET, wallTop + 7, w - 2 * WALL_INSET, 2, s.roof);

  // raised central block rising through the main roof, with its own roof
  p.fillRect(blockL - 1, 14, blockR - blockL + 2, wallTop - 13, C.black);
  p.fillRect(blockL, 15, blockR - blockL, wallTop - 14, s.wall);
  p.fillRect(blockR - 6, 15, 6, wallTop - 14, s.wallShade);
  hipRoof(p, blockL - 3, blockR + 3, 1, 12, s, 6);
  heartBadge(p, cx, 28, 10);

  // sign plate over the canopy: "HEAL CENTER" in two lines
  const plateTop = wallTop + 14;
  p.fillRect(cx - 21, plateTop, 42, 15, C.black);
  p.fillRect(cx - 20, plateTop + 1, 40, 13, C.houseTrim);
  drawText(p, "HEAL", cx, plateTop + 2, s.roof);
  drawText(p, "CENTER", cx, plateTop + 8, s.roof);

  // canopy over the doors, casting a shadow line onto the wall
  const doorTop = h - FOOT_H - 26;
  p.fillRect(cx - 22, doorTop - 6, 44, 5, C.black);
  p.fillRect(cx - 21, doorTop - 5, 42, 2, s.roofLight);
  p.fillRect(cx - 21, doorTop - 3, 42, 1, s.roof);
  p.fillRect(cx - 20, doorTop - 1, 40, 1, s.wallShade);
  drawGlassDoors(p, cx, s);

  // two windows on each wing, clear of the doors and sign
  for (const x of [WALL_INSET + 6, WALL_INSET + 26, w - WALL_INSET - 40, w - WALL_INSET - 20]) {
    drawWindow(p, x, wallTop + 20, s, 14, 14);
  }
  return { pixmap: p, doorX: cx };
}

/**
 * Mart, after the Gen-3 look: a blue hip roof, a long signboard
 * with a shopping-bag icon and "MART" in big letters, a blue-and-white
 * striped awning with a scalloped edge over the sliding doors, and shop
 * windows with stocked shelves on both sides.
 */
function martPixmap(): BuildingSprite {
  const { w, h } = BUILDING_SIZE.mart;
  const s: HouseStyle = { roof: C.water, roofDark: C.waterDeep, roofLight: C.waterLight, wall: C.houseWall, wallShade: C.houseWallShade };
  const p = new Pixmap(w, h);
  const cx = w / 2;
  const wallTop = 28;
  hipRoof(p, 3, w - 4, 4, wallTop - 4, s, 8);
  drawWalls(p, wallTop + 1, s);

  // signboard
  const signTop = wallTop + 4;
  p.fillRect(cx - 34, signTop, 68, 16, C.black);
  p.fillRect(cx - 33, signTop + 1, 66, 14, s.roof);
  p.fillRect(cx - 33, signTop + 1, 66, 2, s.roofLight);
  bagIcon(p, cx - 22, signTop + 8);
  drawText(p, "MART", cx + 7, signTop + 3, C.houseTrim, 2);

  // striped awning with a scalloped lower edge
  const awnTop = signTop + 19;
  const awnBottom = awnTop + 7;
  // each 6px stripe ends in its own rounded scallop, outlined along the
  // bottom contour only, so the edge reads as one scalloped hem
  const awnL = WALL_INSET - 1;
  const awnR = w - WALL_INSET;
  p.fillRect(awnL - 1, awnTop - 1, awnR - awnL + 2, 1, C.black);
  for (let x = awnL; x < awnR; x++) {
    const i = x - awnL;
    const stripe = Math.floor(i / 6) % 2 === 0 ? s.roof : C.houseTrim;
    const u = (i % 6) - 2.5;
    const dip = Math.round(Math.sqrt(Math.max(0, 9 - u * u)));
    for (let y = awnTop; y < awnBottom + dip; y++) p.set(x, y, y === awnTop && stripe === s.roof ? s.roofLight : stripe);
    p.set(x, awnBottom + dip, C.black);
  }
  for (let y = awnTop; y < awnBottom + 1; y++) {
    p.set(awnL - 1, y, C.black);
    p.set(awnR, y, C.black);
  }
  p.fillRect(WALL_INSET, awnBottom + 4, w - 2 * WALL_INSET, 1, s.wallShade);

  drawGlassDoors(p, cx, s);

  // shop windows with shelves of goods
  const winTop = awnBottom + 6;
  const winH = h - FOOT_H - 5 - winTop;
  const goods = [C.flowerYellow, C.houseRoof, C.berryGreen, C.flowerOrange, C.houseRoofLight, C.water];
  for (const x of [WALL_INSET + 5, w - WALL_INSET - 5 - 30]) {
    p.fillRect(x - 1, winTop - 1, 32, winH + 2, C.black);
    p.fillRect(x, winTop, 30, winH, C.houseWindow);
    for (let sy = winTop + 6; sy < winTop + winH; sy += 7) {
      p.fillRect(x, sy, 30, 1, s.roofDark);
      for (let gx = x + 2, gi = sy + x; gx < x + 28; gx += 4, gi++) {
        p.fillRect(gx, sy - 3, 2, 3, goods[gi % goods.length]);
      }
    }
    p.set(x + 1, winTop + 1, C.houseTrim);
    p.set(x + 2, winTop + 1, C.houseTrim);
    p.set(x + 1, winTop + 2, C.houseTrim);
    p.fillRect(x - 2, winTop + winH + 1, 34, 2, s.wallShade);
  }
  // blue skirting stripe above the foundation
  p.fillRect(WALL_INSET, h - FOOT_H - 3, w - 2 * WALL_INSET, 3, s.roof);
  return { pixmap: p, doorX: cx };
}

/**
 * Double sliding glass doors, as on the Center and Mart: a dark frame,
 * two glass leaves split by a mullion, each with a diagonal glint, and a
 * mat on a pale step in front.
 */
function drawGlassDoors(p: Pixmap, cx: number, s: HouseStyle): void {
  const foot = p.h - FOOT_H;
  const w = 24;
  const h = 26;
  const x = Math.round(cx - w / 2);
  p.fillRect(x - 2, foot - h - 2, w + 4, h + 2, C.black);
  p.fillRect(x - 1, foot - h - 1, w + 2, h + 1, s.roofDark);
  p.fillRect(x, foot - h, w, h, C.houseWindow);
  p.fillRect(x + w / 2 - 1, foot - h, 2, h, s.roofDark);
  for (const lx of [x, x + w / 2 + 1]) {
    for (let i = 0; i < 6; i++) {
      p.set(lx + 2 + i, foot - h + 9 - i, C.houseTrim);
      p.set(lx + 2 + i, foot - h + 13 - i, C.waterLight);
    }
  }
  p.fillRect(x - 6, foot, w + 12, 3, C.black);
  p.fillRect(x - 5, foot, w + 10, 2, C.roadLight);
  p.fillRect(x + 2, foot, w - 4, 2, s.roofDark);
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
  const glow = rng() < 0.6 ? C.lampGlow : C.houseWindow;
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
