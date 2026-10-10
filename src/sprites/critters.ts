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

/** Color schemes for leaping fish: an orange one and a silver one. */
const FISH = [
  { back: C.houseRoofDark, body: C.flowerOrange, belly: C.pathLight },
  { back: C.roadDark, body: C.roadLight, belly: C.houseTrim },
];

/**
 * A small fish in mid-leap, drawn straight into `p` along its direction
 * of travel (vx, vy) — nose up as it rises, level at the top of the arc,
 * nose down as it dives — with a dark back, a pale belly, an eye and a
 * forked tail.
 */
export function drawLeapingFish(p: Pixmap, x: number, y: number, vx: number, vy: number, scheme: number): void {
  const s = FISH[scheme % FISH.length];
  const len = Math.hypot(vx, vy) || 1;
  const dx = vx / len;
  const dy = vy / len;
  // perpendicular, pointing "up" from the fish's back
  const px = dy * Math.sign(vx || 1);
  const py = -dx * Math.sign(vx || 1);
  const at = (t: number, o: number, c: number) => p.set(Math.round(x + dx * t + px * o), Math.round(y + dy * t + py * o), c);
  for (let t = -3; t <= 3; t += 0.5) {
    const half = t > 2 ? 0 : 1;
    at(t, 0, s.body);
    if (half) {
      at(t, 1, s.back);
      at(t, -1, s.belly);
    }
  }
  at(3.5, 0, s.body);
  at(2.3, 0.6, C.black);
  // forked tail behind
  at(-4, 1.5, s.back);
  at(-4, -1.5, s.body);
  at(-3.6, 0, s.back);
}
