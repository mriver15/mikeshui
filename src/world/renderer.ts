import { Pixmap, blit } from "../core/pixmap";
import { SKY, C } from "../core/palette";
import { ditherPick, ditherThreshold } from "../core/dither";
import { keyRng, noise2i, hashString } from "../core/prng";
import { dayPalette, type DayPalette } from "../core/daylight";
import { tallGrassTile, TILE } from "../sprites/tiles";
import { CloudSky } from "./clouds";
import { SkyFauna } from "./fauna";
import { drawPeekingEyes, drawAlertBubble } from "../sprites/critters";
import { bannerPixmap, messagePixmap } from "../sprites/banner";
import { ITEMS, itemIcon, drawSparkle } from "../sprites/items";
import { Backdrop } from "./backdrop";
import { drawWaterEffects } from "./waterfx";
import { treeCanopyPixmap, berryCanopyPixmap, treeLobeCount, BERRY_TREE_LOBE_COUNT, TREE_W } from "../sprites/objects";
import {
  FG_PARALLAX,
  GROUND_BASE,
  areaAt,
  weatherAt,
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
 * If `owners` is given, each pixel written records `ownerBase` there
 * (the sprite's base y), for lighting.
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
  owners?: Int16Array,
  ownerBase = 0,
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
      if (owners) owners[sy * dst.w + sx] = ownerBase;
    }
  }
}

/**
 * Each cached chunk holds a pixmap plus a 16-bit depth buffer (~0.5 MB
 * together), so keep a few screens' worth either side, not hundreds.
 */
const MAX_CACHED_CHUNKS = 64;

/** How long one tall-grass encounter plays out, in ms. */
const ENCOUNTER_MS = 3000;
/** Share of tall-grass tufts with something living in them. */
const OCCUPIED = 0.3;

/**
 * Where a tall-grass encounter is up to: the tuft rustles hard and sheds
 * a few leaves, then eyes peek out between the blades, glance about and
 * blink, with a "!" popping up as they appear.
 */
interface Encounter {
  /** ms since it began. */
  t: number;
  rustle: boolean;
  eyes: boolean;
  blink: boolean;
  look: number;
  /** 0..1 pop-in of the alert bubble, or -1 when it isn't showing. */
  alert: number;
}

function encounterAt(t: number): Encounter | null {
  if (t < 0 || t >= ENCOUNTER_MS) return null;
  const eyes = t > 850 && t < 2750;
  return {
    t,
    rustle: t < 1000,
    eyes,
    blink: eyes && t > 1400 && t % 950 < 110,
    look: t < 1800 ? -1 : 1,
    alert: t > 900 && t < 1750 ? Math.min(1, (t - 900) / 220) : -1,
  };
}

/** `owners` value for a pixel nothing animated has drawn this frame. */
const UNSET = -32767;
/** Base y standing in for the foreground layer: in front of everything. */
const FRONT = 32767;
const PARALLAX = FG_PARALLAX;

/**
 * Rasterizes the infinite world into an offscreen low-resolution framebuffer,
 * then nearest-neighbour-scales it onto the visible canvas for the pixel look.
 */
