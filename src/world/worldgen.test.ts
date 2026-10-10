import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { generateChunk, generateForeground, CHUNK_W, VIEW_H, HORIZON } from "./worldgen";
import { C } from "../core/palette";

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
    const { pixmap } = generateChunk("1790824785082", 3);
    expect(pixmap.w).toBe(CHUNK_W);
    expect(pixmap.h).toBe(VIEW_H);
  });

  it("is deterministic: same seed+k produces byte-identical output", () => {
    for (const seed of ["1790824785082", "42"]) {
      for (const k of [0, 1, 5]) {
        const a = generateChunk(seed, k);
        const b = generateChunk(seed, k);
        expect(a.pixmap.data).toEqual(b.pixmap.data);
      }
    }
  });

  it("different seeds produce different worlds (not accidentally constant)", () => {
    const a = generateChunk("seed-a", 0);
    const b = generateChunk("seed-b", 0);
    expect(a.pixmap.data).not.toEqual(b.pixmap.data);
  });

  it("never produces a fully blank chunk (ground/hills always draw something)", () => {
    for (const seed of SEEDS) {
      for (const k of [0, 1, 2]) {
        const { pixmap } = generateChunk(seed, k);
        const nonZero = pixmap.data.some((v: number) => v !== 0);
        expect(nonZero, `seed=${JSON.stringify(seed)} k=${k} was entirely empty`).toBe(true);
      }
    }
  });

  it("tall-grass spots fall within the chunk's own x-span and below the horizon", () => {
    for (const seed of ["1790824785082", "42", "hello world"]) {
      for (const k of [-3, 0, 1, 7]) {
        const { tallGrass } = generateChunk(seed, k);
        for (const spot of tallGrass) {
          expect(spot.x).toBeGreaterThanOrEqual(k * CHUNK_W);
          expect(spot.x).toBeLessThan((k + 1) * CHUNK_W);
          expect(spot.y).toBeGreaterThanOrEqual(0);
          expect(spot.y).toBeLessThan(VIEW_H);
        }
      }
    }
  });

  it("tree/berry-tree spots fall within the chunk's own x-span with a non-empty canopy", () => {
    for (const seed of ["1790824785082", "42", "hello world"]) {
      for (const k of [-3, 0, 1, 7]) {
        const { trees, berryTrees } = generateChunk(seed, k);
        for (const spot of trees) {
          expect(spot.x).toBeGreaterThanOrEqual(k * CHUNK_W);
          expect(spot.x).toBeLessThan((k + 1) * CHUNK_W);
          expect(spot.spec.lobes.length).toBeGreaterThan(0);
          expect(spot.scale).toBeGreaterThan(0);
        }
        for (const spot of berryTrees) {
          expect(spot.x).toBeGreaterThanOrEqual(k * CHUNK_W);
          expect(spot.x).toBeLessThan((k + 1) * CHUNK_W);
        }
      }
    }
  });
});

describe("generateChunk depth buffer", () => {
  it("matches the pixmap size and records every swaying object's depth", () => {
    for (const seed of ["1790824785082", "42", "hello world"]) {
      for (const k of [-3, 0, 1, 7]) {
        const { pixmap, depth, trees, berryTrees, tallGrass } = generateChunk(seed, k);
        expect(depth.length).toBe(pixmap.w * pixmap.h);
        const painted = new Set(depth);
        for (const spot of [...trees, ...berryTrees, ...tallGrass]) {
          expect(spot.depth).toBeGreaterThan(0);
        }
        // a small grass tuft can legitimately end up wholly hidden behind
        // nearer things; a tree never should
        for (const spot of [...trees, ...berryTrees]) {
          expect(painted.has(spot.depth)).toBe(true);
        }
      }
    }
  });

  it("gives nearer (lower on screen) trees a greater depth", () => {
    const { trees } = generateChunk("1790824785082", 7);
    const base = (t: (typeof trees)[number]) => t.y + Math.round(61 * t.scale);
    const byBase = [...trees].sort((a, b) => base(a) - base(b));
    expect(byBase.length).toBeGreaterThan(1);
    for (let i = 1; i < byBase.length; i++) {
      if (base(byBase[i]) === base(byBase[i - 1])) continue;
      expect(byBase[i].depth).toBeGreaterThan(byBase[i - 1].depth);
    }
  });
});

describe("tree variety", () => {
  it("grows both broadleaf and conifer trees across a stretch of world", () => {
    const kinds = new Set<string>();
    for (let k = 0; k < 40; k++) {
      for (const spot of generateChunk("1790824785082", k).trees) kinds.add(spot.spec.kind);
    }
    expect(kinds).toEqual(new Set(["broadleaf", "conifer"]));
  });
});

describe("water", () => {
  it("records in-bounds water spans that are, overall, water", () => {
    // individual spans can be partly hidden — reeds in the shallows, a
    // bush on a pond's near bank standing in front of it — so this checks
    // the spans in aggregate rather than one by one
    const waterColors = new Set([C.water, C.waterLight, C.waterDark]);
    let total = 0;
    let wet = 0;
    for (const seed of ["1790824785082", "42", "emerald"]) {
      for (let k = 0; k < 24; k++) {
        const { pixmap, water } = generateChunk(seed, k);
        expect(water).toHaveLength(CHUNK_W);
        water.forEach((col, lx) => {
          for (const [top, bottom] of col) {
            expect(top).toBeGreaterThan(HORIZON);
            expect(bottom).toBeLessThan(VIEW_H);
            expect(top).toBeLessThanOrEqual(bottom);
            for (let y = top; y <= bottom; y++) {
              total++;
              if (waterColors.has(pixmap.get(lx, y))) wet++;
            }
          }
        });
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(wet / total).toBeGreaterThan(0.9);
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
  const GOLDEN_HASH = "99280b9e54203b4411623623fe23af4a088becf4afa7f92b5d9122707a9c39c5";

  it("matches the recorded golden hash", () => {
    const hash = createHash("sha256");
    for (const seed of GOLDEN_SEEDS) {
      for (const k of GOLDEN_CHUNKS) {
        hash.update(generateChunk(seed, k).pixmap.data);
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
    const { pixmap } = generateForeground("1790824785082", 0);
    expect(pixmap.w).toBe(CHUNK_W);
    expect(pixmap.h).toBe(VIEW_H);
  });

  it("is deterministic", () => {
    const a = generateForeground("1790824785082", 2);
    const b = generateForeground("1790824785082", 2);
    expect(a.pixmap.data).toEqual(b.pixmap.data);
  });
});
