import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";

/**
 * A pair of eyes peeking out of the grass: two small whites with dark
 * pupils glancing toward `look` (-1 left, +1 right), or a closed line
 * mid-blink. `white` lets them glow after dark.
 */
export function drawPeekingEyes(p: Pixmap, cx: number, cy: number, look: number, blink: boolean, white: number): void {
  for (const ex of [cx - 3, cx + 2]) {
    if (blink) {
      p.fillRect(ex - 1, cy + 1, 3, 1, C.black);
      continue;
    }
    p.fillRect(ex - 1, cy - 1, 3, 4, C.black);
    p.fillRect(ex, cy, 2, 2, white);
    p.set(look > 0 ? ex + 1 : ex, cy + 1, C.black);
  }
}

/**
 * An "!" alert bubble whose tail tip sits just below `bottom`, popping up: `pop`
 * runs 0..1 over the first moments, overshooting a pixel before it
 * settles so it reads as a bounce.
 */
export function drawAlertBubble(p: Pixmap, cx: number, bottom: number, pop: number): void {
  const rise = pop < 1 ? Math.round(Math.sin(pop * Math.PI) * 2) : 0;
  const x = Math.round(cx - 4);
  const y = bottom - 11 - rise;
  p.fillRect(x, y, 9, 10, C.black);
  // an emissive fill, so the alert stays legible after dark
  p.fillRect(x + 1, y + 1, 7, 8, C.star);
  p.fillRect(x + 3, y + 2, 3, 4, C.houseRoof);
  p.fillRect(x + 3, y + 7, 3, 1, C.houseRoof);
  p.fillRect(x + 3, y + 10, 2, 1, C.black);
  p.set(x + 3, y + 11, C.black);
}
