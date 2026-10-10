import { describe, it, expect } from "vitest";
import { Pixmap } from "../core/pixmap";
import { C } from "../core/palette";
import { SkyFauna } from "./fauna";

function fly(seed: string, darkness: number, ms: number): Pixmap[] {
  const sky = new SkyFauna(seed);
  const frames: Pixmap[] = [];
  for (let t = 0; t <= ms; t += 16) {
    const fb = new Pixmap(480, 130);
    sky.draw(fb, 1000, t, darkness);
    if (t % 2000 < 16) frames.push(fb);
  }
  return frames;
}

describe("SkyFauna", () => {
  it("sends flocks across the sky within a minute, by day and by night", () => {
    for (const darkness of [0, 1]) {
      const seen = fly("emerald", darkness, 60000).some((fb) => fb.data.includes(C.silhouette));
      expect(seen).toBe(true);
    }
  });

  it("is deterministic for the same seed, scroll and timeline", () => {
    const a = fly("s", 0, 30000);
    const b = fly("s", 0, 30000);
    a.forEach((fb, i) => expect(fb.data).toEqual(b[i].data));
  });

  it("keeps to the sky", () => {
    for (const fb of fly("emerald", 0, 60000)) {
      for (let y = 100; y < fb.h; y++) {
        for (let x = 0; x < fb.w; x++) expect(fb.get(x, y)).toBe(0);
      }
    }
  });
});
