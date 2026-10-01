/**
 * A mutable 2-D grid of palette indices, plus the drawing primitives used to
 * author sprites and rasterize the world. Index 0 is reserved as transparent.
 */
export class Pixmap {
  data: Uint8Array;

  constructor(
    public w: number,
    public h: number,
    data?: Uint8Array,
  ) {
    this.data = data ?? new Uint8Array(w * h);
  }

  get(x: number, y: number): number {
    return this.data[y * this.w + x];
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  }

  fill(c: number): void {
    this.data.fill(c);
  }

  fillRect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, x);
    const x1 = Math.min(this.w, x + w);
    const y0 = Math.max(0, y);
    const y1 = Math.min(this.h, y + h);
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        this.data[j * this.w + i] = c;
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: number): void {
    const r2 = r * r;
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.data[j * this.w + i] = c;
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: number): void {
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const dx = (i + 0.5 - cx) / rx;
        const dy = (j + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.data[j * this.w + i] = c;
      }
    }
  }

  fillTriangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    c: number,
  ): void {
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y++) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      const edges: Array<[number, number, number, number]> = [
        [x0, y0, x1, y1],
        [x1, y1, x2, y2],
        [x2, y2, x0, y0],
      ];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const t = (y - ay) / (by - ay);
          const x = ax + t * (bx - ax);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      if (minX <= maxX) {
        const sx = Math.max(0, Math.ceil(minX));
        const ex = Math.min(this.w - 1, Math.floor(maxX));
        for (let x = sx; x <= ex; x++) this.data[y * this.w + x] = c;
      }
    }
  }
}

/** Copy `src` onto `dst` at (dx, dy), skipping transparent (index 0) pixels. */
export function blit(dst: Pixmap, src: Pixmap, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    const sy = dy + y;
    if (sy < 0 || sy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const sx = dx + x;
      if (sx < 0 || sx >= dst.w) continue;
      const c = src.data[y * src.w + x];
      if (c === 0) continue;
      dst.data[sy * dst.w + sx] = c;
    }
  }
}

/** Nearest-neighbour scaled blit (integer scale), skipping transparent pixels. */
export function blitScaled(
  dst: Pixmap,
  src: Pixmap,
  dx: number,
  dy: number,
  scale: number,
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
      dst.data[sy * dst.w + sx] = c;
    }
  }
}
