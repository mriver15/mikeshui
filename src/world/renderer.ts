import { mulberry32, hashString, type RNG } from "../core/rng";
import { Perlin } from "../core/perlin";
import { generateChunk, CHUNK_W, VIEW_H, type ChunkPiece } from "./worldgen";

const MAX_CACHED_CHUNKS = 256;

/**
 * Hosts an SVG painting inside `container`, windowed and panned the way
 * shan-shui-inf's `chunkrender`/`viewupdate` do: only chunks within one
 * `CHUNK_W` of the viewport are included, concatenated into a single `<g>`
 * sorted by `y` (painter's algorithm — see worldgen.ts), and the whole `<svg>`
 * is composited with `mix-blend-mode: multiply` over a generated paper
 * texture so overlapping ink strokes darken where they pool.
 *
 * Unlike the original, which rebuilds that `<g>` on every scroll tick, this
 * only rebuilds when the set of visible chunks actually changes.
 */
export class Renderer {
  private chunks = new Map<number, ChunkPiece[]>();
  private perlin: Perlin;
  private svg: SVGSVGElement;
  private group: SVGGElement;
  private logicalW = CHUNK_W;
  private lastWindowKey = "";

  constructor(
    private seed: string,
    private container: HTMLElement,
  ) {
    this.perlin = new Perlin(seed);
    const ns = "http://www.w3.org/2000/svg";
    this.svg = document.createElementNS(ns, "svg") as SVGSVGElement;
    this.svg.style.mixBlendMode = "multiply";
    this.svg.style.width = "100%";
    this.svg.style.height = "100%";
    this.svg.style.display = "block";
    this.group = document.createElementNS(ns, "g") as SVGGElement;
    this.svg.appendChild(this.group);
    container.appendChild(this.svg);
    container.style.backgroundImage = `url(${paperTexture(seed)})`;
    container.style.backgroundRepeat = "repeat";
  }

  setSeed(seed: string): void {
    this.seed = seed;
    this.perlin = new Perlin(seed);
    this.chunks.clear();
    this.lastWindowKey = "";
    this.container.style.backgroundImage = `url(${paperTexture(seed)})`;
  }

  resize(logicalWidth: number): void {
    this.logicalW = logicalWidth;
    this.lastWindowKey = "";
  }

  draw(scrollX: number): void {
    const first = Math.floor(scrollX / CHUNK_W) - 1;
    const last = Math.floor((scrollX + this.logicalW - 1) / CHUNK_W) + 1;
    const windowKey = `${first}:${last}`;

    this.svg.setAttribute("viewBox", `${scrollX} 0 ${this.logicalW} ${VIEW_H}`);

    if (windowKey === this.lastWindowKey) return;
    this.lastWindowKey = windowKey;

    const pieces: ChunkPiece[] = [];
    for (let k = first; k <= last; k++) pieces.push(...this.getChunk(k));
    pieces.sort((a, b) => a.y - b.y);

    this.group.innerHTML = pieces.map((p) => p.svg).join("");
  }

  /** Current viewport as a standalone SVG document string, for the download button. */
  exportSvg(scrollX: number): string {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.logicalW}" height="${VIEW_H}" ` +
      `viewBox="${scrollX} 0 ${this.logicalW} ${VIEW_H}" style="background:#f4ede0">` +
      `<g style="mix-blend-mode:multiply">${this.group.innerHTML}</g></svg>`
    );
  }

  private getChunk(k: number): ChunkPiece[] {
    let c = this.chunks.get(k);
    if (!c) {
      c = generateChunk(this.seed, k, this.perlin);
      this.chunks.set(k, c);
      if (this.chunks.size > MAX_CACHED_CHUNKS) {
        const oldest = this.chunks.keys().next().value;
        if (oldest !== undefined) this.chunks.delete(oldest);
      }
    }
    return c;
  }
}

/** Seamlessly-tileable warm paper texture, ported from shan-shui-inf's background canvas. */
function paperTexture(seed: string): string {
  const reso = 256;
  const canvas = document.createElement("canvas");
  canvas.width = reso;
  canvas.height = reso;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(reso, reso);
  const perlin = new Perlin(seed + ":paper");
  const rng: RNG = mulberry32(hashString(seed + ":paper-grain"));

  const half = reso / 2;
  for (let i = 0; i <= half; i++) {
    for (let j = 0; j <= half; j++) {
      let c = 245 + perlin.noise(i * 0.1, j * 0.1) * 10;
      c -= rng() * 20;
      const r = c;
      const g = c * 0.95;
      const b = c * 0.85;
      for (const [x, y] of [
        [i, j],
        [reso - i, j],
        [i, reso - j],
        [reso - i, reso - j],
      ] as const) {
        const xi = Math.min(reso - 1, x);
        const yi = Math.min(reso - 1, y);
        const idx = (yi * reso + xi) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
