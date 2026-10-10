import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";

/**
 * Townspeople: small outlined figures (a quarter of a house's height),
 * each with their own skin, hair, shirt and trousers and sometimes a
 * cap, in a three-frame walk — standing, and each leg forward — facing
 * either way. Original, generic designs.
 */
export interface Look {
  skin: number;
  hair: number;
  shirt: number;
  shirtShade: number;
  pants: number;
  cap: number | null;
}

const SKINS = [C.skin, C.skinShade, C.pathEdge, C.trunk];
const HAIRS = [C.trunkDark, C.black, C.roofOrangeDark, C.flowerYellow, C.houseWallShade];
const SHIRTS: Array<[number, number]> = [
  [C.houseRoof, C.houseRoofDark],
  [C.water, C.waterDeep],
  [C.treeLight, C.tree],
  [C.flowerYellow, C.roofOrangeDark],
  [C.houseWall, C.houseWallShade],
  [C.roofGreen, C.roofGreenDark],
  [C.roofOrange, C.roofOrangeDark],
];
const PANTS = [C.waterDeep, C.trunkDark, C.roadDark, C.woodDark, C.wallTanShade];
const CAPS = [C.houseRoof, C.water, C.roofGreen, C.flowerYellow];

/** A look rolled from `rng`. */
export function rollLook(rng: () => number): Look {
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
  const [shirt, shirtShade] = pick(SHIRTS);
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    shirt,
    shirtShade,
    pants: pick(PANTS),
    cap: rng() < 0.3 ? pick(CAPS) : null,
  };
}

export const PERSON_W = 11;
export const PERSON_H = 20;

const cache = new Map<string, Pixmap>();

/**
 * A townsperson in walk frame `frame` (0 standing, 1 and 2 mid-stride),
 * facing right if `right`, else left. Feet on the bottom row.
 */
export function personPixmap(look: Look, frame: number, right: boolean): Pixmap {
  const key = `${look.skin},${look.hair},${look.shirt},${look.pants},${look.cap},${frame},${right}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new Pixmap(PERSON_W, PERSON_H);
  // drawn facing right, chibi-proportioned (a big round head on a small
  // body); mirrored at the end for left
  // legs: two 1px legs in one outline, striding apart on the step frames
  const stride = frame === 0 ? 0 : frame === 1 ? 1 : -1;
  p.fillRect(3, 14, 5, 4, C.black);
  p.fillRect(4, 14, 1, 3, look.pants);
  p.fillRect(6, 14, 1, 3, look.pants);
  for (const [lx, d] of [[4, -stride], [6, stride]]) {
    p.fillRect(lx - 1 + d, 17, 3, 2, C.black);
    p.set(lx + d, 17, C.woodDark);
  }
  // torso, with the near arm swinging against the stride
  p.fillRect(3, 9, 5, 6, C.black);
  p.fillRect(4, 10, 3, 4, look.shirt);
  p.fillRect(4, 13, 3, 1, look.shirtShade);
  const arm = -stride;
  p.fillRect(5 + arm, 10, 1, 3, look.shirtShade);
  p.set(5 + arm, 13, look.skin);
  // a big round head: outlined, hair over the top and back, an eye in front
  p.fillRect(2, 1, 7, 8, C.black);
  for (const [cx, cy] of [[2, 1], [8, 1], [2, 8], [8, 8]]) p.set(cx, cy, 0);
  p.fillRect(3, 2, 5, 6, look.skin);
  p.fillRect(3, 2, 5, 2, look.hair);
  p.fillRect(3, 2, 2, 4, look.hair);
  p.set(6, 5, C.black);
  if (look.cap !== null) {
    p.fillRect(2, 0, 7, 3, C.black);
    p.fillRect(3, 1, 5, 2, look.cap);
    p.fillRect(8, 2, 2, 2, C.black);
    p.set(8, 2, look.cap);
  }
  const out = right ? p : mirror(p);
  cache.set(key, out);
  return out;
}

function mirror(p: Pixmap): Pixmap {
  const m = new Pixmap(p.w, p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) m.set(p.w - 1 - x, y, p.get(x, y));
  return m;
}
