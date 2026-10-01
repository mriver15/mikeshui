/**
 * Mountains and rocks, ported from shan-shui-inf's `Mount` module:
 * `mountain` (the layered-ridge silhouette with texture strokes and trees
 * growing on it), `distMount` (hazy triangulated-gradient distant range),
 * `flatMount` (a mesa with a flat top), and `rock`.
 *
 * Simplification from the source: `flatMount`'s top-of-mesa decoration
 * (`flatDec`) only scatters `rock()` there, skipping the original's
 * buildings/pagodas (`Arch` module) and `tree08` clustering — those are
 * deferred along with the rest of `Arch`/`Man`, not part of the core
 * mountain/water/tree quality bar.
 */
import type { RNG } from "../core/rng";
import { randChoice, normRand, loopNoise } from "../core/rng";
import { poly, stroke, texture, div, midPt, triangulateConvex, type NoiseFn, type Point } from "../core/strokes";
import { tree01, tree02, tree03 } from "./tree";

function foot(ptlist: Point[][], xof: number, yof: number, rng: RNG, noise: NoiseFn): string {
  const ftlist: Point[][] = [];
  const span = 10;
  let ni = 0;
  for (let i = 0; i < ptlist.length - 2; i++) {
    if (i !== ni) continue;
    ni = Math.min(ni + randChoice(rng, [1, 2]), ptlist.length - 1);

    const left: Point[] = [];
    const right: Point[] = [];
    const n = Math.min(ptlist[i].length / 8, 10);
    for (let j = 0; j < n; j++) {
      left.push([ptlist[i][j][0] + noise(j * 0.1, i) * 10, ptlist[i][j][1]]);
      right.push([ptlist[i][ptlist[i].length - 1 - j][0] - noise(j * 0.1, i) * 10, ptlist[i][ptlist[i].length - 1 - j][1]]);
    }
    left.reverse();
    right.reverse();

    for (let j = 0; j < span; j++) {
      const p = j / span;
      const x1 = ptlist[i][0][0] * (1 - p) + ptlist[ni][0][0] * p;
      let y1 = ptlist[i][0][1] * (1 - p) + ptlist[ni][0][1] * p;
      const x2 = ptlist[i][ptlist[i].length - 1][0] * (1 - p) + ptlist[ni][ptlist[i].length - 1][0] * p;
      let y2 = ptlist[i][ptlist[i].length - 1][1] * (1 - p) + ptlist[ni][ptlist[i].length - 1][1] * p;
      const vib = -1.7 * (p - 1) * Math.pow(p, 1 / 5);
      y1 += vib * 5 + noise(0, i) * 5;
      y2 += vib * 5 + noise(0, i) * 5;
      left.push([x1, y1]);
      right.push([x2, y2]);
    }
    ftlist.push(left, right);
  }

  let canv = "";
  for (const f of ftlist) canv += poly(f, { xof, yof, fil: "white", str: "none" });
  for (const f of ftlist) {
    canv += stroke(
      f.map(([x, y]) => [x + xof, y + yof] as Point),
      { col: `rgba(100,100,100,${(0.1 + rng() * 0.1).toFixed(3)})`, wid: 1 },
      rng,
      noise,
    );
  }
  return canv;
}

/** Places `treeFunc` at mesh points where `growthRule(i, j)` passes `proofRule`. */
function vegetate(
  ptlist: Point[][],
  treeFunc: (x: number, y: number) => string,
  growthRule: (i: number, j: number) => boolean,
  proofRule: (veglist: Point[], i: number) => boolean,
): string {
  const veglist: Point[] = [];
  for (let i = 0; i < ptlist.length; i++) {
    for (let j = 0; j < ptlist[i].length; j++) {
      if (growthRule(i, j)) veglist.push([ptlist[i][j][0], ptlist[i][j][1]]);
    }
  }
  let canv = "";
  for (let i = 0; i < veglist.length; i++) {
    if (proofRule(veglist, i)) canv += treeFunc(veglist[i][0], veglist[i][1]);
  }
  return canv;
}

export interface MountainArgs {
  hei?: number;
  wid?: number;
  tex?: number;
  veg?: boolean;
  col?: (x: number) => string;
}

