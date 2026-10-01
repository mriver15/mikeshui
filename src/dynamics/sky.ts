import * as THREE from "three";
import { mulberry32, hashString, type RNG } from "../core/prng";
import { VIEW_H } from "../world/worldgen";

function lerp(range: [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

interface CloudLayer {
  count: number;
  scaleRange: [number, number];
  /** Distance from the top of the view (not the bottom) — smaller is higher/further away. */
  topRange: [number, number];
  speedRange: [number, number];
  opacityRange: [number, number];
  tint: number;
  z: number;
}

/**
 * Three.js overlay: drifting clouds (two depth layers for a sense of
 * distance) and swaying foreground grass, composited over the pixel-art
 * world canvas. The camera uses the same logical height (VIEW_H) as the 2D
 * renderer, with +Y up (y = VIEW_H - logicalY).
 */
export class SkyDynamics {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private clouds: Array<{ sprite: THREE.Sprite; speed: number }> = [];
  private grass: THREE.InstancedMesh;
  private grassCount: number;
  private grassX: Float32Array;
  private grassPhase: Float32Array;
  private grassLean: Float32Array;
  private logicalW: number;
  private lastTime = 0;
  private dummy = new THREE.Object3D();

  constructor(private canvas: HTMLCanvasElement, seed: string) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.logicalW = 512;
    this.camera = new THREE.OrthographicCamera(0, this.logicalW, 0, VIEW_H, -100, 100);
    this.camera.position.z = 1;

    const rng = mulberry32(hashString(seed + ":sky"));
    const cloudRng = mulberry32(hashString(seed + ":clouds"));

    // clouds: a hazy, slow, grayish-blue far layer and a brighter, faster
    // near layer, each cloud its own noise-shaped blob cluster (not one
    // texture rescaled) so no two look alike.
    const layers: CloudLayer[] = [
      { count: 7, scaleRange: [30, 52], topRange: [10, 70], speedRange: [0.6, 1.8], opacityRange: [0.35, 0.55], tint: 0xc3cfe0, z: -5 },
      { count: 5, scaleRange: [58, 96], topRange: [70, 150], speedRange: [2, 5], opacityRange: [0.7, 0.92], tint: 0xfdfdfa, z: -3 },
    ];
    for (const layer of layers) {
      for (let i = 0; i < layer.count; i++) {
        const tex = makeCloudTexture(cloudRng);
        const shadeJitter = 0.88 + cloudRng() * 0.24;
        const mat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          opacity: lerp(layer.opacityRange, cloudRng()),
          color: new THREE.Color(layer.tint).multiplyScalar(shadeJitter),
        });
        const sprite = new THREE.Sprite(mat);
        const w = lerp(layer.scaleRange, cloudRng());
        sprite.scale.set(w, w * 0.42, 1);
        sprite.position.set(cloudRng() * this.logicalW, VIEW_H - lerp(layer.topRange, cloudRng()), layer.z);
        const speed = lerp(layer.speedRange, cloudRng());
        this.scene.add(sprite);
        this.clouds.push({ sprite, speed });
      }
    }

    // swaying grass blades
    this.grassCount = 150;
    const bladeGeo = new THREE.PlaneGeometry(2, 16, 1, 1);
    bladeGeo.translate(0, 8, 0); // origin at base
    const bladeMat = new THREE.MeshBasicMaterial({ color: 0x398b31, side: THREE.DoubleSide });
    this.grass = new THREE.InstancedMesh(bladeGeo, bladeMat, this.grassCount);
    this.grassX = new Float32Array(this.grassCount);
    this.grassPhase = new Float32Array(this.grassCount);
    this.grassLean = new Float32Array(this.grassCount);
    for (let i = 0; i < this.grassCount; i++) {
      this.grassX[i] = rng() * this.logicalW;
      this.grassPhase[i] = rng() * Math.PI * 2;
      this.grassLean[i] = (rng() - 0.5) * 0.35;
    }
    this.scene.add(this.grass);
  }

  resize(logicalW: number): void {
    this.logicalW = logicalW;
    this.camera.left = 0;
    this.camera.right = logicalW;
    this.camera.top = VIEW_H;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.width, this.canvas.height, false);
  }

  render(time: number): void {
    const t = time / 1000;
    const dt = Math.min(0.1, this.lastTime === 0 ? 0.016 : t - this.lastTime);
    this.lastTime = t;

    // drifting clouds (wrap around)
    for (const { sprite, speed } of this.clouds) {
      sprite.position.x += speed * dt;
      if (sprite.position.x > this.logicalW + 80) sprite.position.x = -80;
    }

    // swaying grass
    const dummy = this.dummy;
    for (let i = 0; i < this.grassCount; i++) {
      const lean =
        this.grassLean[i] +
        Math.sin(t * 2.2 + this.grassPhase[i] + this.grassX[i] * 0.02) * 0.1;
      dummy.position.set(this.grassX[i], 3, 0);
      dummy.rotation.z = lean;
      dummy.updateMatrix();
      this.grass.setMatrixAt(i, dummy.matrix);
    }
    this.grass.instanceMatrix.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }
}

/**
 * A single cloud's silhouette: a noise-varied chain of 5-8 overlapping
 * blobs (count, size, and spacing all drawn from `rng`) with a soft gray
 * undershadow drawn first, so each cloud is its own shape rather than a
 * shared texture stretched to different sizes.
 */
function makeCloudTexture(rng: RNG): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 72;
  const ctx = c.getContext("2d")!;

  const n = 5 + Math.floor(rng() * 4);
  const midY = 36;
  const blobs: Array<[number, number, number]> = [];
  let x = 16 + rng() * 14;
  for (let i = 0; i < n; i++) {
    const r = 10 + rng() * 13;
    const y = midY + (rng() - 0.5) * 10 - r * 0.12;
    blobs.push([x, y, r]);
    x += r * (0.7 + rng() * 0.55);
    if (x > 148) break;
  }

  ctx.fillStyle = "rgba(150,162,182,0.5)";
  for (const [bx, by, r] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by + r * 0.32, r * 0.92, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  for (const [bx, by, r] of blobs) {
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
