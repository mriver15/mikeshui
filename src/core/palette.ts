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
  ["treeline", hex("398b31")],
  ["treelineDark", hex("395200")],
  ["treelineHaze", hex("73c5a4")],
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
  ["wood", hex("6a5a5a")],
  ["woodDark", hex("413931")],
  ["sign", hex("dee6ee")],
  ["berry", hex("cd4152")],
  ["berryGreen", hex("41b483")],
  ["skin", hex("ffd5b4")],
  ["skinShade", hex("ffbd83")],
];

const SKY_TOP = hex("62a4de");
const SKY_HORIZON = hex("dee6ee");
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
