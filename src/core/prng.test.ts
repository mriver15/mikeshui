import { describe, it, expect } from "vitest";
import { hashString, mulberry32, keyRng, noise2i } from "./prng";

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
  });

  it("gives different strings different hashes", () => {
    expect(hashString("hello")).not.toBe(hashString("world"));
  });

  it("returns a 32-bit unsigned integer", () => {
    const h = hashString("anything");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("stays within [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds diverge", () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });
});

describe("keyRng", () => {
  it("is deterministic for the same seed+keys", () => {
    const a = keyRng("world-seed", "trees", 4, 2)();
    const b = keyRng("world-seed", "trees", 4, 2)();
    expect(a).toBe(b);
  });

  it("different keys give different streams (no accidental collisions for nearby keys)", () => {
    const a = keyRng("world-seed", "trees", 4)();
    const b = keyRng("world-seed", "trees", 5)();
    expect(a).not.toBe(b);
  });

  it("is sensitive to the role string, not just the numeric keys", () => {
    const a = keyRng("world-seed", "trees", 1)();
    const b = keyRng("world-seed", "bushes", 1)();
    expect(a).not.toBe(b);
  });
});

describe("noise2i", () => {
  it("is a pure function of (seed, x, y) — same inputs, same output", () => {
    expect(noise2i(7, 100, -40)).toBe(noise2i(7, 100, -40));
  });

  it("stays within [0, 1)", () => {
    for (let x = -5; x < 5; x++) {
      for (let y = -5; y < 5; y++) {
        const v = noise2i(42, x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});
