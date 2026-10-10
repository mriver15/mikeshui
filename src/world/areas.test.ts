import { describe, it, expect } from "vitest";
import { areaAt } from "./worldgen";
import { townName } from "./town";

describe("area names", () => {
  it("routes are numbered stretches of countryside, counting up as you travel", () => {
    const seed = "1790824785082";
    // find two adjacent route areas away from any town
    let x = 0;
    while (areaAt(x, seed).kind !== "route" || areaAt(x + 8192, seed).kind !== "route") x += 8192;
    const a = areaAt(x, seed).title.match(/^ROUTE (\d+)$/);
    const b = areaAt(x + 8192, seed).title.match(/^ROUTE (\d+)$/);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const step = (Number(b![1]) - Number(a![1]) + 34) % 34;
    expect(step).toBe(1);
  });

  it("a town is one area with one name across its whole extent", () => {
    const seed = "emerald";
    let x = 0;
    while (areaAt(x, seed).kind !== "town") x += 64;
    const area = areaAt(x, seed);
    expect(area.title).toMatch(/^[A-Z]+ (TOWN|CITY)$/);
    expect(areaAt(x + 200, seed)).toEqual(area);
  });

  it("generated town names are deterministic and never a series town", () => {
    const series = ["dewford", "mossdeep", "littleroot", "pallet", "lavender"];
    for (let i = 0; i < 2000; i++) {
      const name = townName("s", i * 97);
      expect(name).toBe(townName("s", i * 97));
      expect(series).not.toContain(name.toLowerCase());
      expect(name).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});
