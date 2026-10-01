/**
 * Ink-wash brush primitives, ported from shan-shui-inf's `stroke`/`blob`/
 * `bezmh`/`texture` (see https://github.com/LingDong-/shan-shui-inf). These
 * are the handful of general-purpose building blocks that, reused at
 * different scales, produce mountains, trees, rocks, and water alike:
 *
 * - `stroke`: a centerline whose width is noise-perturbed along its length,
 *   offset left/right and filled as one tapered brush mark.
 * - `blob`: the same idea closed into an organic splotch (foliage, rock fill).
 * - `bezmh`: smooths a coarse polyline into a quadratic-bezier chain before
 *   it's stroked, so silhouettes are never geometrically perfect.
 * - `texture`: scatters hundreds of short `stroke`s across a 2-D mesh of
 *   contour lines — the "cun" shading strokes inside a mountain or rock body.
 *
 * Every function that needs randomness takes an explicit `RNG`/noise
 * function rather than reading a global stream, so any shape can be
 * regenerated on its own (see `core/rng.ts`).
 */
import type { RNG } from "./rng";
import { loopNoise } from "./rng";

export type Point = [number, number];
export type NoiseFn = (x: number, y?: number, z?: number) => number;

export interface PolyArgs {
  xof?: number;
  yof?: number;
  fil?: string;
  str?: string;
  wid?: number;
}

/** Serializes a point list as a filled/stroked SVG `<polyline>`. */
export function poly(plist: Point[], args: PolyArgs = {}): string {
  const xof = args.xof ?? 0;
  const yof = args.yof ?? 0;
  const fil = args.fil ?? "rgba(0,0,0,0)";
  const str = args.str ?? fil;
  const wid = args.wid ?? 0;

  let canv = "<polyline points='";
  for (const [x, y] of plist) {
    canv += " " + (x + xof).toFixed(1) + "," + (y + yof).toFixed(1);
  }
  canv += `' style='fill:${fil};stroke:${str};stroke-width:${wid}'/>`;
  return canv;
}

/** Quadratic-bezier smoothing through control points `P` (Catmull-Rom-ish midpoint chain). */
export function bezmh(P: Point[], w = 1): Point[] {
  if (P.length === 2) {
    P = [P[0], midPt(P[0], P[1]), P[1]];
  }
  const plist: Point[] = [];
  for (let j = 0; j < P.length - 2; j++) {
    const p0 = j === 0 ? P[j] : midPt(P[j], P[j + 1]);
    const p1 = P[j + 1];
    const p2 = j === P.length - 3 ? P[j + 2] : midPt(P[j + 1], P[j + 2]);
    const pl = 20;
    const extra = j === P.length - 3 ? 1 : 0;
    for (let i = 0; i < pl + extra; i++) {
      const t = i / pl;
      const u = Math.pow(1 - t, 2) + 2 * t * (1 - t) * w + t * t;
      plist.push([
        (Math.pow(1 - t, 2) * p0[0] + 2 * t * (1 - t) * p1[0] * w + t * t * p2[0]) / u,
        (Math.pow(1 - t, 2) * p0[1] + 2 * t * (1 - t) * p1[1] * w + t * t * p2[1]) / u,
      ]);
    }
  }
  return plist;
}

export function midPt(...pts: Point[]): Point {
  const list = pts.length === 1 ? (pts[0] as unknown as Point[]) : pts;
  const acc: Point = [0, 0];
  for (const p of list) {
    acc[0] += p[0] / list.length;
    acc[1] += p[1] / list.length;
  }
  return acc;
}

/** Resamples a polyline to `(plist.length-1)*reso + 1` evenly-spaced points. */
export function div(plist: Point[], reso: number): Point[] {
  const tl = (plist.length - 1) * reso;
  const rlist: Point[] = [];
  for (let i = 0; i < tl; i++) {
    const lastp = plist[Math.floor(i / reso)];
    const nextp = plist[Math.ceil(i / reso)];
    const p = (i % reso) / reso;
    rlist.push([lastp[0] * (1 - p) + nextp[0] * p, lastp[1] * (1 - p) + nextp[1] * p]);
  }
  if (plist.length > 0) rlist.push(plist[plist.length - 1]);
  return rlist;
}