export function mountain(xoff: number, yoff: number, seed: number, args: MountainArgs = {}, rng: RNG, noise: NoiseFn): string {
  const h = args.hei ?? 100 + rng() * 400;
  const w = args.wid ?? 400 + rng() * 200;
  const tex = args.tex ?? 200;
  const veg = args.veg ?? true;
  const col = args.col;

  const reso: [number, number] = [10, 50];
  const ptlist: Point[][] = [];
  let hoff = 0;
  for (let j = 0; j < reso[0]; j++) {
    hoff += (rng() * yoff) / 100;
    const row: Point[] = [];
    for (let i = 0; i < reso[1]; i++) {
      const x = (i / reso[1] - 0.5) * Math.PI;
      let y = Math.cos(x);
      y *= noise(x + 10, j * 0.15, seed);
      const p = 1 - j / reso[0];
      row.push([(x / Math.PI) * w * p, -y * h * p + hoff]);
    }
    ptlist.push(row);
  }

  let canv = "";

  // RIM — sparse clumps right on the silhouette edge
  canv += vegetate(
    ptlist,
    (x, y) =>
      tree02(x + xoff, y + yoff - 5, { col: `rgba(100,100,100,${(noise(0.01 * x, 0.01 * y) * 0.5 * 0.3 + 0.5).toFixed(3)})`, clu: 2 }, rng, noise),
    (i, j) => {
      const ns = noise(j * 0.1, seed);
      return i === 0 && ns * ns * ns < 0.1 && Math.abs(ptlist[i][j][1]) / h > 0.2;
    },
    () => true,
  );

  canv += poly(ptlist[0].concat([[0, reso[0] * 4]]), { xof: xoff, yof: yoff, fil: "white", str: "none" });
  canv += stroke(
    ptlist[0].map(([x, y]) => [x + xoff, y + yoff] as Point),
    { col: "rgba(100,100,100,0.3)", noi: 1, wid: 3 },
    rng,
    noise,
  );
  canv += foot(ptlist, xoff, yoff, rng, noise);
  canv += texture(ptlist, { xof: xoff, yof: yoff, tex, sha: randChoice(rng, [0, 0, 0, 0, 5]), col }, rng, noise);

  // TOP — clumps scattered high on the peak
  canv += vegetate(
    ptlist,
    (x, y) => tree02(x + xoff, y + yoff, { col: `rgba(100,100,100,${(noise(0.01 * x, 0.01 * y) * 0.5 * 0.3 + 0.5).toFixed(3)})` }, rng, noise),
    (i, j) => {
      const ns = noise(i * 0.1, j * 0.1, seed + 2);
      return ns * ns * ns < 0.1 && Math.abs(ptlist[i][j][1]) / h > 0.5;
    },
    () => true,
  );

  if (veg) {
    // MIDDLE — self-reinforcing clustering: only keeps points with >2 neighbors within 30px
    canv += vegetate(
      ptlist,
      (x, y) => {
        let ht = ((h + y) / h) * 70;
        ht = ht * 0.3 + rng() * ht * 0.7;
        return tree01(x + xoff, y + yoff, { hei: ht, wid: rng() * 3 + 1, col: `rgba(100,100,100,${(noise(0.01 * x, 0.01 * y) * 0.5 * 0.3 + 0.3).toFixed(3)})` }, rng, noise);
      },
      (i, j) => {
        const ns = noise(i * 0.2, j * 0.05, seed);
        return Boolean(j % 2) && ns * ns * ns * ns < 0.012 && Math.abs(ptlist[i][j][1]) / h < 0.3;
      },
      (veglist, i) => {
        let counter = 0;
        for (let j = 0; j < veglist.length; j++) {
          if (i !== j && Math.pow(veglist[i][0] - veglist[j][0], 2) + Math.pow(veglist[i][1] - veglist[j][1], 2) < 30 * 30) {
            counter++;
          }
          if (counter > 2) return true;
        }
        return false;
      },
    );

    // BOTTOM — leaning trees at the mountain's two feet
    canv += vegetate(
      ptlist,
      (x, y) => {
        let ht = ((h + y) / h) * 120;
        ht = ht * 0.5 + rng() * ht * 0.5;
        const bc = rng() * 0.1;
        return tree03(x + xoff, y + yoff, { hei: ht, ben: (t) => Math.pow(t * bc, 1), col: `rgba(100,100,100,${(noise(0.01 * x, 0.01 * y) * 0.5 * 0.3 + 0.3).toFixed(3)})` }, rng, noise);
      },
      (i, j) => {
        const ns = noise(i * 0.2, j * 0.05, seed);
        return (j === 0 || j === ptlist[i].length - 1) && ns * ns * ns * ns < 0.012;
      },
      () => true,
    );
  }

  return canv;
}

