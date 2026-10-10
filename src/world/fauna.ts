import { Pixmap, blit } from "../core/pixmap";
import { keyRng } from "../core/prng";
import { C } from "../core/palette";
import { flyerPixmap, type FlyerKind } from "../sprites/flyers";

/**
 * Creatures crossing the sky, as silhouettes. Every few seconds a flock
 * may set off from one edge of the view and fly across it: small birds
 * in a V or a loose bunch, now and then a single large bird soaring, and
 * after dusk, bats. They fly at their own parallax depth (between the
 * far and mid hills, which hide anything flying low behind a ridge).
 * Each flock's makeup comes from its event index; where it enters is set
 * by the view at that moment.
 */

/** How fast the flying layer scrolls relative to the world. */
const PARALLAX = 0.4;
/** A chance of a new flock this often. */
const EVENT_MS = 6500;

interface Flyer {
  dx: number;
  dy: number;
  /** Wing-beat offset, so a flock doesn't flap in lockstep. */
  phase: number;
}

interface Flock {
  kind: FlyerKind;
  /** Layer-space x of the flock's leader at spawn, and its direction (±1). */
  u0: number;
  dir: number;
  /** px per second. */
  speed: number;
  y: number;
  born: number;
  members: Flyer[];
}

/** Wing pose cycles (indices into the kind's poses), ping-ponging where that reads better. */
const CYCLES: Record<FlyerKind, number[]> = {
  bird: [0, 1, 2, 1],
  soarer: [0, 1, 2, 1],
  bat: [0, 1],
};

export class SkyFauna {
  private flocks: Flock[] = [];
  private lastEvent: number | null = null;

  constructor(private seed: string) {}

  draw(fb: Pixmap, scrollX: number, time: number, darkness: number): void {
    const event = Math.floor(time / EVENT_MS);
    if (event !== this.lastEvent) {
      this.lastEvent = event;
      const flock = this.roll(event, scrollX, fb.w, darkness, event * EVENT_MS);
      if (flock && this.flocks.length < 3) this.flocks.push(flock);
    }

    const view = scrollX * PARALLAX;
    this.flocks = this.flocks.filter((f) => {
      const age = (time - f.born) / 1000;
      const lead = f.u0 + f.dir * f.speed * age - view;
      // gone once the whole flock is past the far edge
      return f.dir > 0 ? lead < fb.w + 120 : lead > -120;
    });
    for (const f of this.flocks) this.drawFlock(fb, f, view, time);
  }

  /**
   * What (if anything) sets off at event `e`. By day: small-bird flocks,
   * sometimes a soaring bird; after dusk, bats instead, and fewer flocks.
   */
  private roll(e: number, scrollX: number, viewW: number, darkness: number, born: number): Flock | null {
    const rng = keyRng(this.seed, "flock", e);
    const night = darkness > 0.4;
    if (rng() > (night ? 0.35 : 0.7)) return null;
    const dir = rng() < 0.5 ? 1 : -1;
    const r = rng();
    const kind: FlyerKind = night ? "bat" : r < 0.18 ? "soarer" : "bird";
    const view = scrollX * PARALLAX;
    const u0 = view + (dir > 0 ? -30 : viewW + 30);
    const members: Flyer[] = [];
    if (kind === "soarer") {
      members.push({ dx: 0, dy: 0, phase: rng() });
    } else if (kind === "bird" && rng() < 0.55) {
      // a V: a leader with wings trailing back above and below it
      const n = 5 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const rank = Math.ceil(i / 2);
        const side = i % 2 === 0 ? 1 : -1;
        members.push({ dx: -dir * rank * 7, dy: side * rank * 3, phase: rng() });
      }
    } else {
      const n = kind === "bat" ? 3 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 6);
      for (let i = 0; i < n; i++) {
        members.push({ dx: -dir * rng() * 40, dy: (rng() * 2 - 1) * 10, phase: rng() });
      }
    }
    const speed = kind === "soarer" ? 14 + rng() * 8 : kind === "bat" ? 26 + rng() * 14 : 22 + rng() * 16;
    // bats keep to open sky: dark against the dark hills they'd vanish
    const y = kind === "bat" ? 26 + rng() * 34 : kind === "soarer" ? 14 + rng() * 26 : 20 + rng() * 56;
    return { kind, u0, dir, speed, y, born, members };
  }

  private drawFlock(fb: Pixmap, f: Flock, view: number, time: number): void {
    const age = (time - f.born) / 1000;
    const cycle = CYCLES[f.kind];
    const lead = f.u0 + f.dir * f.speed * age - view;
    f.members.forEach((m, i) => {
      let pose: number;
      let bob: number;
      if (f.kind === "soarer") {
        // a few slow beats, then a long glide on outstretched wings
        const beat = (age + m.phase * 4) % 5;
        pose = beat < 1.6 ? cycle[Math.floor(beat * 5) % cycle.length] : 1;
        bob = Math.sin(age * 0.8) * 2;
      } else if (f.kind === "bat") {
        pose = cycle[Math.floor(age * 14 + m.phase * 2) % cycle.length];
        bob = Math.sin(age * 9 + i * 1.7) * 2.5 + Math.sin(age * 3.1 + i) * 2;
      } else {
        pose = cycle[Math.floor(age * 9 + m.phase * 4) % cycle.length];
        bob = Math.sin(age * 2.2 + i * 0.9) * 1.5;
      }
      const sprite = flyerPixmap(f.kind, pose);
      const x = Math.round(lead + m.dx - sprite.w / 2);
      const y = Math.round(f.y + m.dy + bob);
      if (x + sprite.w < 0 || x >= fb.w) return;
      // bats fly against the night sky: a thin moonlit rim along their
      // top edges keeps the silhouette readable on dark navy
      if (f.kind === "bat") blit(fb, flyerPixmap(f.kind, pose, C.cloudShade), x, y - 1);
      blit(fb, sprite, x, y);
    });
  }
}
