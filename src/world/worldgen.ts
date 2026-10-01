/**
 * World layout, ported from shan-shui-inf's noise-field `mountplanner` +
 * `chunkloader`. Two deliberate departures from the original, both needed
 * for a bounded-memory infinite scroll (see the plan doc for the full
 * rationale):
 *
 * 1. Every draw gets its own `keyRng(seed, ...)` stream instead of pulling
 *    from one shared, sequentially-advanced `Math.random`. This makes each
 *    placement decision a pure function of its own position, so a chunk can
 *    be regenerated identically at any time without replaying everything
 *    generated before it.
 * 2. `mountplanner` is a pure function of an x-window (padded generously
 *    beyond the window actually returned) rather than a stateful scan that
 *    only ever grows forward/backward one chunk at a time. Peak *detection*
 *    is already a pure function of the noise field in the original, so two
 *    overlapping padded windows agree on candidates near their shared edge;
 *    only the de-duplication/clumping pass (`chadd`) needs that padding to
 *    match what a full-history scan would have decided.
 *
 * Deferred for now (see plan doc): boats and architecture (shan-shui-inf's
 * `Arch` module) — `mountplanner` never emits a `"boat"` item here.
 */
import { keyRng, randChoice } from "../core/rng";
import type { Perlin } from "../core/perlin";
import { mountain, distMount, flatMount } from "../sprites/mountain";
import { water } from "../sprites/water";

export const VIEW_H = 800;
export const CHUNK_W = 512;

const XSTEP = 5;
const MOUNT_WIDTH = 200; // mwid in the source
const PLAN_PAD = 700; // > MOUNT_WIDTH, enough margin for chadd dedup to agree at window edges

export interface ChunkPiece {
  /** World x, used only to decide which chunks a piece belongs to when windowing. */
  x: number;
  /** Painter's-order sort key — smaller is drawn first (further back). */
  y: number;
  svg: string;
}

type PlanTag = "mount" | "distmount" | "flatmount";
interface PlannedItem {
  tag: PlanTag;
  x: number;
  y: number;
}

function noiseFieldFns(noise: Perlin["noise"]) {
  const samp = 0.03;
  return {
    ns: (x: number, y: number) => Math.max(noise(x * samp, y * samp) - 0.55, 0) * 2,
    yr: (x: number) => noise(x * 0.01, Math.PI),
  };
}

function mountplanner(xmin: number, xmax: number, seed: string, perlin: Perlin): PlannedItem[] {
  const noise = perlin.noise.bind(perlin);
  const { ns, yr } = noiseFieldFns(noise);
  const scanMin = xmin - PLAN_PAD;
  const scanMax = xmax + PLAN_PAD;

  function locmax(x: number, y: number, r = 2): boolean {
    const z0 = ns(x, y);
    if (z0 <= 0.3) return false;
    for (let i = x - r; i < x + r; i++) {
      for (let j = y - r; j < y + r; j++) {
        if (ns(i, j) > z0) return false;
      }
    }
    return true;
  }

  const reg: PlannedItem[] = [];
  function chadd(item: PlannedItem, mind = 10): boolean {
    for (const r of reg) if (Math.abs(r.x - item.x) < mind) return false;
    reg.push(item);
    return true;
  }

  const planmtx = new Map<number, number>();
  const cellOf = (x: number) => Math.floor(x / XSTEP);

  for (let i = scanMin; i < scanMax; i += XSTEP) {
    const top = yr(i) * 480;
    for (let j = 0; j < top; j += 30) {
      if (!locmax(i, j)) continue;
      const peakRng = keyRng(seed, "peak", Math.round(i), j);
      const xof = i + 2 * (peakRng() - 0.5) * 500;
      const yof = j + 300;
      if (chadd({ tag: "mount", x: xof, y: yof })) {
        const lo = Math.floor((xof - MOUNT_WIDTH) / XSTEP);
        const hi = Math.floor((xof + MOUNT_WIDTH) / XSTEP);
        for (let k = lo; k < hi; k++) planmtx.set(k, (planmtx.get(k) ?? 0) + 1);
      }
    }
    if (Math.abs(i) % 1000 < Math.max(1, XSTEP - 1)) {
      const distRng = keyRng(seed, "distmount-pos", Math.round(i));
      chadd({ tag: "distmount", x: i, y: 280 - distRng() * 50 });
    }
  }

  for (let i = scanMin; i < scanMax; i += XSTEP) {
    if ((planmtx.get(cellOf(i)) ?? 0) !== 0) continue;
    const flatRng = keyRng(seed, "flatmount-chance", Math.round(i));
    if (flatRng() >= 0.01) continue;
    const n = Math.floor(flatRng() * 4);
    for (let j = 0; j < n; j++) {
      const itemRng = keyRng(seed, "flatmount-pos", Math.round(i), j);
      chadd({ tag: "flatmount", x: i + 2 * (itemRng() - 0.5) * 700, y: 700 - j * 50 });
    }
  }

  return reg.filter((r) => r.x >= xmin && r.x < xmax);
}

function renderItem(item: PlannedItem, seed: string, perlin: Perlin): ChunkPiece[] {
  const noise = perlin.noise.bind(perlin);
  const key = [Math.round(item.x), Math.round(item.y)] as const;

  if (item.tag === "mount") {
    const mountRng = keyRng(seed, "mount", ...key);
    const svg = mountain(item.x, item.y, mountRng() * 200, {}, mountRng, noise);
    const waterRng = keyRng(seed, "water", ...key);
    const wsvg = water(item.x, item.y, {}, waterRng, noise);
    return [
      { x: item.x, y: item.y, svg },
      { x: item.x, y: item.y - 10000, svg: wsvg },
    ];
  }
  if (item.tag === "flatmount") {
    const rng = keyRng(seed, "flatmount", ...key);
    const svg = flatMount(
      item.x,
      item.y,
      rng() * 2 * Math.PI,
      { wid: 600 + rng() * 400, hei: 100, cho: 0.5 + rng() * 0.2 },
      rng,
      noise,
    );
    return [{ x: item.x, y: item.y, svg }];
  }
  // distmount
  const rng = keyRng(seed, "distmount", ...key);
  const svg = distMount(item.x, item.y, rng() * 100, { hei: 150, len: randChoice(rng, [500, 1000, 1500]) }, rng, noise);
  return [{ x: item.x, y: item.y, svg }];
}

/** All ink pieces anchored in world-x chunk `k` (i.e. x in [k*CHUNK_W, (k+1)*CHUNK_W)). */
export function generateChunk(seed: string, k: number, perlin: Perlin): ChunkPiece[] {
  const xmin = k * CHUNK_W;
  const xmax = xmin + CHUNK_W;
  const items = mountplanner(xmin, xmax, seed, perlin);
  const pieces: ChunkPiece[] = [];
  for (const item of items) pieces.push(...renderItem(item, seed, perlin));
  return pieces;
}
