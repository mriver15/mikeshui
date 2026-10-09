import { describe, it, expect } from "vitest";
import { Pixmap } from "../core/pixmap";
import { CloudSky } from "./clouds";
import { cloudPixmap } from "../sprites/clouds";
import { keyRng } from "../core/prng";

describe("clouds", () => {
  it("draws the same sky for the same seed, scroll and time", () => {
    const a = new Pixmap(800, 128);
    const b = new Pixmap(800, 128);
    new CloudSky("s").draw(a, 1234, 5000);
    new CloudSky("s").draw(b, 1234, 5000);
    expect(a.data).toEqual(b.data);
    expect(a.data.some((c) => c !== 0)).toBe(true);
  });

  it("moves with the world scroll", () => {
    const at = (scroll: number) => {
      const p = new Pixmap(2000, 128);
      new CloudSky("s").draw(p, scroll, 0);
      return p;
    };
    const a = at(0);
    const b = at(100);
    expect(a.data).not.toEqual(b.data);
  });

  it("cloud sprites are non-empty at the requested width", () => {
    for (let i = 0; i < 20; i++) {
      const p = cloudPixmap(keyRng("c", i), 100, i % 3 === 0 ? "stratus" : "cumulus", i % 2 === 0);
      expect(p.w).toBe(100);
      let lowest = -1;
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.get(x, y)) lowest = y;
      expect(lowest).toBeGreaterThan(0);
    }
  });
});
