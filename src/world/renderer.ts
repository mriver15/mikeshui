import { Pixmap, blit } from "../core/pixmap";
import { SKY, RGBA32 } from "../core/palette";
import { ditherPick } from "../core/dither";
import { keyRng } from "../core/prng";
import { tallGrassTile, TILE } from "../sprites/tiles";
import { CloudSky } from "./clouds";
import { Backdrop } from "./backdrop";
import { drawWaterEffects } from "./waterfx";
import { treeCanopyPixmap, berryCanopyPixmap, treeLobeCount, BERRY_TREE_LOBE_COUNT, TREE_W } from "../sprites/objects";
import {
  generateChunk,
  generateForeground,
  CHUNK_W,
  VIEW_H,
  HORIZON,
  type ChunkResult,
  type ForegroundResult,
} from "./worldgen";

/**
 * Per-lobe canopy sway for a tree at world-x `wx`: each lobe gets its own
 * phase (`idx * 1.3`, spread across a typical 7-8 lobe canopy) so the balls
 * nudge independently — wind rustling the canopy, not the whole tree
 * sliding as one rigid block. `wx` in the base phase keeps neighboring
 * trees out of lockstep with each other too.
 */
function treeSway(wx: number, time: number, lobeCount: number): number[] {
  const base = time / 1300 + wx * 0.03;
  return Array.from({ length: lobeCount }, (_, idx) => Math.sin(base + idx * 1.3) * 1.8);
}

/**
 * `blitScaled` for redrawing a swaying sprite over its own baked chunk:
 * skips any pixel the chunk's depth buffer says was painted by something
 * nearer than `own`, so the sway can't draw over objects in front of it.
 * `chunkLeft` is the chunk's screen x; the sprite lies within the chunk.
 */
function blitBehind(
  dst: Pixmap,
  src: Pixmap,
  dx: number,
  dy: number,
  scale: number,
  depth: Uint16Array,
  chunkLeft: number,
  own: number,
): void {
  const sw = Math.round(src.w * scale);
  const sh = Math.round(src.h * scale);
  for (let y = 0; y < sh; y++) {
    const sy = dy + y;
    if (sy < 0 || sy >= dst.h) continue;
    const srcY = Math.min(src.h - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = dx + x;
      if (sx < 0 || sx >= dst.w) continue;
      const c = src.data[srcY * src.w + Math.min(src.w - 1, Math.floor(x / scale))];
      if (c === 0) continue;
      const lx = sx - chunkLeft;
      if (lx >= 0 && lx < CHUNK_W && depth[sy * CHUNK_W + lx] > own) continue;
      dst.data[sy * dst.w + sx] = c;
    }
  }
}

/**
 * Each cached chunk holds a pixmap plus a 16-bit depth buffer (~0.5 MB
 * together), so keep a few screens' worth either side, not hundreds.
 */
const MAX_CACHED_CHUNKS = 64;
const PARALLAX = 1.5;

/**
 * Rasterizes the infinite world into an offscreen low-resolution framebuffer,
 * then nearest-neighbour-scales it onto the visible canvas for the pixel look.
 */
