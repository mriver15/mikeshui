import * as THREE from "three";
import { mulberry32, hashString } from "../core/prng";
import { VIEW_H } from "../world/worldgen";

/**
 * Three.js overlay: dynamic sky (drifting clouds + sun) and swaying foreground
 * grass, composited over the pixel-art world canvas. The camera uses the same
 * logical height (VIEW_H) as the 2D renderer, with +Y up (y = VIEW_H - logicalY).
 */
export class SkyDynamics {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private clouds: Array<{ sprite: THREE.Sprite; speed: number }> = [];
  private sun: THREE.Sprite;
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

    // clouds
    const cloudTex = makeCloudTexture();
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      });
      const sprite = new THREE.Sprite(mat);
      const w = 70 + rng() * 80;
      sprite.scale.set(w, w * 0.42, 1);
      sprite.position.set(rng() * this.logicalW, VIEW_H - (20 + rng() * 62), -2);
      const speed = 2 + rng() * 7;
      sprite.userData.speed = speed;
      this.scene.add(sprite);
      this.clouds.push({ sprite, speed });
    }

    // sun
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeSunTexture(), transparent: true, depthWrite: false }),
    );
    this.sun.scale.set(120, 120, 1);
    this.sun.position.set(this.logicalW * 0.72, VIEW_H - 30, -3);
    this.scene.add(this.sun);

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

function makeCloudTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const blobs: Array<[number, number, number]> = [
    [40, 40, 18],
    [64, 33, 22],
    [90, 40, 18],
    [64, 45, 20],
  ];
  for (const [x, y, r] of blobs) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function makeSunTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, "rgba(255,250,220,1)");
  g.addColorStop(0.35, "rgba(255,242,190,0.85)");
  g.addColorStop(1, "rgba(255,242,190,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
