import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import type { RNG } from "../core/prng";

export type CloudKind = "cumulus" | "stratus";

interface Puff {
  x: number;
  y: number;
  r: number;
  /** Horizontal stretch: puffs are wider than tall, not perfect balls. */
  sx: number;
}

/**
 * The four tones a cloud is shaded with, brightest first. Far clouds use
 * a hazier, darker set so they sink back into the sky behind nearer ones.
 */
const NEAR_TONES = [C.cloud, C.cloudMid, C.cloudShade, C.cloudUnder];
const FAR_TONES = [C.cloudMid, C.cloudShade, C.cloudShade, C.cloudUnder];

/**
 * A pixel-art cloud about `w` wide (a little wider, so no puff is clipped). Cumulus: a lumpy base row of puffs on
 * a flat bottom with 2–4 taller towers rising out of it, like a heap of
 * cotton. Stratus: a long, thin streak of flattened puffs. Either way
 * each puff is shaded like the tree canopy puffs — a shaded base, a
 * mid-tone disc and a white highlight shifted toward the light (upper
 * left) — drawn back to front so the lobes overlap with distinct rims,
 * then a cool underside band along the flat base and a shaded rim on the
 * lower-right edge, rather than one flat white blob on a gray shadow.
 */
export function cloudPixmap(rng: RNG, w: number, kind: CloudKind, far: boolean): Pixmap {
  const puffs: Puff[] = [];
  let h: number;
  let base: number;
  if (kind === "stratus") {
    h = 6 + Math.floor(rng() * 5);
    base = h - 1;
    for (let x = h; x < w - h; x += h * (0.8 + rng() * 0.7)) {
      puffs.push({ x, y: base - h * 0.4, r: h * (0.42 + rng() * 0.2), sx: 2.2 + rng() * 1.2 });
    }
  } else {
    h = Math.round(w * (0.38 + rng() * 0.14));
    base = h - 2;
    const baseR = h * 0.3;
    for (let x = baseR; x < w - baseR * 0.8; x += baseR * (0.7 + rng() * 0.5)) {
      puffs.push({ x, y: base - baseR * (0.55 + rng() * 0.25), r: baseR * (0.85 + rng() * 0.35), sx: 1.15 + rng() * 0.3 });
    }
    const towers = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < towers; i++) {
      const t = (i + 0.5) / towers;
      const r = h * (0.32 + rng() * 0.16) * (1 - Math.abs(t - 0.45) * 0.6);
      const x = w * (0.18 + t * 0.64) + (rng() * 2 - 1) * w * 0.06;
      puffs.push({ x, y: Math.max(r + 1, base - r * 1.25 - rng() * h * 0.18), r, sx: 1.05 + rng() * 0.2 });
    }
  }

  // size the sprite to the puffs, not the other way round: end puffs are
  // wider than the room the layout leaves them, and clamping them to a
  // fixed box sliced their rounded sides off flat
  const minX = Math.min(...puffs.map((q) => q.x - q.r * q.sx)) - 1;
  const maxX = Math.max(...puffs.map((q) => q.x + q.r * q.sx)) + 1;
  const lift = Math.max(0, Math.ceil(1 - Math.min(...puffs.map((q) => q.y - q.r))));
  for (const q of puffs) {
    q.x -= minX;
    q.y += lift;
  }
  base += lift;
  h += lift;
  w = Math.ceil(maxX - minX) + 1;

  const p = new Pixmap(w, h);
  const tones = far ? FAR_TONES : NEAR_TONES;
  // back to front: towers behind, then the base row in front of them, so
  // the lobes overlap like a heap and each keeps its own rounded rim
  const order = [...puffs].sort((a, b) => a.y - b.y);
  for (const q of order) {
    const rx = q.r * q.sx;
    p.fillEllipse(q.x, q.y, rx, q.r, tones[2]);
    p.fillEllipse(q.x - rx * 0.1, q.y - q.r * 0.18, rx * 0.86, q.r * 0.84, tones[1]);
    p.fillEllipse(q.x - rx * 0.24, q.y - q.r * 0.36, rx * 0.56, q.r * 0.52, tones[0]);
  }
  // flat base: clear below it, then a cool underside band along it
  for (let y = base + 1; y < h; y++) for (let x = 0; x < w; x++) p.set(x, y, 0);
  for (let x = 0; x < w; x++) {
    if (!p.get(x, base)) continue;
    p.set(x, base, tones[3]);
    for (let y = base - (kind === "stratus" ? 1 : 2); y < base; y++) {
      const c = p.get(x, y);
      if (c === tones[0] || c === tones[1]) p.set(x, y, tones[2]);
    }
  }
  // lower-right rim: any edge pixel with open sky to its right or below
  const snapshot = p.data.slice();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : snapshot[y * w + x]);
  for (let y = 0; y < base; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x + 1, y) || !at(x, y + 1)) p.set(x, y, tones[2]);
    }
  }
  return p;
}