export class Renderer {
  private chunks = new Map<number, ChunkResult>();
  private fgChunks = new Map<number, ForegroundResult>();
  private clouds: CloudSky;
  private backdrop: Backdrop;
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
    this.clouds = new CloudSky(seed);
    this.backdrop = new Backdrop(seed, HORIZON);
  }

  setSeed(seed: string): void {
    this.seed = seed;
    this.chunks.clear();
    this.fgChunks.clear();
    this.clouds = new CloudSky(seed);
    this.backdrop = new Backdrop(seed, HORIZON);
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

    // the backdrop, back to front, with the cloud layers slotted between
    // it: far clouds behind the mountains, mist pooling at the feet of
    // the far layers, then the forested and meadow hills in front
    this.clouds.drawLayer(fb, 0, scrollX, time);
    this.backdrop.drawLayer(fb, 0, scrollX);
    this.clouds.drawLayer(fb, 1, scrollX, time);
    this.backdrop.drawLayer(fb, 1, scrollX);
    this.backdrop.drawMist(fb);
    this.clouds.drawLayer(fb, 2, scrollX, time);
    this.backdrop.drawLayer(fb, 2, scrollX);
    this.backdrop.drawLayer(fb, 3, scrollX);

    // chunks
    const first = Math.floor(scrollX / CHUNK_W);
    const last = Math.floor((scrollX + fb.w - 1) / CHUNK_W);
    for (let k = first; k <= last; k++) {
      blit(fb, this.getChunk(k).pixmap, k * CHUNK_W - scrollX, 0);
    }

    // tall-grass and tree-canopy sway, then the animated water (after the
    // canopies, so it can reflect them) — all before the foreground goes
    // on top, so none of them can paint over it
    const visible = this.chunkRange(first, last, (k) => this.getChunk(k));
    this.drawAnimated(visible, scrollX, time);
    drawWaterEffects(fb, visible.map(({ k, chunk }) => ({ k, water: chunk.water })), scrollX, time, this.seed);

    // foreground (parallax: scrolls faster, drawn last)
    const fgScroll = Math.round(scrollX * PARALLAX);
    const fgFirst = Math.floor(fgScroll / CHUNK_W);
    const fgLast = Math.floor((fgScroll + fb.w - 1) / CHUNK_W);
    for (let k = fgFirst; k <= fgLast; k++) {
      blit(fb, this.getFgChunk(k).pixmap, k * CHUNK_W - fgScroll, 0);
    }
    this.drawAnimated(this.chunkRange(fgFirst, fgLast, (k) => this.getFgChunk(k)), fgScroll, time);

    this.present();
  }

  /**
   * Draws everything that sways — tall grass and tree canopies — fresh
   * each frame, since none of it is baked into the chunk. Within a chunk
   * they go back to front by depth, and each writes only where the
   * chunk's depth buffer says nothing nearer was baked (see `blitBehind`).
   * Sprites never straddle chunks, so per-chunk ordering is enough.
   */
  private drawAnimated(chunks: Array<{ k: number; chunk: ChunkResult | ForegroundResult }>, scrollX: number, time: number): void {
    const fb = this.fb;
    for (const { k, chunk } of chunks) {
      const chunkLeft = k * CHUNK_W - scrollX;
      const items: Array<{ depth: number; draw: () => void }> = [];
      if ("tallGrass" in chunk) {
        for (const spot of chunk.tallGrass) {
          const screenX = spot.x - scrollX;
          if (screenX < -TILE || screenX >= fb.w) continue;
          items.push({
            depth: spot.depth,
            draw: () => {
              const lean = Math.sin(time / 900 + spot.x * 0.05) * 2.4;
              const rng = keyRng(this.seed, "talltile", spot.k, spot.i, spot.t);
              blitBehind(fb, tallGrassTile(rng, lean), screenX, spot.y, 1, chunk.depth, chunkLeft, spot.depth);
            },
          });
        }
        for (const spot of chunk.berryTrees) {
          const screenX = spot.x - scrollX;
          if (screenX < -TREE_W || screenX >= fb.w) continue;
          items.push({
            depth: spot.depth,
            draw: () => {
              const sway = treeSway(spot.x, time, BERRY_TREE_LOBE_COUNT);
              blitBehind(fb, berryCanopyPixmap(sway), screenX, spot.y, 1, chunk.depth, chunkLeft, spot.depth);
            },
          });
        }
      }
      for (const spot of chunk.trees) {
        const screenX = spot.x - scrollX;
        if (screenX < -Math.round(TREE_W * spot.scale) || screenX >= fb.w) continue;
        items.push({
          depth: spot.depth,
          draw: () => {
            const sway = treeSway(spot.x, time, treeLobeCount(spot.spec));
            blitBehind(fb, treeCanopyPixmap(spot.spec, sway), screenX, spot.y, spot.scale, chunk.depth, chunkLeft, spot.depth);
          },
        });
      }
      items.sort((a, b) => a.depth - b.depth);
      for (const item of items) item.draw();
    }
  }

  private chunkRange<T>(first: number, last: number, get: (k: number) => T): Array<{ k: number; chunk: T }> {
    const out: Array<{ k: number; chunk: T }> = [];
    for (let k = first; k <= last; k++) out.push({ k, chunk: get(k) });
    return out;
  }

  private getFgChunk(k: number): ForegroundResult {
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

  private getChunk(k: number): ChunkResult {
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
