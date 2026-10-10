import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import { drawText, textWidth, LARGE_FONT } from "./font";

export type AreaKind = "town" | "route";

/**
 * The location banner that slides in when you enter a new area, in the
 * manner of the GBA games' signposts: the name in large letters on a
 * cream panel inside a thick frame — weathered wood for routes, dressed
 * stone for towns — with nail heads (or mortar lines) on the frame and a
 * drop shadow.
 */
export function bannerPixmap(name: string, kind: AreaKind): Pixmap {
  const text = name.toUpperCase();
  const w = Math.max(72, textWidth(text, 1, LARGE_FONT) + 22);
  const h = 21;
  const p = new Pixmap(w + 2, h + 2);
  const [frame, frameDark] = kind === "town" ? [C.uiStone, C.uiStoneDark] : [C.uiWood, C.uiWoodDark];

  p.fillRect(2, 2, w, h, C.uiShadow);
  p.fillRect(0, 0, w, h, C.black);
  p.fillRect(1, 1, w - 2, h - 2, frame);
  p.fillRect(1, h - 3, w - 2, 2, frameDark);
  p.fillRect(w - 3, 1, 2, h - 2, frameDark);
  p.fillRect(4, 4, w - 8, h - 8, C.black);
  p.fillRect(5, 5, w - 10, h - 10, C.uiFill);

  if (kind === "town") {
    // mortar lines between the frame's stones
    for (let x = 8; x < w - 4; x += 10) {
      p.set(x, 1, frameDark);
      p.set(x, 2, frameDark);
      p.set(x + 5, h - 4, frameDark);
    }
  } else {
    // a nail head in each corner of the wooden frame
    for (const [x, y] of [[2, 2], [w - 4, 2], [2, h - 4], [w - 4, h - 4]]) {
      p.set(x, y, C.uiFill);
      p.set(x + 1, y + 1, frameDark);
    }
  }
  drawText(p, text, w / 2, 7, C.uiText, 1, LARGE_FONT);
  return p;
}