export interface DistMountArgs {
  hei?: number;
  len?: number;
  seg?: number;
}

/** A hazy, far-off mountain band rendered as triangulated grayscale fill (no strokes). */
export function distMount(xoff: number, yoff: number, seed: number, args: DistMountArgs = {}, _rng: RNG, noise: NoiseFn): string {
  const hei = args.hei ?? 300;
  const len = args.len ?? 2000;
  const seg = args.seg ?? 5;
  const span = 10;

  const getCol = (x: number, y: number) => {
    const c = (noise(x * 0.02, y * 0.02, yoff) * 55 + 200) | 0;
    return `rgb(${c},${c},${c})`;
  };

  let canv = "";
  for (let i = 0; i < len / span / seg; i++) {
    const row: Point[] = [];
    for (let j = 0; j < seg + 1; j++) {
      const k = i * seg + j;
      row.push([xoff + k * span, yoff - hei * noise(k * 0.05, seed) * Math.pow(Math.sin((Math.PI * k) / (len / span)), 0.5)]);
    }
    for (let j = 0; j < seg / 2 + 1; j++) {
      const k = i * seg + j * 2;
      row.unshift([xoff + k * span, yoff + 24 * noise(k * 0.05, 2, seed) * Math.sin((Math.PI * k) / (len / span))]);
    }

    canv += poly(row, { fil: getCol(...row[row.length - 1]), str: "none", wid: 1 });
    for (const tri of triangulateConvex(row, 100)) {
      const [mx, my] = midPt(...tri);
      const co = getCol(mx, my);
      canv += poly(tri, { fil: co, str: co, wid: 1 });
    }
  }
  return canv;
}

export interface RockArgs {
  hei?: number;
  wid?: number;
  tex?: number;
  sha?: number;
}

export function rock(xoff: number, yoff: number, seed: number, args: RockArgs = {}, rng: RNG, noise: NoiseFn): string {
  const hei = args.hei ?? 80;
  const wid = args.wid ?? 100;
  const tex = args.tex ?? 40;
  const sha = args.sha ?? 10;

  const reso: [number, number] = [10, 50];
  const ptlist: Point[][] = [];
  for (let i = 0; i < reso[0]; i++) {
    const nslist: number[] = [];
    for (let j = 0; j < reso[1]; j++) nslist.push(noise(i, j * 0.2, seed));
    loopNoise(nslist);

    const row: Point[] = [];
    for (let j = 0; j < reso[1]; j++) {
      const a = (j / reso[1]) * Math.PI * 2 - Math.PI / 2;
      let l = (wid * hei) / Math.sqrt(Math.pow(hei * Math.cos(a), 2) + Math.pow(wid * Math.sin(a), 2));
      l *= 0.7 + 0.3 * nslist[j];
      const p = 1 - i / reso[0];
      let nx = Math.cos(a) * l * p;
      let ny = -Math.sin(a) * l * p;
      if (Math.PI < a || a < 0) ny *= 0.2;
      ny += hei * (i / reso[0]) * 0.2;
      row.push([nx, ny]);
    }
    ptlist.push(row);
  }

  let canv = poly(ptlist[0].concat([[0, 0]]), { xof: xoff, yof: yoff, fil: "white", str: "none" });
  canv += stroke(
    ptlist[0].map(([x, y]) => [x + xoff, y + yoff] as Point),
    { col: "rgba(100,100,100,0.3)", noi: 1, wid: 3 },
    rng,
    noise,
  );
  canv += texture(
    ptlist,
    {
      xof: xoff,
      yof: yoff,
      tex,
      wid: 3,
      sha,
      col: () => `rgba(180,180,180,${(0.3 + rng() * 0.3).toFixed(3)})`,
      dis: () => (rng() > 0.5 ? 0.15 + 0.15 * rng() : 0.85 - 0.15 * rng()),
    },
    rng,
    noise,
  );
  return canv;
}

export interface FlatMountArgs {
  hei?: number;
  wid?: number;
  tex?: number;
  cho?: number;
}