export class Renderer {
  private chunks = new Map<number, ChunkResult>();
  private fgChunks = new Map<number, ForegroundResult>();
  private clouds: CloudSky;
  private backdrop: Backdrop;
  private fauna: SkyFauna;
  private fb = new Pixmap(1, VIEW_H);
  private off: HTMLCanvasElement;
  private offctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  /** Per-pixel lamplight for the current frame: 1 where a lamp lights the scene. */
  private lightMask = new Uint8Array(0);
  /**
   * Base y of whatever was drawn at each pixel *this frame* (swaying
   * canopies and grass, foreground), so lamplight can tell what stands in
   * front of a lamp; UNSET where the baked chunk shows through.
   */
  private owners = new Int16Array(0);
  /** Tufts the viewer tapped, keyed by world position, with when. */
  private pokes = new Map<string, number>();
  /** How dark it is this frame (0 day .. 1 night), for glowing eyes. */
  private darkness = 0;
  /** The area the view is in, its banner, and when the view entered it. */
  private area: { key: string; banner: Pixmap; since: number } | null = null;
  /** The weather here, eased toward the local weather as the view moves. */
  private rain = 0;
  private fog = 0;
  private lastFrame: number | null = null;
  /** How far down from the top the location banner settles (clear of any overlaid UI). */
  private topInset = 6;
  /** Hidden items already found, by world position ("x,y"). */
  private found = new Set<string>();
  /** The latest find: where, what, and when, for the pickup and message. */
  private pickup: { wx: number; y: number; kind: number; at: number; message: Pixmap } | null = null;

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
    this.fauna = new SkyFauna(seed);
    this.clouds = new CloudSky(seed);
    this.backdrop = new Backdrop(seed, HORIZON);
  }

  setSeed(seed: string): void {
    this.seed = seed;
    this.chunks.clear();
    this.fgChunks.clear();
    this.area = null;
    this.lastFrame = null;
    this.found.clear();
    this.pickup = null;
    this.fauna = new SkyFauna(seed);
    this.clouds = new CloudSky(seed);
    this.backdrop = new Backdrop(seed, HORIZON);
  }

  resize(logicalWidth: number): void {
    this.fb = new Pixmap(logicalWidth, VIEW_H);
    this.lightMask = new Uint8Array(logicalWidth * VIEW_H);
    this.owners = new Int16Array(logicalWidth * VIEW_H);
    this.image = null;
    this.off.width = logicalWidth;
    this.off.height = VIEW_H;
  }

  /**
   * Render one frame. `phase` is the time of day, 0..1 (0 midnight, 0.25
   * dawn, 0.5 noon, 0.75 dusk): the scene is drawn once in palette
   * indices, then colored for that hour as it's presented.
   */
  draw(scrollX: number, time: number, phase = 0.5): void {
    const fb = this.fb;
    this.updateWeather(scrollX, time);
    const flash = this.lightning(time);
    const pal = flash ? dayPalette(0.5) : dayPalette(phase, this.rain * 0.9, this.fog);
    this.darkness = pal.darkness;

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

    if (pal.darkness > 0.2) this.drawNightSky(scrollX, time, phase, pal.darkness);

    // the backdrop, back to front, with the cloud layers slotted between
    // it: far clouds behind the mountains, mist pooling at the feet of
    // the far layers, then the forested and meadow hills in front
    this.clouds.drawLayer(fb, 0, scrollX, time);
    this.backdrop.drawLayer(fb, 0, scrollX);
    this.clouds.drawLayer(fb, 1, scrollX, time);
    this.backdrop.drawLayer(fb, 1, scrollX);
    this.backdrop.drawMist(fb, this.fog);
    this.clouds.drawLayer(fb, 2, scrollX, time);
    this.fauna.draw(fb, scrollX, time, pal.darkness, this.rain);
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
    this.drawItemGlints(visible, scrollX, time);
    const lit = pal.darkness > 0.15 && visible.some(({ chunk }) => chunk.lights.length > 0);
    if (lit) this.owners.fill(UNSET);
    this.drawAnimated(visible, scrollX, time, lit ? this.owners : undefined);
    drawWaterEffects(fb, visible.map(({ k, chunk }) => ({ k, water: chunk.water })), scrollX, time, this.seed);

    // foreground (parallax: scrolls faster, drawn last)
    const fgScroll = Math.round(scrollX * PARALLAX);
    const fgFirst = Math.floor(fgScroll / CHUNK_W);
    const fgLast = Math.floor((fgScroll + fb.w - 1) / CHUNK_W);
    for (let k = fgFirst; k <= fgLast; k++) {
      blit(fb, this.getFgChunk(k).pixmap, k * CHUNK_W - fgScroll, 0);
    }
    this.drawAnimated(this.chunkRange(fgFirst, fgLast, (k) => this.getFgChunk(k)), fgScroll, time, lit ? this.owners : undefined, true);

    this.drawRain(scrollX, time);
    this.drawPickup(scrollX, time);
    this.drawBanner(scrollX, time);
    this.present(pal, lit ? visible : [], scrollX, fgScroll);
  }

  /**
   * Ease this frame's weather toward the weather at the middle of the
   * view, over a few seconds — so walking into rain or fog brings it on
   * gradually rather than switching at a line. The first frame snaps.
   */
  private updateWeather(scrollX: number, time: number): void {
    const here = weatherAt(scrollX + Math.floor(this.fb.w / 2), this.seed);
    const dt = this.lastFrame === null ? Infinity : Math.max(0, Math.min(0.25, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    const k = 1 - Math.exp(-dt * 0.9);
    this.rain += (here.rain - this.rain) * k;
    this.fog += (here.fog - this.fog) * k;
  }

  /** Whether lightning lights up the scene this frame: an occasional double flicker in heavy rain. */
  private lightning(time: number): boolean {
    if (this.rain < 0.8) return false;
    const period = 7000;
    const e = Math.floor(time / period);
    const rng = keyRng(this.seed, "lightning", e);
    if (rng() > 0.35) return false;
    const age = time - e * period - rng() * (period - 400);
    return (age >= 0 && age < 70) || (age >= 140 && age < 200);
  }

  /**
   * Rain over everything: slanting streaks falling across the view (they
   * move with the world as it scrolls, so they're out there, not on the
   * glass), plus splashes — tiny rings on open water, little up-flicks on
   * ground — popping up at random. Density follows how hard it's raining.
   */
  private drawRain(scrollX: number, time: number): void {
    const amount = this.rain;
    if (amount < 0.04) return;
    const fb = this.fb;
    const seed = hashString(this.seed + ":rain");
    const t = time / 1000;
    const W = fb.w + 40;
    const H = fb.h + 30;
    const mod = (a: number, m: number) => ((a % m) + m) % m;
    const drops = Math.round(amount * 0.75 * fb.w);
    for (let i = 0; i < drops; i++) {
      const speed = 0.8 + noise2i(seed, i, 2) * 0.5;
      const x = Math.round(mod(noise2i(seed, i, 0) * W - scrollX - t * 45 * speed, W)) - 20;
      const y = Math.round(mod(noise2i(seed, i, 1) * H + t * 270 * speed, H)) - 20;
      const len = 4 + Math.floor(noise2i(seed, i, 3) * 3);
      for (let j = 0; j < len; j++) {
        const px = x + Math.floor(j / 3);
        const py = y - j;
        if (px >= 0 && px < fb.w && py >= 0 && py < fb.h) fb.data[py * fb.w + px] = C.rain;
      }
    }
    const bucket = Math.floor(time / 90);
    const splashes = Math.round(amount * 0.05 * fb.w);
    for (let j = 0; j < splashes; j++) {
      const x = Math.floor(noise2i(seed + 1, bucket, j) * fb.w);
      const y = HORIZON + 4 + Math.floor(noise2i(seed + 2, bucket, j) * (fb.h - HORIZON - 6));
      const here = fb.data[y * fb.w + x];
      const wet = here === C.water || here === C.waterLight || here === C.waterDark;
      const c = wet ? C.waterBright : C.rain;
      if (x > 0) fb.data[(y - 1) * fb.w + x - 1] = c;
      if (x + 1 < fb.w) fb.data[(y - 1) * fb.w + x + 1] = c;
      if (wet) fb.data[y * fb.w + x] = C.waterLight;
    }
  }

  /** Keep the location banner clear of on-screen UI covering the top `px` view pixels. */
  setTopInset(px: number): void {
    this.topInset = Math.max(6, Math.min(VIEW_H / 2, Math.round(px)));
  }

  /**
   * The location banner: when the middle of the view crosses into a new
   * town or route, its name slides down from the top-left corner, holds
   * for a few seconds, and slides away again.
   */
  private drawBanner(scrollX: number, time: number): void {
    const fb = this.fb;
    const a = areaAt(scrollX + Math.floor(fb.w / 2), this.seed);
    if (!this.area || this.area.key !== a.key) {
      this.area = { key: a.key, banner: bannerPixmap(a.title, a.kind), since: time };
    }
    const age = time - this.area.since;
    const slideIn = 280;
    const hold = 3000;
    const slideOut = 380;
    if (age > hold + slideOut) return;
    const ease = (t: number) => 1 - (1 - t) * (1 - t);
    const shown = age < slideIn ? ease(age / slideIn) : age > hold ? 1 - ease((age - hold) / slideOut) : 1;
    const b = this.area.banner;
    blit(fb, b, 6, Math.round(-b.h + (b.h + this.topInset) * shown));
  }

  /**
   * The encounter playing out in the tuft at (wx, y), if any. Occupied
   * tufts (a fixed share, chosen per tuft) each run one every 8–22 s on
   * their own offset, so the field is never quite still but never busy;
   * a tap on any tuft starts one there at once.
   */
  private encounter(wx: number, y: number, time: number): Encounter | null {
    const poked = this.pokes.get(`${wx},${y}`);
    if (poked !== undefined) {
      const e = encounterAt(time - poked);
      if (e) return e;
      this.pokes.delete(`${wx},${y}`);
    }
    const seed = hashString(this.seed + ":encounter");
    if (noise2i(seed, wx, y) > OCCUPIED) return null;
    const period = 8000 + noise2i(seed + 1, wx, y) * 14000;
    return encounterAt((time + noise2i(seed + 2, wx, y) * period) % period);
  }

  /** A few blades torn loose by a rustle, flung up and out and falling back. */
  private drawLeaves(cx: number, cy: number, t: number, key: number): void {
    const fb = this.fb;
    const s = t / 1000;
    if (s > 0.8) return;
    for (let i = 0; i < 4; i++) {
      const vx = (noise2i(key, i, 1) * 2 - 1) * 26;
      const vy = 34 + noise2i(key, i, 2) * 22;
      const x = Math.round(cx + vx * s);
      const y = Math.round(cy - vy * s + 70 * s * s);
      if (x < 0 || x >= fb.w || y < 0 || y >= fb.h) continue;
      fb.data[y * fb.w + x] = i % 2 ? C.grassLight : C.tallGrassLight;
      if (x + 1 < fb.w) fb.data[y * fb.w + x + 1] = C.grassDark;
    }
  }

  /**
   * The viewer tapped the screen at (x, y) in view pixels: a hidden item
   * near the tap is found; otherwise, if it's on a tall-grass tuft, an
   * encounter starts there.
   */
  poke(x: number, y: number, scrollX: number, time: number): boolean {
    const wx = scrollX + x;
    const k = Math.floor(wx / CHUNK_W);
    for (const kk of [k - 1, k, k + 1]) {
      const c = this.chunks.get(kk);
      if (!c) continue;
      for (const item of c.items) {
        const iwx = kk * CHUNK_W + item.x;
        const key = `${iwx},${item.y}`;
        if (this.found.has(key) || Math.abs(iwx - wx) > 9 || Math.abs(item.y - y) > 9) continue;
        this.found.add(key);
        const name = ITEMS[item.kind];
        const article = /^[AEIOU]/.test(name) ? "AN" : "A";
        this.pickup = { wx: iwx, y: item.y, kind: item.kind, at: time, message: messagePixmap(`FOUND ${article} ${name}!`) };
        return true;
      }
    }
    const chunk = this.chunks.get(k);
    if (!chunk) return false;
    for (const spot of chunk.tallGrass) {
      if (wx >= spot.x && wx < spot.x + TILE && y >= spot.y + 8 && y < spot.y + TILE) {
        this.pokes.set(`${spot.x},${spot.y}`, time);
        return true;
      }
    }
    return false;
  }

  /** Hidden items already found in this world, as "x,y" keys — for saving. */
  foundItems(): string[] {
    return [...this.found];
  }

  /** Mark items as already found (e.g. restored from a previous visit). */
  restoreFound(keys: string[]): void {
    for (const key of keys) this.found.add(key);
  }

  /**
   * A glint over each hidden item not yet found: a short twinkle every few
   * seconds on the item's own offset. Drawn before canopies and grass
   * sway, and only where the spot is open ground in the chunk, so
   * anything standing in front hides it.
   */
  private drawItemGlints(visible: Array<{ k: number; chunk: ChunkResult }>, scrollX: number, time: number): void {
    const fb = this.fb;
    const seed = hashString(this.seed + ":glint");
    for (const { k, chunk } of visible) {
      for (const item of chunk.items) {
        const wx = k * CHUNK_W + item.x;
        if (this.found.has(`${wx},${item.y}`)) continue;
        if (chunk.depth[item.y * CHUNK_W + item.x] !== 0) continue;
        const period = 3800 + noise2i(seed, wx, item.y) * 2400;
        const t = ((time + noise2i(seed + 1, wx, item.y) * period) % period) / 700;
        if (t >= 1) continue;
        const x = wx - scrollX;
        if (x < -3 || x > fb.w + 3) continue;
        drawSparkle(fb, x, item.y, t);
      }
    }
  }

  /**
   * The latest find: its icon pops up out of the grass with a burst of
   * glints and fades, while a message box slides up from the bottom of
   * the view, holds, and slides away.
   */
  private drawPickup(scrollX: number, time: number): void {
    const p = this.pickup;
    if (!p) return;
    const fb = this.fb;
    const age = time - p.at;
    if (age > 3200) {
      this.pickup = null;
      return;
    }
    if (age < 1100) {
      const icon = itemIcon(p.kind);
      const rise = Math.min(1, age / 350);
      const x = p.wx - scrollX;
      const y = p.y - 6 - Math.round(rise * 12);
      if (age < 900 || Math.floor(age / 60) % 2 === 0) blit(fb, icon, x - 4, y - 4);
      if (age < 500) {
        const r = 3 + (age / 500) * 9;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + age / 300;
          drawSparkle(fb, Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.7), 0.5);
        }
      }
    }
    const m = p.message;
    const ease = (t: number) => 1 - (1 - t) * (1 - t);
    const shown = age < 250 ? ease(age / 250) : age > 2800 ? 1 - ease((age - 2800) / 400) : 1;
    blit(fb, m, Math.round((fb.w - m.w) / 2), Math.round(fb.h - (m.h + 6) * shown));
  }

  /**
   * Base y of whatever is on screen at (x, y): something drawn this frame
   * (canopy, grass, foreground), else the foreground's baked layer, else
   * the world chunk's object there — or GROUND_BASE for bare ground.
   */
  private ownerBase(x: number, y: number, scrollX: number, fgScroll: number): number {
    const o = this.owners[y * this.fb.w + x];
    if (o !== UNSET) return o;
    const fx = x + fgScroll;
    const fg = this.fgChunks.get(Math.floor(fx / CHUNK_W));
    if (fg && fg.pixmap.get(fx - Math.floor(fx / CHUNK_W) * CHUNK_W, y) !== 0) return FRONT;
    const wx = x + scrollX;
    const k = Math.floor(wx / CHUNK_W);
    const chunk = this.chunks.get(k);
    if (!chunk) return GROUND_BASE;
    return chunk.depthBase[chunk.depth[y * CHUNK_W + (wx - k * CHUNK_W)]];
  }

  /**
   * Stars and the moon, drawn into the sky before the clouds and hills so
   * both pass in front of them. Stars sit almost still (a whisper of
   * parallax) and twinkle; their number grows as night deepens. The moon
   * crosses the sky over the night.
   */
  private drawNightSky(scrollX: number, time: number, phase: number, darkness: number): void {
    const fb = this.fb;
    const starSeed = hashString(this.seed + ":stars");
    const u0 = Math.round(scrollX * 0.02);
    const density = 0.0035 * Math.min(1, (darkness - 0.2) / 0.6);
    const tick = Math.floor(time / 450);
    for (let y = 0; y < HORIZON - 10; y++) {
      for (let x = 0; x < fb.w; x++) {
        const n = noise2i(starSeed, u0 + x, y);
        if (n >= density) continue;
        if (noise2i(starSeed + 1, u0 + x, tick + y) < 0.12) continue;
        fb.data[y * fb.w + x] = C.star;
        if (n < density * 0.12) {
          // a few bright ones get a little cross
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx >= 0 && sx < fb.w && sy >= 0) fb.data[sy * fb.w + sx] = C.star;
          }
        }
      }
    }
    const t = (((phase - 0.72) % 1) + 1) % 1 / 0.56;
    if (t > 1) return;
    const mx = Math.round(fb.w * (0.9 - 0.8 * t));
    const my = Math.round(40 - Math.sin(t * Math.PI) * 24);
    fb.fillCircle(mx, my, 7.5, C.moon);
    for (const [dx, dy, r] of [[-2, -2, 1.6], [2, 1, 1.2], [-1, 3, 0.9]]) fb.fillCircle(mx + dx, my + dy, r, C.cloudShade);
  }

  /**
   * Draws everything that sways — tall grass and tree canopies — fresh
   * each frame, since none of it is baked into the chunk. Within a chunk
   * they go back to front by depth, and each writes only where the
   * chunk's depth buffer says nothing nearer was baked (see `blitBehind`).
   * Sprites never straddle chunks, so per-chunk ordering is enough.
   */
  private drawAnimated(
    chunks: Array<{ k: number; chunk: ChunkResult | ForegroundResult }>,
    scrollX: number,
    time: number,
    owners?: Int16Array,
    front = false,
  ): void {
    const fb = this.fb;
    for (const { k, chunk } of chunks) {
      const chunkLeft = k * CHUNK_W - scrollX;
      const items: Array<{ depth: number; draw: () => void }> = [];
      if ("tallGrass" in chunk) {
        for (const spot of chunk.tallGrass) {
          const screenX = spot.x - scrollX;
          if (screenX < -TILE || screenX >= fb.w) continue;
          const enc = this.encounter(spot.x, spot.y, time);
          items.push({
            depth: spot.depth,
            draw: () => {
              const lean = enc?.rustle ? Math.sin(time / 45 + spot.x) * 3.5 : Math.sin(time / 900 + spot.x * 0.05) * 2.4;
              const rng = keyRng(this.seed, "talltile", spot.k, spot.i, spot.t);
              const tile = tallGrassTile(rng, lean);
              const base = front ? FRONT : spot.y + 30;
              if (!enc || (!enc.eyes && enc.alert < 0)) {
                blitBehind(fb, tile, screenX, spot.y, 1, chunk.depth, chunkLeft, spot.depth, owners, base);
              } else {
                // eyes behind the blades, the bubble above the tuft
                const head = 14;
                const p = new Pixmap(TILE, TILE + head);
                const white = this.darkness > 0.5 ? C.star : C.houseTrim;
                if (enc.eyes) drawPeekingEyes(p, TILE / 2, head + 20, enc.look, enc.blink, white);
                blit(p, tile, 0, head);
                if (enc.alert >= 0) drawAlertBubble(p, TILE / 2, head + 12, enc.alert);
                blitBehind(fb, p, screenX, spot.y - head, 1, chunk.depth, chunkLeft, spot.depth, owners, base);
              }
              if (enc?.rustle) this.drawLeaves(screenX + TILE / 2, spot.y + 18, enc.t, spot.x);
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
              blitBehind(fb, berryCanopyPixmap(sway), screenX, spot.y, 1, chunk.depth, chunkLeft, spot.depth, owners, front ? FRONT : spot.y + 61);
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
            const base = front ? FRONT : spot.y + Math.round(61 * spot.scale);
            blitBehind(fb, treeCanopyPixmap(spot.spec, sway), screenX, spot.y, spot.scale, chunk.depth, chunkLeft, spot.depth, owners, base);
          },
        });
      }
      items.sort((a, b) => a.depth - b.depth);
      for (const item of items) item.draw();
    }
  }

  /**
   * Generate one missing piece of world just beyond the view — world
   * chunks, then foreground chunks, then backdrop strips; ahead in the
   * direction of travel (`dir` = ±1) before behind — so it's cached
   * before it scrolls into view instead of being built mid-frame, which
   * is where scrolling hitched. Meant for idle time between frames, one
   * piece per call. Returns false once the buffer is full.
   */
  prefetch(scrollX: number, dir: number): boolean {
    const around = (first: number, last: number) =>
      dir < 0 ? [first - 1, first - 2, last + 1] : [last + 1, last + 2, first - 1];
    const w = this.fb.w;
    const first = Math.floor(scrollX / CHUNK_W);
    const last = Math.floor((scrollX + w - 1) / CHUNK_W);
    for (const k of around(first, last)) {
      if (!this.chunks.has(k)) {
        this.getChunk(k);
        return true;
      }
    }
    const fgScroll = Math.round(scrollX * PARALLAX);
    const fgFirst = Math.floor(fgScroll / CHUNK_W);
    const fgLast = Math.floor((fgScroll + w - 1) / CHUNK_W);
    for (const k of around(fgFirst, fgLast)) {
      if (!this.fgChunks.has(k)) {
        this.getFgChunk(k);
        return true;
      }
    }
    return this.backdrop.prefetch(scrollX, w, dir);
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

  /**
   * Color the frame for the hour and put it on screen: each palette index
   * maps through the hour's palette, except inside a street lamp's light
   * (the lantern's glow and a pool on the ground below), which takes the
   * warm lamplit palette instead — only once it's dark enough to matter.
   */
  private present(pal: DayPalette, visible: Array<{ k: number; chunk: ChunkResult }>, scrollX: number, fgScroll: number): void {
    const fb = this.fb;
    if (!this.image || this.image.width !== fb.w) this.image = this.offctx.createImageData(fb.w, fb.h);
    const data32 = new Uint32Array(this.image.data.buffer);
    const src = fb.data;
    if (visible.length > 0) {
      const mask = this.lightMask;
      mask.fill(0);
      for (const { k, chunk } of visible) {
        for (const l of chunk.lights) {
          const x = k * CHUNK_W - scrollX + l.x;
          this.lightEllipse(x, l.headY, 9, 9, 0.55, l.baseY, scrollX, fgScroll);
          this.lightEllipse(x, l.baseY, 30 * pal.darkness + 6, 10 * pal.darkness + 2, 0.5, l.baseY, scrollX, fgScroll);
        }
      }
      for (let i = 0; i < src.length; i++) data32[i] = mask[i] ? pal.lit[src[i]] : pal.base[src[i]];
    } else {
      for (let i = 0; i < src.length; i++) data32[i] = pal.base[src[i]];
    }
    this.offctx.putImageData(this.image, 0, 0);
    this.octx.imageSmoothingEnabled = false;
    this.octx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Mark an elliptical pool of lamplight: solid inside `inner` (0..1 of
   * the radius), dithered out to the edge — but only on pixels of things
   * at or behind the lamp (base y no lower than `lampBase`): the ground,
   * the lamp itself, house walls behind it. A tree or bush standing in
   * front of the lamp stays in the dark, rather than the light being
   * painted over it.
   */
  private lightEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    inner: number,
    lampBase: number,
    scrollX: number,
    fgScroll: number,
  ): void {
    const fb = this.fb;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(fb.h - 1, cy + ry); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(fb.w - 1, cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        if (d > inner && ditherThreshold(x, y) <= (d - inner) / (1 - inner)) continue;
        if (this.ownerBase(x, y, scrollX, fgScroll) <= lampBase) this.lightMask[y * fb.w + x] = 1;
      }
    }
  }

}
