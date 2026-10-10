import { C, RGBA, SKY } from "./palette";

/**
 * Time of day as a palette transform. Every pixel is a palette index, so
 * dawn, dusk and night are just different palettes: each color is tinted
 * (multiplied and offset per channel) toward the light of that hour, the
 * sky gradient is swapped for that hour's own gradient, and light sources
 * keep their color. No art is redrawn.
 *
 * `phase` runs 0..1 over a day: 0 midnight, 0.25 dawn, 0.5 noon, 0.75 dusk.
 */

type RGB = [number, number, number];

interface Light {
  phase: number;
  mul: RGB;
  add: RGB;
  skyTop: RGB;
  skyHorizon: RGB;
  /** 0 in full daylight, 1 at night — how much lamps and windows matter. */
  darkness: number;
}

const NIGHT: Omit<Light, "phase"> = {
  mul: [0.3, 0.36, 0.58],
  add: [6, 10, 28],
  skyTop: [10, 16, 48],
  skyHorizon: [31, 44, 90],
  darkness: 1,
};
const DAWN: Omit<Light, "phase"> = {
  mul: [0.95, 0.82, 0.86],
  add: [18, 8, 14],
  skyTop: [95, 120, 184],
  skyHorizon: [244, 184, 160],
  darkness: 0.35,
};
const DAY: Omit<Light, "phase"> = {
  mul: [1, 1, 1],
  add: [0, 0, 0],
  skyTop: [0x62, 0xa4, 0xde],
  skyHorizon: [0xde, 0xe6, 0xee],
  darkness: 0,
};
const DUSK: Omit<Light, "phase"> = {
  mul: [1, 0.76, 0.62],
  add: [22, 6, 0],
  skyTop: [61, 79, 150],
  skyHorizon: [243, 154, 90],
  darkness: 0.45,
};

/** Keyframes around the day; light is interpolated between neighbours. */
const KEYS: Light[] = [
  { phase: 0, ...NIGHT },
  { phase: 0.17, ...NIGHT },
  { phase: 0.25, ...DAWN },
  { phase: 0.32, ...DAY },
  { phase: 0.68, ...DAY },
  { phase: 0.75, ...DUSK },
  { phase: 0.83, ...NIGHT },
  { phase: 1, ...NIGHT },
];

/** Colors that emit light, so they're never darkened. */
const EMISSIVE = new Set([C.lampGlow, C.star, C.moon]);

/** What a lit house window turns into after dark. */
const WINDOW_GLOW: RGB = [255, 210, 122];

/** Warm lamplight: the color multiplier inside a lamp's pool of light. */
const LAMPLIGHT: RGB = [1, 0.9, 0.7];

export interface DayPalette {
  /** Packed RGBA per palette index, for the scene at this hour. */
  base: Uint32Array;
  /** The same, as lit by a nearby lamp. */
  lit: Uint32Array;
  darkness: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function lightAt(phase: number): Omit<Light, "phase"> {
  const p = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].phase <= p) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (p - a.phase) / (b.phase - a.phase);
  return {
    mul: lerp3(a.mul, b.mul, t),
    add: lerp3(a.add, b.add, t),
    skyTop: lerp3(a.skyTop, b.skyTop, t),
    skyHorizon: lerp3(a.skyHorizon, b.skyHorizon, t),
    darkness: lerp(a.darkness, b.darkness, t),
  };
}

function pack(r: number, g: number, b: number, a: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return ((a << 24) | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
}

/** Hours are quantized so the palette is rebuilt a few hundred times a day, not every frame. */
const STEPS = 480;
const cache = new Map<number, DayPalette>();

/** The palette for a time of day. */
export function dayPalette(phase: number): DayPalette {
  const step = Math.round((((phase % 1) + 1) % 1) * STEPS) % STEPS;
  const hit = cache.get(step);
  if (hit) return hit;
  const L = lightAt(step / STEPS);
  const n = RGBA.length / 4;
  const base = new Uint32Array(n);
  const lit = new Uint32Array(n);
  const sky = new Map(SKY.map((idx, i) => [idx, i / (SKY.length - 1)]));
  for (let i = 0; i < n; i++) {
    const r = RGBA[i * 4];
    const g = RGBA[i * 4 + 1];
    const b = RGBA[i * 4 + 2];
    const a = RGBA[i * 4 + 3];
    let out: RGB;
    if (EMISSIVE.has(i)) out = [r, g, b];
    else if (sky.has(i)) out = lerp3(L.skyTop, L.skyHorizon, sky.get(i)!);
    else {
      out = [r * L.mul[0] + L.add[0], g * L.mul[1] + L.add[1], b * L.mul[2] + L.add[2]];
      if (i === C.houseWindow) out = lerp3(out, WINDOW_GLOW, Math.min(1, L.darkness * 1.4));
    }
    base[i] = pack(out[0], out[1], out[2], a);
    const warm: RGB = EMISSIVE.has(i) || sky.has(i) ? out : [r * LAMPLIGHT[0], g * LAMPLIGHT[1], b * LAMPLIGHT[2]];
    const l = lerp3(out, warm, 0.8);
    lit[i] = pack(l[0], l[1], l[2], a);
  }
  const pal = { base, lit, darkness: L.darkness };
  cache.set(step, pal);
  return pal;
}
