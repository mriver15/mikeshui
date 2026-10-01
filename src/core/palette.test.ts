import { describe, it, expect } from "vitest";
import { C, RGBA32, RGBA, SKY } from "./palette";

describe("palette", () => {
  it("stays within the Uint8Array index range Pixmap relies on", () => {
    // Pixmap (core/pixmap.ts) stores palette indices in a Uint8Array, so any
    // index above 255 would silently wrap and corrupt chunk data rather
    // than throwing — this is the one invariant that *must* hold as more
    // colors get added.
    expect(RGBA32.length).toBeLessThanOrEqual(256);
    for (const idx of Object.values(C)) {
      expect(idx).toBeLessThan(256);
    }
  });

  it("every named color resolves to a valid packed RGBA32 entry", () => {
    for (const [name, idx] of Object.entries(C)) {
      const packed = RGBA32[idx];
      expect(packed, `C.${name} -> index ${idx}`).toBeDefined();
      expect(Number.isFinite(packed)).toBe(true);
    }
  });

  it("RGBA and RGBA32 agree on length (4 bytes per packed entry)", () => {
    expect(RGBA.length).toBe(RGBA32.length * 4);
  });

  it("index 0 is transparent (alpha 0) — Pixmap/blit treat 0 as empty", () => {
    expect(C.transparent).toBe(0);
    expect(RGBA32[0]).toBe(0);
  });

  it("the sky gradient has distinct indices from top to horizon", () => {
    expect(SKY.length).toBeGreaterThan(1);
    expect(new Set(SKY).size).toBe(SKY.length);
  });

  it("has no duplicate color names", () => {
    const names = Object.keys(C);
    expect(new Set(names).size).toBe(names.length);
  });
});
