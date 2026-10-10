import { describe, it, expect } from "vitest";
import { findTown } from "./town";

// a synthetic world: one town covering world x in [1024, 3072)
const isCity = (x: number) => x >= 1024 && x < 3072;
const roadYAt = (x: number) => 200 + Math.sin(x / 300) * 10;

describe("findTown", () => {
  it("finds the same town, with the same exact span, from anywhere inside it", () => {
    const a = findTown("t1", 1100, 0, isCity, roadYAt);
    const b = findTown("t1", 3000, 0, isCity, roadYAt);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(a!.start).toBe(1024);
    expect(a!.end).toBe(3072);
  });

  it("returns null outside a town, and honours the margin", () => {
    expect(findTown("t2", 500, 0, isCity, roadYAt)).toBeNull();
    expect(findTown("t2", 1000, 0, isCity, roadYAt)).toBeNull();
    expect(findTown("t2", 1000, 40, isCity, roadYAt)).not.toBeNull();
  });

  it("plans exactly one Poké Center and one Mart, and keeps lots inside town without overlaps", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const town = findTown(seed, 2000, 0, isCity, roadYAt)!;
      const kinds = town.lots.map((l) => l.kind);
      expect(kinds.filter((k) => k === "center")).toHaveLength(1);
      expect(kinds.filter((k) => k === "mart")).toHaveLength(1);
      for (const side of ["north", "south"] as const) {
        const lots = town.lots.filter((l) => l.side === side).sort((p, q) => p.x - q.x);
        for (const lot of lots) {
          expect(lot.x).toBeGreaterThanOrEqual(town.start);
          expect(lot.x + lot.w).toBeLessThanOrEqual(town.end);
        }
        for (let i = 1; i < lots.length; i++) {
          expect(lots[i].x).toBeGreaterThanOrEqual(lots[i - 1].x + lots[i - 1].w);
        }
      }
    }
  });

  it("levels the street to one straight road line", () => {
    const town = findTown("e", 1500, 0, isCity, roadYAt)!;
    expect(town.roadY).toBe(Math.round(roadYAt((town.start + town.end) / 2)));
  });
});

describe("walkerAt", () => {
  const walker = { x0: 100, x1: 220, side: "north" as const, speed: 12, pause: 2, phase: 0.3, id: 1 };

  it("keeps a walker on their stretch, moving smoothly, turning at the ends", async () => {
    const { walkerAt } = await import("./town");
    let prev = walkerAt(walker, 0);
    let turns = 0;
    for (let t = 16; t < 60000; t += 16) {
      const at = walkerAt(walker, t);
      expect(at.x).toBeGreaterThanOrEqual(walker.x0 - 1e-6);
      expect(at.x).toBeLessThanOrEqual(walker.x1 + 1e-6);
      // never teleports: at most a frame's walk between frames
      expect(Math.abs(at.x - prev.x)).toBeLessThanOrEqual(walker.speed * 0.016 + 1e-6);
      if (at.right !== prev.right) turns++;
      prev = at;
    }
    expect(turns).toBeGreaterThan(2);
  });
});
