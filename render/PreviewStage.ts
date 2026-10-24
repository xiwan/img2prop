import * as THREE from 'three';
import { PixelRenderer, type PixelSettings } from './PixelRenderer.ts';
import { toon } from './materials.ts';
import { woodFloor } from './textures.ts';
import { LightRig, type LightSettings } from './lighting.ts';

/**
 * 嵌在页面里的像素预览：一块地板、一套灯（render/lighting.ts，默认三盏）、一个转台。
 * 拖动鼠标转动物体；用和游戏完全相同的像素管线渲染。
 */
export class PreviewStage {
  readonly scene = new THREE.Scene();
  readonly turntable = new THREE.Group();
  readonly settings: PixelSettings;
  readonly pixel: PixelRenderer;
  readonly lights: LightRig;
  readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshToonMaterial>;
  autoSpin = 0.4;
  private dragging = false;
  private lastX = 0;

  /** floor：wood = 木地板（人物），felt = 素色台面（小道具）；lights 不给 = 默认那套 */
  constructor(container: HTMLElement, opts: Partial<PixelSettings> = {}, floorKind: 'wood' | 'felt' = 'wood', lights?: LightSettings) {
    this.settings = {
      baseHeight: 270, viewHeight: 3, pitchDeg: 35, outline: true, depthThreshold: 0.05,
      outlineDarken: 0.3, highlight: 0.3, posterize: 0, dither: true, snap: false, exposure: 1.2,
      ...opts,
    };
    this.pixel = new PixelRenderer(this.settings, container);

    // 素色台面铺大一点：大门这种几米高的东西，斜着看会看到 12 米的边外头（黑的）
    const floorMat = floorKind === 'wood' ? toon(0xffffff, { map: woodFloor(3, 3, 0x3a2a20) }) : toon(0x34323c);
    const floorSize = floorKind === 'wood' ? 12 : 200;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor, this.turntable);
    this.lights = new LightRig(this.scene, lights);

    const canvas = this.pixel.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.turntable.rotation.y += (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
    });
    canvas.addEventListener('pointerup', () => (this.dragging = false));
  }

  /** 主光（投影子的那盏） */
  get key(): THREE.DirectionalLight {
    return this.lights.key;
  }

  /** 让镜头对准物体中心，视野按物体大小缩放 */
  fit(object: THREE.Object3D, margin = 1.8, minView = 0.5): void {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.settings.viewHeight = Math.max(minView, Math.max(size.x, size.y, size.z) * margin);
    this.pixel.target.set(center.x, center.y * 0.6, center.z);
  }

  /** 把道具挪到转台中心、底部贴地（武器的原点在握把上）；阴影的范围、灯记号的大小跟着东西的大小（阴影至少 ±3 米，小东西和以前一样） */
  place(obj: THREE.Object3D): void {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    const c = b.getCenter(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= b.min.y;
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(3, Math.max(size.x, size.y, size.z) * 1.2);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.updateProjectionMatrix();
    this.lights.gizmoRadius = Math.max(size.x, size.y, size.z) * 0.5;
    this.lights.center.set(0, size.y / 2, 0);
  }

  setContent(object: THREE.Object3D | null): void {
    this.turntable.clear();
    if (object) this.turntable.add(object);
  }

  render(dt: number): void {
    if (!this.dragging) this.turntable.rotation.y += this.autoSpin * dt;
    this.lights.updateGizmos();
    this.pixel.render(this.scene);
  }
}
