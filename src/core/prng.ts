/**
 * Deterministic pseudo-random number generation.
 *
 * A tiny, seedable PRNG (mulberry32) plus a string hash so every part of the
 * world — terrain features, chunks, tiles — can be regenerated identically
 * from a single seed string.
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

/** Stateless 2-D world-space noise in [0,1). Seamless across chunk boundaries. */
export function noise2i(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
