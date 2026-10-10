import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";

/**
 * Silhouettes of things in the sky — small birds, a large soaring bird,
 * bats — each a short cycle of wing poses. Original, generic shapes, all
 * in one flat silhouette color.
 */
export type FlyerKind = "bird" | "soarer" | "bat";

/** Wing poses per kind, as rows of '#' (filled) and '.' (clear). */
const POSES: Record<FlyerKind, string[][]> = {
  bird: [
    ["#...#", ".#.#.", "..#.."],
    ["##.##", "..#.."],
    ["..#..", ".#.#.", "#...#"],
  ],
  soarer: [
    ["#.......#", ".##...##.", "...###...", "....#...."],
    ["###.#.###", "...###...", "....#...."],
    ["....#....", "...###...", ".##...##.", "#.......#"],
  ],
  bat: [
    ["#.....#", "##.#.##", ".#####.", "..#.#.."],
    ["..#.#..", "#######", "#.#.#.#"],
  ],
};

const cache = new Map<string, Pixmap>();

/** The silhouette sprite for a kind in a given wing pose (wraps), in `color`. */
export function flyerPixmap(kind: FlyerKind, pose: number, color = C.silhouette): Pixmap {
  const poses = POSES[kind];
  const i = ((pose % poses.length) + poses.length) % poses.length;
  const key = `${kind}:${i}:${color}`;
  let p = cache.get(key);
  if (!p) {
    const rows = poses[i];
    p = new Pixmap(rows[0].length, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === "#") p!.set(x, y, color);
    });
    cache.set(key, p);
  }
  return p;
}

/** How many wing poses a kind cycles through. */
export function poseCount(kind: FlyerKind): number {
  return POSES[kind].length;
}
