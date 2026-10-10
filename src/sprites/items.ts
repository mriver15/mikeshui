import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";

/**
 * Things you can find hidden in the grass — generic finds, each with a
 * small 9×9 icon shown as it's picked up.
 */
export const ITEMS = ["BERRY", "SHINY STONE", "HONEY", "FEATHER", "ACORN", "MUSHROOM"] as const;

const icons = new Map<number, Pixmap>();

/** The icon for item `kind` (an index into ITEMS). */
export function itemIcon(kind: number): Pixmap {
  let p = icons.get(kind);
  if (p) return p;
  p = new Pixmap(9, 9);
  switch (ITEMS[kind % ITEMS.length]) {
    case "BERRY":
      p.fillCircle(4.5, 5.5, 3.6, C.black);
      p.fillCircle(4.5, 5.5, 2.7, C.berry);
      p.set(3, 4, C.houseTrim);
      p.fillRect(4, 0, 3, 2, C.black);
      p.set(5, 1, C.treeLight);
      p.set(6, 0, C.tree);
      break;
    case "SHINY STONE":
      p.fillTriangle(4.5, 0, 0, 4, 9, 4, C.black);
      p.fillTriangle(0, 4, 9, 4, 4.5, 9, C.black);
      p.fillTriangle(4.5, 1.5, 1.5, 4, 7.5, 4, C.waterLight);
      p.fillTriangle(1.5, 4, 7.5, 4, 4.5, 7.5, C.water);
      p.set(3, 3, C.houseTrim);
      break;
    case "HONEY":
      p.fillRect(1, 2, 7, 7, C.black);
      p.fillRect(2, 3, 5, 5, C.flowerYellow);
      p.fillRect(2, 3, 5, 1, C.wallTan);
      p.fillRect(2, 0, 5, 2, C.black);
      p.fillRect(3, 1, 3, 1, C.wood);
      p.set(3, 5, C.houseTrim);
      break;
    case "FEATHER":
      for (let i = 0; i < 7; i++) {
        p.set(1 + i, 7 - i, C.roadDark);
        p.set(1 + i, 6 - i, C.houseTrim);
        p.set(2 + i, 7 - i, C.houseTrim);
      }
      p.set(0, 8, C.black);
      break;
    case "ACORN":
      p.fillCircle(4.5, 5.5, 3.4, C.black);
      p.fillCircle(4.5, 5.5, 2.5, C.wood);
      p.fillRect(1, 2, 7, 3, C.black);
      p.fillRect(2, 2, 5, 2, C.trunkDark);
      p.set(4, 0, C.black);
      p.set(4, 1, C.black);
      p.set(3, 5, C.pathEdge);
      break;
    case "MUSHROOM":
      p.fillRect(3, 5, 3, 4, C.black);
      p.fillRect(4, 5, 1, 3, C.pathLight);
      p.fillCircle(4.5, 4, 4, C.black);
      p.fillCircle(4.5, 4, 3, C.flowerRed);
      p.fillRect(0, 4, 9, 2, C.black);
      p.fillRect(1, 4, 7, 1, C.flowerRed);
      p.set(3, 2, C.houseTrim);
      p.set(6, 3, C.houseTrim);
      break;
  }
  icons.set(kind, p);
  return p;
}

/**
 * A glint marking a hidden item: a four-pointed twinkle that swells from
 * a dot to a star and back as `t` runs 0..1, centred on (cx, cy).
 */
export function drawSparkle(p: Pixmap, cx: number, cy: number, t: number): void {
  const size = t < 0.15 || t > 0.85 ? 0 : t < 0.3 || t > 0.7 ? 1 : 2;
  p.set(cx, cy, C.star);
  if (size >= 1) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.set(cx + dx, cy + dy, C.lampGlow);
  }
  if (size >= 2) {
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) p.set(cx + dx, cy + dy, C.star);
    for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) p.set(cx + dx, cy + dy, C.lampGlow);
    p.set(cx, cy, C.star);
  }
}
