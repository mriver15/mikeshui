import { describe, it, expect } from "vitest";
import { Pixmap } from "../core/pixmap";
import { Backdrop } from "./backdrop";

const HORIZON = 128;

function render(seed: string, scrollX: number): Pixmap {
  const fb = new Pixmap(700, HORIZON + 2);
  const b = new Backdrop(seed, HORIZON);
  for (let li = 0; li < Backdrop.LAYER_COUNT; li++) b.drawLayer(fb, li, scrollX);
  return fb;
}

describe("Backdrop", () => {
  it("is deterministic for a seed and scroll", () => {
    expect(render("a", 4000).data).toEqual(render("a", 4000).data);
  });

  it("always covers the rows just above the horizon (no gap down to the field)", () => {
    for (const scroll of [0, 1234, 98765]) {
      const fb = render("b", scroll);
      for (let x = 0; x < fb.w; x++) expect(fb.get(x, HORIZON - 1)).not.toBe(0);
    }
  });

  it("is seamless across strip boundaries", () => {
    // draw each layer at two scrolls whose layer-space offsets differ by
    // exactly 1px: every column of the second must equal the next column
    // of the first, including across strip edges
    const b = new Backdrop("c", HORIZON);
    for (let li = 0; li < Backdrop.LAYER_COUNT; li++) {
      let s = 1;
      while (Math.round(s * Backdrop.parallax(li)) !== 1) s++;
      const a1 = new Pixmap(600, HORIZON + 2);
      const a2 = new Pixmap(600, HORIZON + 2);
      b.drawLayer(a1, li, 0);
      b.drawLayer(a2, li, s);
      for (let y = 0; y < a1.h; y++) {
        for (let x = 0; x < a1.w - 1; x++) expect(a2.get(x, y)).toBe(a1.get(x + 1, y));
      }
    }
  });

});
