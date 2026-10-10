import { describe, it, expect } from "vitest";
import { dayPalette } from "./daylight";
import { C, RGBA32, SKY } from "./palette";

const lum = (packed: number) => (packed & 0xff) * 0.3 + ((packed >>> 8) & 0xff) * 0.59 + ((packed >>> 16) & 0xff) * 0.11;

describe("dayPalette", () => {
  it("leaves the scene untouched at noon", () => {
    const { base, darkness } = dayPalette(0.5);
    expect(darkness).toBe(0);
    for (let i = 0; i < base.length; i++) {
      if (SKY.includes(i)) continue;
      expect(base[i]).toBe(RGBA32[i]);
    }
  });

  it("darkens the scene at night but keeps light sources bright", () => {
    const night = dayPalette(0);
    expect(night.darkness).toBe(1);
    expect(lum(night.base[C.grass])).toBeLessThan(lum(RGBA32[C.grass]) * 0.6);
    for (const c of [C.lampGlow, C.star, C.moon]) expect(night.base[c]).toBe(RGBA32[c]);
  });

  it("lights house windows after dark", () => {
    expect(lum(dayPalette(0).base[C.houseWindow])).toBeGreaterThan(lum(dayPalette(0).base[C.houseWall]));
  });

  it("lamplight is brighter than the surrounding night", () => {
    const night = dayPalette(0.95);
    expect(lum(night.lit[C.road])).toBeGreaterThan(lum(night.base[C.road]));
  });

  it("wraps phase and is stable across calls", () => {
    expect(dayPalette(1.5).base).toBe(dayPalette(0.5).base);
    expect(dayPalette(-0.25).base).toBe(dayPalette(0.75).base);
  });
});
