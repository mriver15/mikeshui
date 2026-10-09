import { Renderer } from "./world/renderer";
import { VIEW_H } from "./world/worldgen";

interface AppState {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  seedLabel: HTMLElement;
  scrollX: number;
  logicalW: number;
  seed: string;
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
      <div class="subtitle">procedural Hoenn-inspired landscape</div>
      <div class="seed">seed&nbsp;<span id="seed">${seed}</span></div>
      <div class="controls">
        <button id="left">◀</button>
        <button id="right">▶</button>
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
    scrollX: 0,
    logicalW: 0,
    seed,
  };

  // Continuous render loop (drives the water, sway and drifting clouds).
  const loop = (time: number) => {
    renderer.draw(state.scrollX, time);
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

  const scrollBy = (dx: number) => {
    state.scrollX = Math.max(0, state.scrollX + dx);
  };

  window.addEventListener("resize", resize);

  ui.querySelector("#left")?.addEventListener("click", () => scrollBy(-64));
  ui.querySelector("#right")?.addEventListener("click", () => scrollBy(64));
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

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      scrollBy(-32);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      scrollBy(32);
      e.preventDefault();
    }
  });

  let dragging = false;
  let lastX = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    const scale = canvas.clientWidth / state.logicalW;
    scrollBy(-dx / scale);
  });
  canvas.addEventListener("pointerup", () => (dragging = false));
  canvas.addEventListener("pointercancel", () => (dragging = false));

  resize();
}

function setUrlSeed(seed: string): void {
  const u = new URL(window.location.href);
  u.searchParams.set("seed", seed);
  window.history.replaceState(null, "", u.toString());
}