export interface StrokeArgs {
  xof?: number;
  yof?: number;
  wid?: number;
  col?: string;
  noi?: number;
  out?: number;
  fun?: (x: number) => number;
}

/** A single tapered, noise-perturbed brush stroke along `ptlist`. */
export function stroke(ptlist: Point[], args: StrokeArgs = {}, rng: RNG, noise: NoiseFn): string {
  const xof = args.xof ?? 0;
  const yof = args.yof ?? 0;
  const wid = args.wid ?? 2;
  const col = args.col ?? "rgba(200,200,200,0.9)";
  const noi = args.noi ?? 0.5;
  const out = args.out ?? 1;
  const fun = args.fun ?? ((x: number) => Math.sin(x * Math.PI));

  if (ptlist.length === 0) return "";

  const vtxlist0: Point[] = [];
  const vtxlist1: Point[] = [];
  const n0 = rng() * 10;
  for (let i = 1; i < ptlist.length - 1; i++) {
    let w = wid * fun(i / ptlist.length);
    w = w * (1 - noi) + w * noi * noise(i * 0.5, n0);
    const a1 = Math.atan2(ptlist[i][1] - ptlist[i - 1][1], ptlist[i][0] - ptlist[i - 1][0]);
    const a2 = Math.atan2(ptlist[i][1] - ptlist[i + 1][1], ptlist[i][0] - ptlist[i + 1][0]);
    let a = (a1 + a2) / 2;
    if (a < a2) a += Math.PI;
    vtxlist0.push([ptlist[i][0] + w * Math.cos(a), ptlist[i][1] + w * Math.sin(a)]);
    vtxlist1.push([ptlist[i][0] - w * Math.cos(a), ptlist[i][1] - w * Math.sin(a)]);
  }

  const vtxlist: Point[] = [ptlist[0], ...vtxlist0, ...vtxlist1.slice().reverse(), ptlist[ptlist.length - 1], ptlist[0]];

  return poly(
    vtxlist.map(([x, y]) => [x + xof, y + yof] as Point),
    { fil: col, str: col, wid: out },
  );
}

export interface BlobArgs {
  len?: number;
  wid?: number;
  ang?: number;
  col?: string;
  noi?: number;
  fun?: (x: number) => number;
}

/** An organic, noise-perturbed filled splotch centered at (x, y). */
export function blob(x: number, y: number, args: BlobArgs = {}, rng: RNG, noise: NoiseFn): string {
  const len = args.len ?? 20;
  const wid = args.wid ?? 5;
  const ang = args.ang ?? 0;
  const col = args.col ?? "rgba(200,200,200,0.9)";
  const noi = args.noi ?? 0.5;
  const fun =
    args.fun ??
    ((x: number) => (x <= 1 ? Math.pow(Math.sin(x * Math.PI), 0.5) : -Math.pow(Math.sin((x + 1) * Math.PI), 0.5)));

  const reso = 20;
  const lalist: Array<[number, number]> = [];
  for (let i = 0; i <= reso; i++) {
    const p = (i / reso) * 2;
    const xo = len / 2 - Math.abs(p - 1) * len;
    const yo = (fun(p) * wid) / 2;
    lalist.push([Math.hypot(xo, yo), Math.atan2(yo, xo)]);
  }

  const n0 = rng() * 10;
  const nslist: number[] = [];
  for (let i = 0; i <= reso; i++) nslist.push(noise(i * 0.05, n0));
  loopNoise(nslist);

  const plist: Point[] = lalist.map(([l, a], i) => {
    const ns = nslist[i] * noi + (1 - noi);
    return [x + Math.cos(a + ang) * l * ns, y + Math.sin(a + ang) * l * ns];
  });

  return poly(plist, { fil: col, str: col, wid: 0 });
}

export interface TextureArgs {
  xof?: number;
  yof?: number;
  tex?: number;
  wid?: number;
  len?: number;
  sha?: number;
  noi?: (layer: number) => number;
  col?: (t: number) => string;
  dis?: () => number;
}

/**
 * Scatters short texture strokes across a mesh of contour layers
 * `ptlist[layer][pos]` — the "cun" shading strokes that fill a mountain or
 * rock's interior. `dis`/`col` close over the same `rng` the caller used to
 * build `ptlist`, so a shape's texture regenerates identically with it.
 */
