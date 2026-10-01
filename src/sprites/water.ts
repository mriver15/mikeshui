/**
 * Ripple-stroke water, ported from shan-shui-inf's `water()`: short noise-
 * wobbled horizontal strokes clustered into bands, each band drawn once as
 * a `stroke` at a random low alpha.
 */
import type { RNG } from "../core/rng";
import { stroke, type NoiseFn, type Point } from "../core/strokes";

export interface WaterArgs {
  hei?: number;
  len?: number;
  clu?: number;
}

export function water(xoff: number, yoff: number, args: WaterArgs = {}, rng: RNG, noise: NoiseFn): string {
  const hei = args.hei ?? 2;
  const len = args.len ?? 800;
  const clu = args.clu ?? 10;

  const ptlist: Point[][] = [];
  let yk = 0;
  for (let i = 0; i < clu; i++) {
    const row: Point[] = [];
    const xk = (rng() - 0.5) * (len / 8);
    yk += rng() * 5;
    const lk = len / 4 + rng() * (len / 4);
    const reso = 5;
    for (let j = -lk; j < lk; j += reso) {
      row.push([j + xk, Math.sin(j * 0.2) * hei * noise(j * 0.1) - 20 + yk]);
    }
    ptlist.push(row);
  }

  let canv = "";
  for (let j = 1; j < ptlist.length; j++) {
    canv += stroke(
      ptlist[j].map(([x, y]) => [x + xoff, y + yoff] as Point),
      { col: `rgba(100,100,100,${(0.3 + rng() * 0.3).toFixed(3)})`, wid: 1 },
      rng,
      noise,
    );
  }
  return canv;
}
