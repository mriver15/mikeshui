import type { Pixmap } from "../core/pixmap";
import { C, RGBA, SKY } from "../core/palette";
import { ditherThreshold } from "../core/dither";
import { hashString, keyRng, noise2i } from "../core/prng";
import type { WaterSpan } from "./water";
import { drawLeapingFish } from "../sprites/critters";
import { CHUNK_W } from "./worldgen";

/** How far below the shoreline reflections reach before fading out. */
const REFLECT_DEPTH = 26;

/** Water colors the effects may paint over — not lily pads, reeds or overhanging leaves. */
const OPEN_WATER = new Set([C.water, C.waterLight, C.waterDark]);

/**
 * Colors that are ground, sky or distant hills rather than something
 * standing on the shore — not reflected, so only trees, reeds, posts and
 * buildings show up in the water.
 */
const NOT_REFLECTED = new Set([
  0,
  C.grass, C.grassDark, C.grassLight, C.grassBright, C.tallGrass, C.tallGrassLight,
  C.shore, C.path, C.pathLight, C.pathDark, C.pathEdge, C.road, C.roadDark, C.roadLight,
  C.water, C.waterLight, C.waterDark, C.waterBright, C.waterDeep,
  C.treeline, C.treelineDark, C.treelineHaze, C.treelineHazeLight, C.treelineHazeDark,
  C.mountain, C.mountainLight, C.mountainDark,
  C.cloud, C.cloudMid, C.cloudShade, C.cloudUnder,
  ...SKY,
]);

/**
 * What each palette color looks like reflected: dark shapes go deep
 * blue, mid tones a darker water, pale ones a light glint — the
 * reflection keeps an object's light and shade but takes on the water's
 * color, like a tinted mirror.
 */
const REFLECTED: Uint8Array = (() => {
  const out = new Uint8Array(RGBA.length / 4);
  for (let i = 0; i < out.length; i++) {
    const lum = 0.3 * RGBA[i * 4] + 0.59 * RGBA[i * 4 + 1] + 0.11 * RGBA[i * 4 + 2];
    out[i] = lum < 70 ? C.waterDeep : lum < 140 ? C.waterDark : lum < 200 ? C.water : C.waterLight;
  }
  return out;
})();

/** One visible chunk's index and its water spans. */
export interface WaterChunk {
  k: number;
  water: WaterSpan[][];
}

/**
 * Per-frame water: drawn after the world and the swaying canopies (so
 * they can be reflected) and before the foreground. Over each recorded
 * span of open water, in order:
 *
 * - reflections of whatever stands on the shore, mirrored about the
 *   shoreline, wobbling more the further they reach, and dithering out
 *   with depth;
 * - short ripple dashes on a per-row grid, each row swaying at its own
 *   pace and each dash fading in and out on its own cycle — in place of
 *   random per-pixel glints, which read as static;
 * - on the sea, broken lines of foam rolling in toward the beach;
 * - foam lapping at the shoreline in slow travelling swells;
 * - now and then, a fish: surfacing in a spreading ring, or leaping out
 *   in an arc and splashing back in.
 */
