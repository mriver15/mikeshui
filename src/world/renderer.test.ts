import { describe, it, expect, beforeAll } from "vitest";
import { generateChunk, CHUNK_W } from "./worldgen";

// a minimal canvas stand-in: the renderer only needs a 2D context to
// create and put image data into
let captured: Uint8ClampedArray | null = null;
const ctx = {
  createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: (img: { data: Uint8ClampedArray }) => {
    captured = img.data.slice();
  },
  drawImage() {},
  imageSmoothingEnabled: false,
};
const canvas = () => ({ width: 1, height: 1, getContext: () => ctx });

type RendererCtor = typeof import("./renderer").Renderer;
let Renderer: RendererCtor;
beforeAll(async () => {
  (globalThis as { document?: unknown }).document = { createElement: canvas };
  Renderer = (await import("./renderer")).Renderer;
});

describe("tall-grass encounters", () => {
  const seed = "emerald";
  const k = 1;
  const scroll = k * CHUNK_W;

  it("a tap on a tuft starts an encounter there, a tap on open ground doesn't", () => {
    const r = new Renderer(seed, canvas() as never);
    r.resize(CHUNK_W);
    r.draw(scroll, 0);
    const spot = generateChunk(seed, k).tallGrass[0];
    expect(r.poke(spot.x - scroll + 16, spot.y + 20, scroll, 1000)).toBe(true);
    expect(r.poke(spot.x - scroll + 16, 140, scroll, 1000)).toBe(false);
  });

  it("an encounter changes the frame while it plays and leaves it be afterwards", () => {
    const frame = (poke: boolean, at: number) => {
      const r = new Renderer(seed, canvas() as never);
      r.resize(CHUNK_W);
      r.draw(scroll, 0);
      if (poke) for (const s of generateChunk(seed, k).tallGrass) r.poke(s.x - scroll + 16, s.y + 20, scroll, 1000);
      r.draw(scroll, at);
      return captured!;
    };
    expect(frame(true, 2100)).not.toEqual(frame(false, 2100));
    expect(frame(true, 1000 + 60000)).toEqual(frame(false, 1000 + 60000));
  });
});

describe("hidden items", () => {
  const seed = "emerald";

  function firstItem() {
    for (let k = 0; k < 60; k++) {
      const item = generateChunk(seed, k).items[0];
      if (item) return { k, item };
    }
    throw new Error("no hidden item in the first 60 chunks");
  }

  it("a tap near a hidden item finds it once, and finds can be restored", () => {
    const { k, item } = firstItem();
    const scroll = k * CHUNK_W;
    const r = new Renderer(seed, canvas() as never);
    r.resize(CHUNK_W);
    r.draw(scroll, 0);
    expect(r.poke(item.x + 3, item.y - 2, scroll, 100)).toBe(true);
    expect(r.foundItems()).toEqual([`${scroll + item.x},${item.y}`]);
    // already found: tapping it again doesn't find it a second time
    r.poke(item.x, item.y, scroll, 5000);
    expect(r.foundItems()).toHaveLength(1);

    const again = new Renderer(seed, canvas() as never);
    again.resize(CHUNK_W);
    again.draw(scroll, 0);
    again.restoreFound([`${scroll + item.x},${item.y}`]);
    expect(again.foundItems()).toHaveLength(1);
  });
});
