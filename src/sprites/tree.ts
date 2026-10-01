/**
 * Three representative tree species ported from shan-shui-inf's `Tree`
 * module (tree01/02/03 — the ones mountains actually plant on themselves).
 * Each is a cluster of noise-perturbed `blob` foliage marks around a thin
 * `poly` trunk line; no two trees are identical because every blob redraws
 * its shape from the caller's `rng`.
 */
import type { RNG } from "../core/rng";
import { randGaussian, randChoice } from "../core/rng";
import { blob, poly, type NoiseFn, type Point } from "../core/strokes";

function parseLeafColor(col: string): [string, string, string, string] {
  if (col.startsWith("rgba(")) {
    const parts = col.slice(5, -1).split(",");
    return [parts[0], parts[1], parts[2], parts[3]];
  }
  return ["100", "100", "100", "0.5"];
}

export interface TreeArgs {
  hei?: number;
  wid?: number;
  col?: string;
}

/** A slender tree: a central spine with sparse foliage blobs along the top third. */
export function tree01(x: number, y: number, args: TreeArgs = {}, rng: RNG, noise: NoiseFn): string {
  const hei = args.hei ?? 50;
  const wid = args.wid ?? 3;
  const col = args.col ?? "rgba(100,100,100,0.5)";
  const reso = 10;
  const leafcol = parseLeafColor(col);

  const nslist: Array<[number, number]> = [];
  for (let i = 0; i < reso; i++) nslist.push([noise(i * 0.5), noise(i * 0.5, 0.5)]);

  let canv = "";
  const line1: Point[] = [];
  const line2: Point[] = [];
  for (let i = 0; i < reso; i++) {
    const nx = x;
    const ny = y - (i * hei) / reso;
    if (i >= reso / 4) {
      for (let j = 0; j < (reso - i) / 5; j++) {
        canv += blob(
          nx + (rng() - 0.5) * wid * 1.2 * (reso - i),
          ny + (rng() - 0.5) * wid,
          {
            len: rng() * 20 * (reso - i) * 0.2 + 10,
            wid: rng() * 6 + 3,
            ang: (rng() - 0.5) * (Math.PI / 6),
            col: `rgba(${leafcol[0]},${leafcol[1]},${leafcol[2]},${(rng() * 0.2 + parseFloat(leafcol[3])).toFixed(1)})`,
          },
          rng,
          noise,
        );
      }
    }
    line1.push([nx + (nslist[i][0] - 0.5) * wid - wid / 2, ny]);
    line2.push([nx + (nslist[i][1] - 0.5) * wid + wid / 2, ny]);
  }
  canv += poly(line1, { fil: "none", str: col, wid: 1.5 }) + poly(line2, { fil: "none", str: col, wid: 1.5 });
  return canv;
}

/** A compact round clump of foliage — no trunk, just overlapping blobs. */
export function tree02(x: number, y: number, args: TreeArgs & { clu?: number } = {}, rng: RNG, noise: NoiseFn): string {
  const hei = args.hei ?? 16;
  const wid = args.wid ?? 8;
  const clu = args.clu ?? 5;
  const col = args.col ?? "rgba(100,100,100,0.5)";

  let canv = "";
  for (let i = 0; i < clu; i++) {
    canv += blob(
      x + randGaussian(rng) * clu * 4,
      y + randGaussian(rng) * clu * 4,
      {
        ang: Math.PI / 2,
        wid: rng() * wid * 0.75 + wid * 0.5,
        len: rng() * hei * 0.75 + hei * 0.5,
        col,
        fun: (t: number) =>
          t <= 1 ? Math.pow(Math.sin(t * Math.PI) * t, 0.5) : -Math.pow(Math.sin((t - 2) * Math.PI * (t - 2)), 0.5),
      },
      rng,
      noise,
    );
  }
  return canv;
}

export interface Tree03Args extends TreeArgs {
  ben?: (t: number) => number;
}

/** A leaning tree: like tree01 but its spine bends sideways via `ben`, foliage denser near the base. */
export function tree03(x: number, y: number, args: Tree03Args = {}, rng: RNG, noise: NoiseFn): string {
  const hei = args.hei ?? 50;
  const wid = args.wid ?? 5;
  const ben = args.ben ?? (() => 0);
  const col = args.col ?? "rgba(100,100,100,0.5)";
  const reso = 10;
  const leafcol = parseLeafColor(col);

  const nslist: Array<[number, number]> = [];
  for (let i = 0; i < reso; i++) nslist.push([noise(i * 0.5), noise(i * 0.5, 0.5)]);

  let blobs = "";
  const line1: Point[] = [];
  const line2: Point[] = [];
  const shape = (t: number) => Math.log(50 * t + 1) / 3.95;
  for (let i = 0; i < reso; i++) {
    const nx = x + ben(i / reso) * 100;
    const ny = y - (i * hei) / reso;
    if (i >= reso / 5) {
      for (let j = 0; j < (reso - i) * 2; j++) {
        const ox = rng() * wid * 2 * shape((reso - i) / reso);
        blobs += blob(
          nx + ox * randChoice(rng, [-1, 1]),
          ny + (rng() - 0.5) * wid * 2,
          {
            len: ox * 2,
            wid: rng() * 6 + 3,
            ang: (rng() - 0.5) * (Math.PI / 6),
            col: `rgba(${leafcol[0]},${leafcol[1]},${leafcol[2]},${(rng() * 0.2 + parseFloat(leafcol[3])).toFixed(3)})`,
          },
          rng,
          noise,
        );
      }
    }
    line1.push([nx + (((nslist[i][0] - 0.5) * wid - wid / 2) * (reso - i)) / reso, ny]);
    line2.push([nx + (((nslist[i][1] - 0.5) * wid + wid / 2) * (reso - i)) / reso, ny]);
  }
  const lc = line1.concat(line2.reverse());
  return poly(lc, { fil: "white", str: col, wid: 1.5 }) + blobs;
}
