/**
 * Deterministic pseudo-random number generation.
 *
 * Every brush stroke gets its own keyed RNG stream (`keyRng`) instead of
 * pulling from one shared/global stream the way shan-shui-inf overrides
 * `Math.random`. Same determinism per seed, but position-addressable: any
 * chunk, mountain, or tree can be regenerated identically on its own,
 * without replaying everything generated before it — required for a chunk
 * cache that evicts and later re-creates far-away chunks.
 */

/** FNV-1a 32-bit string hash with a splitmix32 finalizer for proper avalanche. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export type RNG = () => number;

/** Returns a deterministic PRNG in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh, reproducible RNG stream for a (seed, key...) tuple. */
export function keyRng(seed: string, ...keys: Array<string | number>): RNG {
  const key = seed + "|" + keys.join("|");
  return mulberry32(hashString(key));
}

export function mapval(
  value: number,
  istart: number,
  istop: number,
  ostart: number,
  ostop: number,
): number {
  return ostart + (ostop - ostart) * ((value - istart) / (istop - istart));
}

export function distance(p0: [number, number], p1: [number, number]): number {
  return Math.hypot(p0[0] - p1[0], p0[1] - p1[1]);
}

/** Uniform random float in [m, M). */
export function normRand(rng: RNG, m: number, M: number): number {
  return mapval(rng(), 0, 1, m, M);
}

export function randChoice<T>(rng: RNG, arr: readonly T[]): T {
  return arr[Math.floor(arr.length * rng())];
}

/** Rejection-sample x in [0,1) weighted by `func` (must be <= 1 everywhere used). */
export function wtrand(rng: RNG, func: (x: number) => number): number {
  for (;;) {
    const x = rng();
    const y = rng();
    if (y < func(x)) return x;
  }
}

/** Approximate standard-normal sample in (-1, 1), peaked at 0. */
export function randGaussian(rng: RNG): number {
  return wtrand(rng, (x) => Math.pow(Math.E, -24 * Math.pow(x - 0.5, 2))) * 2 - 1;
}

/**
 * Nudges a noise sample list so it loops seamlessly (first and last values
 * match), then renormalizes to [0, 1]. Mutates and returns `list`.
 */
export function loopNoise(list: number[]): number[] {
  const dif = list[list.length - 1] - list[0];
  let lo = 100;
  let hi = -100;
  for (let i = 0; i < list.length; i++) {
    list[i] += (dif * (list.length - 1 - i)) / (list.length - 1);
    if (list[i] < lo) lo = list[i];
    if (list[i] > hi) hi = list[i];
  }
  for (let i = 0; i < list.length; i++) list[i] = mapval(list[i], lo, hi, 0, 1);
  return list;
}