export function texture(ptlist: Point[][], args: TextureArgs = {}, rng: RNG, noise: NoiseFn): string {
  const xof = args.xof ?? 0;
  const yof = args.yof ?? 0;
  const tex = args.tex ?? 400;
  const wid = args.wid ?? 1.5;
  const len = args.len ?? 0.2;
  const sha = args.sha ?? 0;
  const noi = args.noi ?? ((x: number) => 30 / x);
  const col = args.col ?? (() => `rgba(100,100,100,${(rng() * 0.3).toFixed(3)})`);
  const dis =
    args.dis ??
    (() => (rng() > 0.5 ? (1 / 3) * rng() : (1 * 2) / 3 + (1 / 3) * rng()));

  const reso: [number, number] = [ptlist.length, ptlist[0].length];
  const texlist: Point[][] = [];
  for (let i = 0; i < tex; i++) {
    const mid = (dis() * reso[1]) | 0;
    const hlen = Math.floor(rng() * (reso[1] * len));
    let start = Math.min(Math.max(mid - hlen, 0), reso[1]);
    let end = Math.min(Math.max(mid + hlen, 0), reso[1]);
    const layer = (i / tex) * (reso[0] - 1);

    const row: Point[] = [];
    for (let j = start; j < end; j++) {
      const p = layer - Math.floor(layer);
      const x =
        ptlist[Math.floor(layer)][j][0] * p + ptlist[Math.ceil(layer)][j][0] * (1 - p);
      const y =
        ptlist[Math.floor(layer)][j][1] * p + ptlist[Math.ceil(layer)][j][1] * (1 - p);
      const nx = noi(layer + 1) * (noise(x, j * 0.5) - 0.5);
      const ny = noi(layer + 1) * (noise(y, j * 0.5) - 0.5);
      row.push([x + nx, y + ny]);
    }
    texlist.push(row);
  }

  let canv = "";
  if (sha) {
    for (let j = 0; j < texlist.length; j += 1 + Number(sha !== 0)) {
      canv += stroke(
        texlist[j].map(([x, y]) => [x + xof, y + yof] as Point),
        { col: "rgba(100,100,100,0.1)", wid: sha },
        rng,
        noise,
      );
    }
  }
  for (let j = sha; j < texlist.length; j += 1 + sha) {
    canv += stroke(
      texlist[j].map(([x, y]) => [x + xof, y + yof] as Point),
      { col: col(j / texlist.length), wid },
      rng,
      noise,
    );
  }
  return canv;
}

function sidesOf(plist: Point[]): number[] {
  return plist.map((pt, i) => {
    const np = plist[(i + 1) % plist.length];
    return Math.hypot(np[0] - pt[0], np[1] - pt[1]);
  });
}

function triangleArea(plist: Point[]): number {
  const [a, b, c] = sidesOf(plist);
  const s = (a + b + c) / 2;
  return Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
}

/** Recursively splits a triangle along its longest side until each piece is under area `a`. */
function shatter(plist: Point[], a: number): Point[][] {
  if (plist.length === 0) return [];
  if (triangleArea(plist) < a) return [plist];
  const slist = sidesOf(plist);
  const ind = slist.indexOf(Math.max(...slist));
  const nind = (ind + 1) % plist.length;
  const lind = (ind + 2) % plist.length;
  const mid = midPt(plist[ind], plist[nind]);
  return shatter([plist[ind], mid, plist[lind]], a).concat(shatter([plist[lind], plist[nind], mid], a));
}

/**
 * Ear-clip triangulation of a convex polygon (fan from the first vertex),
 * then `shatter`-subdivide each ear so no triangle exceeds `area`. This is
 * the one case shan-shui-inf's general (non-convex-aware) triangulator is
 * ever called with, so only that path is ported.
 */
export function triangulateConvex(plist: Point[], area: number): Point[][] {
  if (plist.length <= 3) return shatter(plist, area);
  const last = plist[plist.length - 1];
  const ear: Point[] = [last, plist[0], plist[1]];
  const rest = plist.slice(1);
  return shatter(ear, area).concat(triangulateConvex(rest, area));
}
