/**
 * Authentic GBA Pokémon Ruby/Sapphire/Emerald exterior palette (56 colors from
 * the pokeruby disassembly, via Lospec). Index 0 is reserved as transparent.
 * Sky is generated as a smooth gradient; `SKY` holds those indices top→horizon.
 * `RGBA32` is the palette packed as little-endian RGBA uint32 for fast blits.
 */

type RGBA = [number, number, number, number];

function hex(h: string): RGBA {
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    255,
  ];
}

const NAMED: Array<[string, RGBA]> = [
  ["transparent", [0, 0, 0, 0]],
  ["outline", hex("413931")],
  ["black", hex("000000")],
  ["cloud", hex("ffffff")],
  ["cloudShade", hex("bdcde6")],
  // a half-step between sunlit white and cloudShade, and the cool shadowed
  // underside of a cumulus — so clouds can be shaded in bands like the
  // tree puffs rather than as a flat white shape on a gray shadow
  ["cloudMid", hex("e6eef8")],
  ["cloudUnder", hex("a4bcdc")],
  // Mid-hill greens sit a step cooler/lighter than the foreground tree
  // greens below (rather than being the literal same color) — a cheap
  // atmospheric-perspective cue so the hill band reads as further away.
  ["treeline", hex("4f9a60")],
  ["treelineDark", hex("336024")],
  ["treelineHaze", hex("73c5a4")],
  ["treelineHazeLight", hex("9adfc2")],
  ["treelineHazeDark", hex("5aa588")],
  // distant mountains: blue-gray and hazy, so they sit behind the green
  // hill bands — lit face, shadowed face, and a pale sunlit ridge line
  ["mountainLight", hex("a9bfe0")],
  ["mountain", hex("8aa3cf")],
  ["mountainDark", hex("6c84b6")],
  ["grass", hex("398b31")],
  ["grassLight", hex("83c562")],
  ["grassBright", hex("b4ff83")],
  ["grassDark", hex("395200")],
  ["tallGrass", hex("395200")],
  ["tallGrassLight", hex("83c562")],
  ["water", hex("528bc5")],
  ["waterLight", hex("62acee")],
  ["waterBright", hex("73bdf6")],
  ["waterDark", hex("4a73ac")],
  ["waterDeep", hex("293962")],
  ["shore", hex("cd9c52")],
  ["path", hex("deb4a4")],
  ["pathLight", hex("eed5cd")],
  ["pathDark", hex("bd948b")],
  ["pathEdge", hex("a4625a")],
  ["road", hex("bdbdbd")],
  ["roadDark", hex("a4a4a4")],
  ["roadLight", hex("d5d5d5")],
  ["tree", hex("398b31")],
  ["treeLight", hex("83c562")],
  ["treeBright", hex("b4ff83")],
  ["treeDark", hex("395200")],
  ["trunk", hex("6a5a5a")],
  ["trunkDark", hex("413931")],
  ["flowerRed", hex("cd4152")],
  ["flowerYellow", hex("ffc55a")],
  ["flowerWhite", hex("ffffff")],
  ["flowerOrange", hex("ee9473")],
  ["houseWall", hex("dee6ee")],
  ["houseWallShade", hex("bdbdbd")],
  ["houseRoof", hex("c54141")],
  ["houseRoofDark", hex("7b4141")],
  ["houseRoofLight", hex("ff625a")],
  ["houseDoor", hex("413931")],
  ["houseWindow", hex("62acee")],
  ["houseTrim", hex("ffffff")],
  ["roofOrange", hex("e0935a")],
  ["roofOrangeDark", hex("b8703f")],
  ["roofOrangeLight", hex("f6c190")],
  ["roofGreen", hex("41b483")],
  ["roofGreenDark", hex("2d7d5c")],
  ["wallTan", hex("e8d8a8")],
  ["wallTanShade", hex("c5b480")],
  ["wood", hex("6a5a5a")],
  ["woodDark", hex("413931")],
  ["sign", hex("dee6ee")],
  ["berry", hex("cd4152")],
  ["berryGreen", hex("41b483")],
  ["skin", hex("ffd5b4")],
  ["skinShade", hex("ffbd83")],
  // light sources: these keep their color through dusk and night instead
  // of being tinted with the rest of the scene (see core/daylight.ts)
  ["lampGlow", hex("ffe8a0")],
  ["star", hex("fff6dc")],
  ["moon", hex("f4f0d8")],
  // on-screen UI (the location banner): also exempt from time-of-day
  // tinting, so it reads the same at noon and midnight
  ["uiWood", hex("b0764a")],
  ["uiWoodDark", hex("6e4426")],
  ["uiStone", hex("7f9cc4")],
  ["uiStoneDark", hex("47628a")],
  ["uiFill", hex("f8f0d8")],
  ["uiText", hex("40382e")],
  ["uiShadow", hex("1a1a22")],
  // birds and bats against the sky: a near-black silhouette that stays
  // the same at every hour, so it reads against noon blue and night navy
  ["silhouette", hex("181826")],
  // rain streaks and splashes (tinted with the hour like the scene)
  ["rain", hex("b8cce0")],
  // beach sand: dry sand, its ripple shadows, and sun-bleached highlights
  ["sand", hex("e8d4a0")],
  ["sandDark", hex("cdb47c")],
  ["sandLight", hex("f6e8c4")],
];

export const SKY_TOP = hex("62a4de");
export const SKY_HORIZON = hex("dee6ee");
const SKY_STEPS = 16;

/** Flattened RGBA bytes indexed by palette index. */
export const RGBA: Uint8ClampedArray = new Uint8ClampedArray(
  (NAMED.length + SKY_STEPS) * 4,
);

/** Palette packed as little-endian RGBA uint32, indexed by palette index. */
export const RGBA32: Uint32Array = new Uint32Array(NAMED.length + SKY_STEPS);

/** Named color -> palette index lookup. */
export const C: Record<string, number> = {};

/** Sky gradient palette indices, top -> horizon. */
export const SKY: number[] = [];

function pack(rgba: RGBA): number {
  return ((rgba[3] << 24) | (rgba[2] << 16) | (rgba[1] << 8) | rgba[0]) >>> 0;
}

let idx = 0;
for (const [name, rgba] of NAMED) {
  C[name] = idx;
  RGBA.set(rgba, idx * 4);
  RGBA32[idx] = pack(rgba);
  idx++;
}

for (let i = 0; i < SKY_STEPS; i++) {
  const t = i / (SKY_STEPS - 1);
  const rgba: RGBA = [
    Math.round(SKY_TOP[0] + (SKY_HORIZON[0] - SKY_TOP[0]) * t),
    Math.round(SKY_TOP[1] + (SKY_HORIZON[1] - SKY_TOP[1]) * t),
    Math.round(SKY_TOP[2] + (SKY_HORIZON[2] - SKY_TOP[2]) * t),
    255,
  ];
  C[`sky${i}`] = idx;
  SKY.push(idx);
  RGBA.set(rgba, idx * 4);
  RGBA32[idx] = pack(rgba);
  idx++;
}
