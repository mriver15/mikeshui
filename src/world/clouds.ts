import { Pixmap, blit } from "../core/pixmap";
import { keyRng } from "../core/prng";
import { cloudPixmap, type CloudKind } from "../sprites/clouds";

/**
 * One depth layer of sky. Clouds are laid out in the layer's own scrolling
 * space — world scroll times `parallax`, plus a steady wind drift — cut
 * into fixed cells, each holding at most one cloud rolled from its index.
 * So the sky is infinite and the same every time you return to a spot,
 * and farther layers slide by more slowly than nearer ones.
 */
interface CloudLayer {
  parallax: number;
  /** Wind drift in px per second (in the layer's space). */
  drift: number;
  cellW: number;
  /** Chance a cell has a cloud. */
  density: number;
  /** Cloud top y range, in view space. */
  top: [number, number];
  width: [number, number];
  /** Chance a cloud is a thin stratus streak rather than a cumulus heap. */
  stratus: number;
  far: boolean;
}

/**
 * Back to front. Clouds are drawn before the terrain, so a low cloud can
 * sink behind the hills instead of being confined to a strip above them.
 */
const LAYERS: CloudLayer[] = [
  { parallax: 0.06, drift: 1.5, cellW: 150, density: 0.55, top: [10, 58], width: [36, 70], stratus: 0.55, far: true },
  { parallax: 0.14, drift: 3, cellW: 230, density: 0.5, top: [16, 64], width: [56, 96], stratus: 0.15, far: false },
  { parallax: 0.26, drift: 5, cellW: 320, density: 0.45, top: [4, 40], width: [88, 140], stratus: 0, far: false },
];

interface CloudSlot {
  /** Offset of the cloud's left edge within its cell. */
  offset: number;
  top: number;
  pixmap: Pixmap;
}

const MAX_CACHED = 256;

/** Stratus streaks run this much longer than a cumulus of the same roll. */
const STRATUS_STRETCH = 1.4;

/** The scrolling, drifting cloud layers of one world seed. */
export class CloudSky {
  private cache = new Map<string, CloudSlot | null>();

  constructor(private seed: string) {}

  /** How many cloud layers there are, back (0) to front. */
  static readonly LAYER_COUNT = LAYERS.length;

  /** Draw every layer, back to front. */
  draw(fb: Pixmap, scrollX: number, time: number): void {
    for (let li = 0; li < LAYERS.length; li++) this.drawLayer(fb, li, scrollX, time);
  }

  /**
   * Draw one layer — so the renderer can interleave cloud layers with the
   * backdrop's mountains and hills, putting far clouds behind the peaks.
   */
  drawLayer(fb: Pixmap, li: number, scrollX: number, time: number): void {
    const layer = LAYERS[li];
    const u0 = Math.round(scrollX * layer.parallax + (time / 1000) * layer.drift);
    const first = Math.floor((u0 - layer.width[1] * STRATUS_STRETCH * 1.6) / layer.cellW);
    const last = Math.floor((u0 + fb.w) / layer.cellW);
    for (let i = first; i <= last; i++) {
      const slot = this.slot(li, i);
      if (!slot) continue;
      blit(fb, slot.pixmap, i * layer.cellW + slot.offset - u0, slot.top);
    }
  }

  private slot(li: number, i: number): CloudSlot | null {
    const key = `${li}:${i}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const layer = LAYERS[li];
    const rng = keyRng(this.seed, "cloud", li, i);
    let slot: CloudSlot | null = null;
    if (rng() < layer.density) {
      const kind: CloudKind = rng() < layer.stratus ? "stratus" : "cumulus";
      const w = Math.round((layer.width[0] + rng() * (layer.width[1] - layer.width[0])) * (kind === "stratus" ? STRATUS_STRETCH : 1));
      const pixmap = cloudPixmap(keyRng(this.seed, "cloudshape", li, i), w, kind, layer.far);
      const offset = Math.floor(rng() * Math.max(1, layer.cellW - w * 0.6));
      const top = Math.round(layer.top[0] + rng() * (layer.top[1] - layer.top[0]));
      slot = { offset, top, pixmap };
    }
    this.cache.set(key, slot);
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return slot;
  }
}
