import { Renderer } from "./world/renderer";
import { VIEW_H, CHUNK_W } from "./world/worldgen";

interface AppState {
  renderer: Renderer;
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

  const view = document.createElement("div");
  view.className = "view";
  root.appendChild(view);

  const ui = document.createElement("div");
  ui.className = "ui";
  ui.innerHTML = `
    <div class="panel">
      <div class="title">mikeshui</div>
      <div class="subtitle">infinite ink-wash landscape</div>
      <div class="seed">seed&nbsp;<span id="seed">${seed}</span></div>
      <div class="controls">
        <button id="left">◀</button>
        <button id="right">▶</button>
        <button id="new">✦ new</button>
        <button id="dlsvg">↓ svg</button>
        <button id="dlpng">↓ png</button>
      </div>
      <div class="hint">← → or drag to wander</div>
    </div>`;
  root.appendChild(ui);

  const renderer = new Renderer(seed, view);
  const state: AppState = { renderer, scrollX: 0, logicalW: CHUNK_W, seed };

  const render = () => renderer.draw(state.scrollX);

  const resize = () => {
    const w = view.clientWidth || window.innerWidth;
    const h = view.clientHeight || window.innerHeight;
    state.logicalW = Math.max(200, Math.round(VIEW_H * (w / h)));
    renderer.resize(state.logicalW);
    render();
  };

  const scrollBy = (dx: number) => {
    state.scrollX = Math.max(0, state.scrollX + dx);
    render();
  };

  window.addEventListener("resize", resize);

  ui.querySelector("#left")?.addEventListener("click", () => scrollBy(-state.logicalW * 0.2));
  ui.querySelector("#right")?.addEventListener("click", () => scrollBy(state.logicalW * 0.2));
  ui.querySelector("#new")?.addEventListener("click", () => {
    const next = String(Date.now());
    setUrlSeed(next);
    state.seed = next;
    (ui.querySelector("#seed") as HTMLElement).textContent = next;
    renderer.setSeed(next);
    render();
  });
  ui.querySelector("#dlsvg")?.addEventListener("click", () => {
    const svg = renderer.exportSvg(state.scrollX);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    triggerDownload(URL.createObjectURL(blob), `mikeshui-${state.seed}.svg`);
  });
  ui.querySelector("#dlpng")?.addEventListener("click", () => {
    const svg = renderer.exportSvg(state.scrollX);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = state.logicalW * scale;
      canvas.height = VIEW_H * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f4ede0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        triggerDownload(URL.createObjectURL(blob), `mikeshui-${state.seed}.png`);
      });
    };
    img.src = url;
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      scrollBy(-state.logicalW * 0.1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      scrollBy(state.logicalW * 0.1);
      e.preventDefault();
    }
  });

  let dragging = false;
  let lastX = 0;
  view.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    const scale = view.clientWidth / state.logicalW;
    scrollBy(-dx / scale);
  });
  view.addEventListener("pointerup", () => (dragging = false));
  view.addEventListener("pointercancel", () => (dragging = false));

  resize();
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setUrlSeed(seed: string): void {
  const u = new URL(window.location.href);
  u.searchParams.set("seed", seed);
  window.history.replaceState(null, "", u.toString());
}
