import { Renderer } from "./world/renderer";
import { VIEW_H } from "./world/worldgen";

interface AppState {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  seedLabel: HTMLElement;
  logicalW: number;
  seed: string;
}

/** Top speed while an arrow key is held, in world px per second. */
const MAX_SPEED = 260;
/** How quickly a held arrow key gets up to speed (px/s²). */
const ACCEL = 1100;
/** How quickly momentum dies away once nothing is pushing (per second). */
const FRICTION = 4.5;
/** How tightly the view follows its target (per second): higher is snappier. */
const FOLLOW = 14;
/** How far one click of an arrow button glides. */
const BUTTON_STEP = 96;

/** One full day, in ms of real time. */
const DAY_LENGTH = 8 * 60 * 1000;

/**
 * Named times of day, as day phases (0 midnight, 0.5 noon): what the
 * time button steps through and the `?time=` URL parameter accepts.
 */
const TIMES: Array<{ name: string; icon: string; phase: number }> = [
  { name: "dawn", icon: "◒", phase: 0.26 },
  { name: "day", icon: "☀", phase: 0.42 },
  { name: "dusk", icon: "◓", phase: 0.75 },
  { name: "night", icon: "☾", phase: 0.95 },
];

/**
 * Scroll motion: the view eases toward a target position instead of
 * jumping, holding an arrow key accelerates the target to a cruising
 * speed and letting go coasts it to a stop, and a drag tracks the pointer
 * exactly then flings on release. The renderer gets the position rounded
 * to whole pixels, so the pixel art never smears.
 */
interface Motion {
  x: number;
  target: number;
  velocity: number;
  /** -1 / 0 / +1 from the arrow keys currently held. */
  held: number;
  dragging: boolean;
  /** Smoothed pointer velocity during a drag, for the release fling. */
  dragVelocity: number;
  /** Last direction of travel, for which way to prefetch. */
  heading: number;
}

