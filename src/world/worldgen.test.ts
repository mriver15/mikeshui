import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { generateChunk, generateForeground, CHUNK_W, VIEW_H } from "./worldgen";

const SEEDS = ["1790824785082", "42", "0", "-5", "hello world", "", "💥"];
// Chunk indices spanning both directions and a few multiples of the city/
// forest/route noise wavelength, so this isn't just testing one region type.
const CHUNK_INDICES = [-50, -3, -1, 0, 1, 2, 5, 37, 1000];

describe("generateChunk", () => {
  it("never throws across a spread of seeds and chunk indices", () => {
    for (const seed of SEEDS) {
      for (const k of CHUNK_INDICES) {
        expect(() => generateChunk(seed, k), `seed=${JSON.stringify(seed)} k=${k}`).not.toThrow();
      }
    }
  });

  it("always returns a pixmap of the declared chunk dimensions", () => {
    const pm = generateChunk("1790824785082", 3);
    expect(pm.w).toBe(CHUNK_W);
    expect(pm.h).toBe(VIEW_H);
  });

  it("is deterministic: same seed+k produces byte-identical output", () => {
    for (const seed of ["1790824785082", "42"]) {
      for (const k of [0, 1, 5]) {
        const a = generateChunk(seed, k);
        const b = generateChunk(seed, k);
        expect(a.data).toEqual(b.data);
      }
    }
  });

  it("different seeds produce different worlds (not accidentally constant)", () => {
    const a = generateChunk("seed-a", 0);
    const b = generateChunk("seed-b", 0);
    expect(a.data).not.toEqual(b.data);
  });

  it("never produces a fully blank chunk (ground/hills always draw something)", () => {
    for (const seed of SEEDS) {
      for (const k of [0, 1, 2]) {
        const pm = generateChunk(seed, k);
        const nonZero = pm.data.some((v) => v !== 0);
        expect(nonZero, `seed=${JSON.stringify(seed)} k=${k} was entirely empty`).toBe(true);
      }
    }
  });
});

describe("generateChunk golden hash (refactor-safety net)", () => {
  // Locks in the exact rendered output across a spread of seeds and chunk
  // indices, as a sha256 digest. The point isn't the specific hash — it's
  // that a *pure refactor* (reordering code, extracting config, renaming)
  // should never change this value. It changed zero times across the whole
  // region-config-table extraction that prompted adding this test, which is
  // exactly the guarantee it's meant to give the next refactor too.
  //
  // If you're here because this test failed: that's expected after a
  // deliberate visual/generation change (new decoration, retuned density,
  // etc.) — verify the new output looks right (render it, don't just trust
  // the number), then update GOLDEN_HASH below to the printed "received" value.
  const GOLDEN_SEEDS = ["1790824785082", "42", "0", "hello world"];
  const GOLDEN_CHUNKS = Array.from({ length: 20 }, (_, i) => i - 5); // -5..14
  const GOLDEN_HASH = "afb7ecf1c709ed7b7a059488f52adfc0fe0180c314c97872534956dd57d33e5c";

  it("matches the recorded golden hash", () => {
    const hash = createHash("sha256");
    for (const seed of GOLDEN_SEEDS) {
      for (const k of GOLDEN_CHUNKS) {
        hash.update(generateChunk(seed, k).data);
      }
    }
    expect(hash.digest("hex")).toBe(GOLDEN_HASH);
  });
});

describe("generateForeground", () => {
  it("never throws and matches chunk dimensions", () => {
    for (const seed of SEEDS) {
      for (const k of CHUNK_INDICES) {
        expect(() => generateForeground(seed, k)).not.toThrow();
      }
    }
    const pm = generateForeground("1790824785082", 0);
    expect(pm.w).toBe(CHUNK_W);
    expect(pm.h).toBe(VIEW_H);
  });

  it("is deterministic", () => {
    const a = generateForeground("1790824785082", 2);
    const b = generateForeground("1790824785082", 2);
    expect(a.data).toEqual(b.data);
  });
});
