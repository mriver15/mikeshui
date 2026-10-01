/**
 * Classic (improved) Perlin noise — the exact algorithm shan-shui-inf uses
 * (itself ported from p5.js), 2D/3D, 4 octaves with 0.5 amplitude falloff.
 * This is what gives mountain silhouettes, texture strokes, and object
 * placement their organic, non-repeating character — 1-D value noise is not
 * a substitute.
 *
 * One `Perlin` instance (and its permutation table) is shared across an
 * entire painting so noise is continuous across chunk boundaries; its table
 * is seeded once from the painting seed via `mulberry32`, not from
 * `Math.random`, so it never depends on call order.
 */
import { mulberry32, hashString, type RNG } from "./rng";

const PERLIN_YWRAPB = 4;
const PERLIN_YWRAP = 1 << PERLIN_YWRAPB;
const PERLIN_ZWRAPB = 8;
const PERLIN_ZWRAP = 1 << PERLIN_ZWRAPB;
const PERLIN_SIZE = 4095;
const OCTAVES = 4;
const AMP_FALLOFF = 0.5;

function scaledCosine(i: number): number {
  return 0.5 * (1 - Math.cos(i * Math.PI));
}

export class Perlin {
  private table: Float64Array;

  constructor(seed: string) {
    const rng: RNG = mulberry32(hashString(seed + ":perlin"));
    this.table = new Float64Array(PERLIN_SIZE + 1);
    for (let i = 0; i <= PERLIN_SIZE; i++) this.table[i] = rng();
  }

  /** Perlin noise, commonly in [0, 1]. */
  noise(x: number, y = 0, z = 0): number {
    const p = this.table;
    x = Math.abs(x);
    y = Math.abs(y);
    z = Math.abs(z);

    let xi = Math.floor(x);
    let yi = Math.floor(y);
    let zi = Math.floor(z);
    let xf = x - xi;
    let yf = y - yi;
    let zf = z - zi;

    let r = 0;
    let ampl = 0.5;

    for (let o = 0; o < OCTAVES; o++) {
      let of = xi + (yi << PERLIN_YWRAPB) + (zi << PERLIN_ZWRAPB);
      const rxf = scaledCosine(xf);
      const ryf = scaledCosine(yf);

      let n1 = p[of & PERLIN_SIZE];
      n1 += rxf * (p[(of + 1) & PERLIN_SIZE] - n1);
      let n2 = p[(of + PERLIN_YWRAP) & PERLIN_SIZE];
      n2 += rxf * (p[(of + PERLIN_YWRAP + 1) & PERLIN_SIZE] - n2);
      n1 += ryf * (n2 - n1);

      of += PERLIN_ZWRAP;
      n2 = p[of & PERLIN_SIZE];
      n2 += rxf * (p[(of + 1) & PERLIN_SIZE] - n2);
      let n3 = p[(of + PERLIN_YWRAP) & PERLIN_SIZE];
      n3 += rxf * (p[(of + PERLIN_YWRAP + 1) & PERLIN_SIZE] - n3);
      n2 += ryf * (n3 - n2);

      n1 += scaledCosine(zf) * (n2 - n1);

      r += n1 * ampl;
      ampl *= AMP_FALLOFF;
      xi <<= 1;
      xf *= 2;
      yi <<= 1;
      yf *= 2;
      zi <<= 1;
      zf *= 2;
      if (xf >= 1) {
        xi++;
        xf--;
      }
      if (yf >= 1) {
        yi++;
        yf--;
      }
      if (zf >= 1) {
        zi++;
        zf--;
      }
    }
    return r;
  }
}
