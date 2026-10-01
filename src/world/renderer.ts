import { Pixmap, blit } from "../core/pixmap";
import { SKY, RGBA32, C } from "../core/palette";
import { ditherPick } from "../core/dither";
import { noise2i, hashString } from "../core/prng";
import {
  generateChunk,
  generateForeground,
  isWaterAt,
  waterSurfaceY,
  CHUNK_W,
  VIEW_H,
  HORIZON,
} from "./worldgen";

const MAX_CACHED_CHUNKS = 512;
const PARALLAX = 1.5;

/**
 * Rasterizes the infinite world into an offscreen low-resolution framebuffer,
 * then nearest-neighbour-scales it onto the visible canvas for the pixel look.
 */
export class Renderer {
  private chunks = new Map<number, Pixmap>();
  private fgChunks = new Map<number, Pixmap>();
  private fb = new Pixmap(1, VIEW_H);
  private off: HTMLCanvasElement;
  private offctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;

  constructor(
    private seed: string,
    private canvas: HTMLCanvasElement,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.octx = ctx;
    this.off = document.createElement("canvas");
    this.off.width = 1;
    this.off.height = VIEW_H;
    const offctx = this.off.getContext("2d");
    if (!offctx) throw new Error("2D canvas context unavailable");
    this.offctx = offctx;
  }

  setSeed(seed: string): void {
    this.seed = seed;
    this.chunks.clear();
    this.fgChunks.clear();
  }

  resize(logicalWidth: number): void {
    this.fb = new Pixmap(logicalWidth, VIEW_H);
    this.off.width = logicalWidth;
    this.off.height = VIEW_H;
  }

  draw(scrollX: number, time: number): void {
    const fb = this.fb;

    // sky gradient (dithered for a smooth, band-free blend)
    for (let y = 0; y < HORIZON; y++) {
      const t = (y / HORIZON) * (SKY.length - 1);
      const i = Math.floor(t);
      const frac = t - i;
      const a = SKY[i];
      const b = SKY[Math.min(i + 1, SKY.length - 1)];
      for (let x = 0; x < fb.w; x++) {
        fb.data[y * fb.w + x] = ditherPick(a, b, frac, x, y);
      }
    }

    // chunks
    const first = Math.floor(scrollX / CHUNK_W);
    const last = Math.floor((scrollX + fb.w - 1) / CHUNK_W);
    for (let k = first; k <= last; k++) {
      blit(fb, this.getChunk(k), k * CHUNK_W - scrollX, 0);
    }

    // foreground (parallax: scrolls faster, drawn last)
    const fgScroll = Math.round(scrollX * PARALLAX);
    const fgFirst = Math.floor(fgScroll / CHUNK_W);
    const fgLast = Math.floor((fgScroll + fb.w - 1) / CHUNK_W);
    for (let k = fgFirst; k <= fgLast; k++) {
      blit(fb, this.getFgChunk(k), k * CHUNK_W - fgScroll, 0);
    }

    // animated water shimmer
    this.shimmer(scrollX, time);

    this.present();
  }

  private shimmer(scrollX: number, time: number): void {
    const fb = this.fb;
    const shimmerSeed = hashString(this.seed + ":shimmer");
    const drift = Math.floor(time / 33);
    for (let x = 0; x < fb.w; x++) {
      const wx = scrollX + x;
      if (!isWaterAt(wx, this.seed)) continue;
      const surf = waterSurfaceY(wx);
      for (let y = surf + 4; y < VIEW_H; y++) {
        const n = noise2i(shimmerSeed, wx + drift, y);
        if (n < 0.05) fb.data[y * fb.w + x] = C.waterBright;
        else if (n > 0.93) fb.data[y * fb.w + x] = C.waterLight;
      }
    }
  }

  private getFgChunk(k: number): Pixmap {
    let c = this.fgChunks.get(k);
    if (!c) {
      c = generateForeground(this.seed, k);
      this.fgChunks.set(k, c);
      if (this.fgChunks.size > MAX_CACHED_CHUNKS) {
        const oldest = this.fgChunks.keys().next().value;
        if (oldest !== undefined) this.fgChunks.delete(oldest);
      }
    }
    return c;
  }

  private getChunk(k: number): Pixmap {
    let c = this.chunks.get(k);
    if (!c) {
      c = generateChunk(this.seed, k);
      this.chunks.set(k, c);
      if (this.chunks.size > MAX_CACHED_CHUNKS) {
        const oldest = this.chunks.keys().next().value;
        if (oldest !== undefined) this.chunks.delete(oldest);
      }
    }
    return c;
  }

  private present(): void {
    const img = this.offctx.createImageData(this.off.width, this.off.height);
    const data32 = new Uint32Array(img.data.buffer);
    const src = this.fb.data;
    for (let i = 0; i < src.length; i++) {
      data32[i] = RGBA32[src[i]];
    }
    this.offctx.putImageData(img, 0, 0);
    this.octx.imageSmoothingEnabled = false;
    this.octx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }
}
