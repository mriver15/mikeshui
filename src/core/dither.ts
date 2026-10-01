/**
 * Ordered dithering (Bayer 4x4) for smooth blends between palette colors —
 * the classic 16-bit technique for gradients without introducing new colors.
 */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered-dither threshold in [0,1) for pixel (x, y). */
export function ditherThreshold(x: number, y: number): number {
  return (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
}

/** Pick `a` or `b` proportionally to `t` using ordered dithering. */
export function ditherPick(
  a: number,
  b: number,
  t: number,
  x: number,
  y: number,
): number {
  return t < ditherThreshold(x, y) ? a : b;
}

/** Smoothstep in [0,1] over [a, b]. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
