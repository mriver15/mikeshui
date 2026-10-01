import { hashString } from "./prng";

/**
 * 1-D value noise. Terrain curves (path, treeline, lakes, grass tone) are all
 * continuous functions of world x, which keeps chunk boundaries seamless while
 * remaining deterministic per seed.
 */

function hash01(seed: string, n: number): number {
  return hashString(seed + "#" + n) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 1-D value noise in [0, 1). */
export function valueNoise1D(x: number, seed: string): number {
  const x0 = Math.floor(x);
  const t = x - x0;
  const a = hash01(seed, x0);
  const b = hash01(seed, x0 + 1);
  return a + (b - a) * smooth(t);
}

/** Fractal (multi-octave) value noise in [0, 1). */
export function fbm1D(x: number, seed: string, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise1D(x * freq, seed + "o" + i) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