export function drawWaterEffects(fb: Pixmap, chunks: WaterChunk[], scrollX: number, time: number, seed: string): void {
  const rippleSeed = hashString(seed + ":ripple");
  const t = time / 1000;
  const px = (x: number, y: number) => fb.data[y * fb.w + x];
  // only solid shapes (trunks, canopies, buildings) reflect: a pixel
  // inside a run of 5+ standing pixels. Thin reed stems and cattail heads
  // mirrored about the shoreline — not their own bases — would float
  // loose in the water as scribbles.
  const standing = (x: number, y: number) => x >= 0 && x < fb.w && !NOT_REFLECTED.has(px(x, y));
  const solidAround = (x: number, y: number) =>
    standing(x - 2, y) && standing(x - 1, y) && standing(x + 1, y) && standing(x + 2, y);
  const put = (x: number, y: number, c: number) => {
    if (x >= 0 && x < fb.w && y >= 0 && y < fb.h && OPEN_WATER.has(px(x, y))) fb.data[y * fb.w + x] = c;
  };

  /** A ring spreading out over the water from (cx, cy), `age` seconds old. */
  const ring = (cx: number, cy: number, age: number) => {
    if (age < 0.2) put(cx, cy - 1, C.waterBright);
    const rx = 1.5 + age * 7;
    const ry = rx * 0.35;
    const steps = Math.ceil(rx * 6);
    for (let i = 0; i < steps; i++) {
      if (age > 0.9 && i % 2 === 0) continue;
      const a = (i / steps) * Math.PI * 2;
      put(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), age < 0.7 ? C.waterBright : C.waterLight);
    }
  };
  /** A few droplets thrown up and out from (cx, cy), mostly toward `dir`. */
  const splash = (cx: number, cy: number, age: number, dir: number) => {
    for (let i = 0; i < 5; i++) {
      const vx = (i - 2) * 9 + dir * 8;
      const vy = 26 + (i % 2) * 10;
      const x = Math.round(cx + vx * age);
      const y = Math.round(cy - vy * age + 90 * age * age);
      if (x >= 0 && x < fb.w && y >= 0 && y < fb.h) fb.data[y * fb.w + x] = C.waterBright;
    }
  };

  for (const { k, water } of chunks) {
    const left = k * CHUNK_W - scrollX;
    for (let lx = 0; lx < water.length; lx++) {
      const x = left + lx;
      if (x < 0 || x >= fb.w) continue;
      const wx = scrollX + x;
      for (const [top, bottom, sea] of water[lx]) {
        // reflections
        const axis = top - 1;
        for (let y = top; y <= Math.min(bottom, top + REFLECT_DEPTH); y++) {
          const d = y - top;
          if (d > REFLECT_DEPTH * 0.45 && ditherThreshold(x, y) < (d - REFLECT_DEPTH * 0.45) / (REFLECT_DEPTH * 0.55)) continue;
          const sy = 2 * axis - y;
          // wobble in two-row steps and gently: per-row 1px shifts turn
          // thin reflected stems into scribbles
          const wobble = Math.round(Math.sin((d >> 1) * 1.1 + t * 2.4) * Math.min(1, d / 10));
          const sx = x + wobble;
          if (sy < 0 || sx < 0 || sx >= fb.w) continue;
          const src = px(sx, sy);
          if (NOT_REFLECTED.has(src) || !solidAround(sx, sy)) continue;
          put(x, y, REFLECTED[src]);
        }

        // ripple dashes
        for (let y = top + 2; y <= bottom; y += 3) {
          const sway = Math.round(Math.sin(t * 0.6 + y * 0.55) * 3);
          const u = wx + sway;
          const cell = Math.floor(u / 14);
          const n = noise2i(rippleSeed, cell, y);
          if (n > 0.45) continue;
          const len = 2 + Math.floor(noise2i(rippleSeed + 1, cell, y) * 4);
          const start = Math.floor(noise2i(rippleSeed + 2, cell, y) * (14 - len));
          const local = u - cell * 14;
          if (local < start || local >= start + len) continue;
          const phase = (t * 0.45 + noise2i(rippleSeed + 3, cell, y)) % 1;
          if (phase > 0.6) continue;
          const crest = local === start + (len >> 1) && phase > 0.15 && phase < 0.45;
          put(x, y, crest || px(x, y) === C.waterLight ? C.waterBright : C.waterLight);
        }

        // the sea: broken lines of foam rolling in toward the shore, each
        // wave's crest uneven along the coast so it never reads as a ruler
        if (sea) {
          const reach = Math.min(30, bottom - top);
          for (let w = 0; w < 3; w++) {
            const crest = (noise2i(rippleSeed + 20, wx >> 5, w) * 2 - 1) * 2.5;
            const d = reach - ((t * 5 + w * (reach / 3)) % reach) + crest;
            if (d < 2) continue;
            const y = top + Math.round(d);
            if (y > bottom) continue;
            if (noise2i(rippleSeed + 21, (wx + Math.round(t * 4)) >> 2, w + Math.floor(t / 3)) < 0.3) continue;
            put(x, y, C.waterBright);
            if (d > 6) put(x, y + 1, C.waterLight);
          }
        }

        // lapping foam at the shoreline
        const swell = Math.sin(t * 1.6 + wx * 0.21) + Math.sin(t * 0.9 - wx * 0.07);
        if (swell > 0.2) put(x, top, C.waterBright);
        if (swell > 1.25 && top - 1 >= 0 && px(x, top - 1) === C.pathDark) fb.data[(top - 1) * fb.w + x] = C.waterBright;
      }
    }

    // a fish: one chance per chunk every few seconds. Sometimes it just
    // surfaces — a ring spreading out and fading — and sometimes it leaps:
    // a splash, an arc through the air a body-length or so across, and a
    // splash and ring where it lands.
    const period = 3.4;
    const offset = (noise2i(rippleSeed + 9, k, 0) * period) | 0;
    const event = Math.floor((t + offset) / period);
    const age = (t + offset) % period;
    if (age > 2.2) continue;
    const rng = keyRng(seed, "fish", k, event);
    if (rng() > 0.55) continue;
    const lx = Math.floor(rng() * water.length);
    const spans = water[lx];
    if (!spans || spans.length === 0) continue;
    const [top, bottom] = spans[0];
    if (bottom - top < 8) continue;
    const cy = top + 5 + Math.floor(rng() * (bottom - top - 7));
    const cx = left + lx;
    const leap = rng() < 0.45;
    const dir = rng() < 0.5 ? -1 : 1;
    const scheme = rng() < 0.7 ? 0 : 1;
    if (!leap) {
      if (age < 1.5) ring(cx, cy, age);
      continue;
    }
    const air = 0.62;
    const span = 18 + Math.floor(rng() * 10);
    const height = 8 + Math.floor(rng() * 4);
    if (age < 1.2) ring(cx, cy, age * 0.8);
    if (age < 0.25) splash(cx, cy, age, -dir);
    if (age < air) {
      const u = age / air;
      const fx = cx + dir * span * u;
      const fy = cy - height * 4 * u * (1 - u);
      drawLeapingFish(fb, fx, fy, dir * span, -height * 4 * (1 - 2 * u), scheme);
    } else {
      const landed = age - air;
      if (landed < 1.5) ring(cx + dir * span, cy, landed);
      if (landed < 0.25) splash(cx + dir * span, cy, landed, dir);
    }

  }
}