export function flatMount(xoff: number, yoff: number, seed: number, args: FlatMountArgs = {}, rng: RNG, noise: NoiseFn): string {
  const hei = args.hei ?? 40 + rng() * 400;
  const wid = args.wid ?? 400 + rng() * 200;
  const tex = args.tex ?? 80;
  const cho = args.cho ?? 0.5;

  const reso: [number, number] = [5, 50];
  const ptlist: Point[][] = [];
  const flat: Point[][] = [];
  let hoff = 0;
  for (let j = 0; j < reso[0]; j++) {
    hoff += (rng() * yoff) / 100;
    const prow: Point[] = [];
    const frow: Point[] = [];
    for (let i = 0; i < reso[1]; i++) {
      const x = (i / reso[1] - 0.5) * Math.PI;
      let y = Math.cos(x * 2) + 1;
      y *= noise(x + 10, j * 0.1, seed);
      const p = 1 - (j / reso[0]) * 0.6;
      const nx = (x / Math.PI) * wid * p;
      let ny = -y * hei * p + hoff;
      const h0 = 100;
      if (ny < -h0 * cho + hoff) {
        ny = -h0 * cho + hoff;
        if (frow.length % 2 === 0) frow.push([nx, ny]);
      } else if (frow.length % 2 === 1) {
        frow.push(prow[prow.length - 1]);
      }
      prow.push([nx, ny]);
    }
    ptlist.push(prow);
    flat.push(frow);
  }

  let canv = poly(ptlist[0].concat([[0, reso[0] * 4]]), { xof: xoff, yof: yoff, fil: "white", str: "none" });
  canv += stroke(
    ptlist[0].map(([x, y]) => [x + xoff, y + yoff] as Point),
    { col: "rgba(100,100,100,0.3)", noi: 1, wid: 3 },
    rng,
    noise,
  );
  canv += texture(
    ptlist,
    { xof: xoff, yof: yoff, tex, wid: 2, dis: () => (rng() > 0.5 ? 0.1 + 0.4 * rng() : 0.9 - 0.4 * rng()) },
    rng,
    noise,
  );

  const grlist1: Point[] = [];
  const grlist2: Point[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    if (flat[i].length >= 2) {
      grlist1.push(flat[i][0]);
      grlist2.push(flat[i][flat[i].length - 1]);
    }
  }
  if (grlist1.length === 0) return canv;

  const wb0: [number, number] = [grlist1[0][0], grlist2[0][0]];
  for (let i = 0; i < 3; i++) {
    const p = 0.8 - i * 0.2;
    grlist1.unshift([wb0[0] * p, grlist1[0][1] - 5]);
    grlist2.unshift([wb0[1] * p, grlist2[0][1] - 5]);
  }
  const wb1: [number, number] = [grlist1[grlist1.length - 1][0], grlist2[grlist2.length - 1][0]];
  for (let i = 0; i < 3; i++) {
    const p = 0.6 - i * i * 0.1;
    grlist1.push([wb1[0] * p, grlist1[grlist1.length - 1][1] + 1]);
    grlist2.push([wb1[1] * p, grlist2[grlist2.length - 1][1] + 1]);
  }

  const d = 5;
  const dg1 = div(grlist1, d).reverse();
  const dg2 = div(grlist2, d);
  const grlist = dg1.concat(dg2, [dg1[0]]);
  for (let i = 0; i < grlist.length; i++) {
    const v = (1 - Math.abs((i % d) - d / 2) / (d / 2)) * 0.12;
    grlist[i][0] *= 1 - v + noise(grlist[i][1] * 0.5) * v;
  }

  canv += poly(grlist, { xof: xoff, yof: yoff, str: "none", fil: "white", wid: 2 });
  canv += stroke(
    grlist.map(([x, y]) => [x + xoff, y + yoff] as Point),
    { wid: 3, col: "rgba(100,100,100,0.2)" },
    rng,
    noise,
  );

  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of grlist) {
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }

  // Simplified flatDec: scatter rocks on the plateau (Arch/tree08 deferred).
  const nRocks = Math.floor(rng() * 5);
  for (let j = 0; j < nRocks; j++) {
    canv += rock(
      xoff + normRand(rng, xmin, xmax),
      yoff + (ymin + ymax) / 2 + normRand(rng, -10, 10) + 10,
      rng() * 100,
      { wid: 10 + rng() * 20, hei: 10 + rng() * 20, sha: 2 },
      rng,
      noise,
    );
  }
  return canv;
}