export function boot(root: HTMLElement): void {
  let seed = new URLSearchParams(window.location.search).get("seed") || "";
  if (!seed) {
    seed = String(Date.now());
    setUrlSeed(seed);
  }

  const canvas = document.createElement("canvas");
  canvas.className = "view";
  root.appendChild(canvas);

  const ui = document.createElement("div");
  ui.className = "ui";
  ui.innerHTML = `
    <div class="panel">
      <div class="title">EMERALD FIELD</div>
      <div class="subtitle">procedural pixel-art landscape</div>
      <div class="seed">seed&nbsp;<span id="seed">${seed}</span></div>
      <div class="controls">
        <button id="left">◀</button>
        <button id="right">▶</button>
        <button id="time">☀ day</button>
        <button id="new">✦ new</button>
        <button id="dl">↓ png</button>
      </div>
      <div class="hint">← → or drag to wander</div>
    </div>`;
  root.appendChild(ui);

  const renderer = new Renderer(seed, canvas);
  const state: AppState = {
    renderer,
    canvas,
    seedLabel: ui.querySelector("#seed") as HTMLElement,
    logicalW: 0,
    seed,
  };
  const motion: Motion = { x: 0, target: 0, velocity: 0, held: 0, dragging: false, dragVelocity: 0, heading: 1 };

  // Idle-time buffer: between frames, build the world just past the edge
  // of the view (in the direction of travel) so new chunks are already
  // cached when they scroll in, instead of being generated mid-frame.
  let prefetching = false;
  const schedulePrefetch = () => {
    if (prefetching) return;
    prefetching = true;
    whenIdle((timeLeft, overdue) => {
      prefetching = false;
      // overdue: the browser never went idle in time, so build one piece
      // anyway rather than starving the buffer while scrolling
      if (overdue && !renderer.prefetch(Math.round(motion.x), motion.heading)) return;
      while (timeLeft() > 6) {
        if (!renderer.prefetch(Math.round(motion.x), motion.heading)) return;
      }
      schedulePrefetch();
    });
  };

  // time of day: a slow cycle from a starting hour (late morning, or
  // ?time=dawn|day|dusk|night); the time button jumps to the next one
  const startName = new URLSearchParams(window.location.search).get("time");
  let phaseOffset = TIMES.find((t) => t.name === startName)?.phase ?? 0.38;
  const phaseAt = (time: number) => (((time / DAY_LENGTH + phaseOffset) % 1) + 1) % 1;
  const timeButton = ui.querySelector("#time") as HTMLButtonElement;
  let shownTime = "";
  const showTime = (phase: number) => {
    // the latest named time at or before this phase, wrapping past midnight
    const current = [...TIMES].reverse().find((t) => t.phase <= phase) ?? TIMES[TIMES.length - 1];
    if (current.name === shownTime) return;
    shownTime = current.name;
    timeButton.textContent = `${current.icon} ${current.name}`;
  };
  timeButton.addEventListener("click", () => {
    const now = phaseAt(performance.now());
    const next = TIMES.find((t) => t.phase > now + 0.01) ?? TIMES[0];
    phaseOffset += (((next.phase - now) % 1) + 1) % 1;
  });

  // Continuous render loop (drives scrolling, time of day, the water, sway and drifting clouds).
  let lastTime = 0;
  const loop = (time: number) => {
    const dt = Math.min(0.05, lastTime ? (time - lastTime) / 1000 : 0);
    lastTime = time;
    step(motion, dt);
    const phase = phaseAt(time);
    showTime(phase);
    renderer.draw(Math.round(motion.x), time, phase);
    schedulePrefetch();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    state.logicalW = Math.max(VIEW_H, Math.round(VIEW_H * (w / h)));
    renderer.resize(state.logicalW);
  };

  window.addEventListener("resize", resize);

  const nudge = (dx: number) => {
    motion.target = Math.max(0, motion.target + dx);
    motion.heading = Math.sign(dx);
  };
  ui.querySelector("#left")?.addEventListener("click", () => nudge(-BUTTON_STEP));
  ui.querySelector("#right")?.addEventListener("click", () => nudge(BUTTON_STEP));
  ui.querySelector("#new")?.addEventListener("click", () => {
    const next = String(Date.now());
    setUrlSeed(next);
    state.seed = next;
    state.seedLabel.textContent = next;
    renderer.setSeed(next);
  });
  ui.querySelector("#dl")?.addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `emerald-field-${state.seed}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  // arrow keys: track which are held (ignoring auto-repeat) rather than
  // stepping on each repeat event
  const keys = { left: false, right: false };
  const updateHeld = () => (motion.held = (keys.right ? 1 : 0) - (keys.left ? 1 : 0));
  window.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    if (e.key === "ArrowLeft") keys.left = true;
    else keys.right = true;
    updateHeld();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") keys.left = false;
    else if (e.key === "ArrowRight") keys.right = false;
    updateHeld();
  });
  window.addEventListener("blur", () => {
    keys.left = keys.right = false;
    updateHeld();
  });

  // drag: the view follows the pointer 1:1, then flings with the drag's
  // momentum on release
  let lastX = 0;
  let lastMoveTime = 0;
  canvas.addEventListener("pointerdown", (e) => {
    motion.dragging = true;
    motion.velocity = 0;
    motion.dragVelocity = 0;
    lastX = e.clientX;
    lastMoveTime = e.timeStamp;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!motion.dragging) return;
    const scale = canvas.clientWidth / state.logicalW;
    const dx = -(e.clientX - lastX) / scale;
    const dt = Math.max(1, e.timeStamp - lastMoveTime) / 1000;
    lastX = e.clientX;
    lastMoveTime = e.timeStamp;
    motion.target = Math.max(0, motion.target + dx);
    motion.x = motion.target;
    motion.dragVelocity = motion.dragVelocity * 0.6 + (dx / dt) * 0.4;
    if (dx !== 0) motion.heading = Math.sign(dx);
  });
  const endDrag = (e: PointerEvent) => {
    if (!motion.dragging) return;
    motion.dragging = false;
    // a drag that stopped before release shouldn't fling
    const still = e.timeStamp - lastMoveTime > 80;
    const fling = still ? 0 : motion.dragVelocity;
    motion.velocity = Math.max(-MAX_SPEED * 2, Math.min(MAX_SPEED * 2, fling));
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  resize();
}

/** Advance the scroll motion by `dt` seconds. */
function step(m: Motion, dt: number): void {
  if (m.dragging) return;
  if (m.held !== 0) {
    m.velocity += m.held * ACCEL * dt;
    m.velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, m.velocity));
  } else {
    m.velocity *= Math.exp(-FRICTION * dt);
    if (Math.abs(m.velocity) < 4) m.velocity = 0;
  }
  m.target += m.velocity * dt;
  if (m.target < 0) {
    m.target = 0;
    m.velocity = 0;
  }
  m.x += (m.target - m.x) * (1 - Math.exp(-FOLLOW * dt));
  if (Math.abs(m.target - m.x) < 0.05) m.x = m.target;
  if (m.velocity !== 0) m.heading = Math.sign(m.velocity);
}

/**
 * Run `work` when the browser is idle, passing how many ms it may still
 * use and whether it's overdue (the idle wait timed out); falls back to a
 * short timeout with a fixed budget where requestIdleCallback is missing.
 */
function whenIdle(work: (timeLeft: () => number, overdue: boolean) => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback((deadline) => work(() => deadline.timeRemaining(), deadline.didTimeout), { timeout: 250 });
  } else {
    setTimeout(() => {
      const start = performance.now();
      work(() => 10 - (performance.now() - start), false);
    }, 16);
  }
}

function setUrlSeed(seed: string): void {
  const u = new URL(window.location.href);
  u.searchParams.set("seed", seed);
  window.history.replaceState(null, "", u.toString());
}
