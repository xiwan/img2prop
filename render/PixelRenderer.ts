import * as THREE from 'three';

/** 渲染层：场景先画到低分辨率缓冲，做描边和色阶，再整数倍放大到屏幕。 */
export interface PixelSettings {
  baseHeight: number;     // 期望的像素高度，实际会取整数倍缩放后最接近的值
  viewHeight: number;     // 画面纵向覆盖的世界尺寸（米）
  pitchDeg: number;       // 镜头俯角，90 = 正俯视
  outline: boolean;
  depthThreshold: number; // 深度差超过多少米算轮廓
  outlineDarken: number;  // 轮廓颜色 = 原色 × 该值
  highlight: number;      // 法线折边提亮
  posterize: number;      // 每通道色阶数，0 = 关闭
  dither: boolean;
  snap: boolean;          // 镜头吸附像素网格，消除移动时的像素闪烁
  exposure: number;
}

export const EFFECT_LAYER = 1; // 特效层：不参与法线/描边

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 resolution;
uniform float depthRange;
uniform float outlineOn;
uniform float depthThreshold;
uniform float outlineDarken;
uniform float highlight;
uniform float posterize;
uniform float ditherOn;
uniform float exposure;
varying vec2 vUv;

float getDepth(vec2 uv) { return texture2D(tDepth, uv).x * depthRange; }
vec3 getNormal(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

// 中间调保持线性，只把高光柔和地压到 1，颜色比 ACES 更饱和、更像像素画
vec3 softClip(vec3 x) {
  const float knee = 0.7;
  vec3 over = max(x - knee, 0.0);
  return min(x, vec3(knee)) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void edge(vec2 offs, float d, vec3 n, inout float dEdge, inout float nEdge) {
  vec2 uv = vUv + offs / resolution;
  float dn = getDepth(uv);
  vec3 nn = getNormal(uv);
  // 邻居更远 → 当前像素是前景物体的轮廓
  dEdge = max(dEdge, dn - d);
  // 折边只亮一侧，且邻居不能在前面
  float side = step(0.0, dot(n - nn, vec3(1.0)));
  nEdge += side * (1.0 - dot(n, nn)) * step(-0.05, dn - d);
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d = getDepth(vUv);
  vec3 n = getNormal(vUv);
  float dEdge = 0.0;
  float nEdge = 0.0;
  edge(vec2( 1.0,  0.0), d, n, dEdge, nEdge);
  edge(vec2(-1.0,  0.0), d, n, dEdge, nEdge);
  edge(vec2( 0.0,  1.0), d, n, dEdge, nEdge);
  edge(vec2( 0.0, -1.0), d, n, dEdge, nEdge);

  if (outlineOn > 0.5) {
    if (dEdge > depthThreshold) col *= outlineDarken;
    else if (nEdge > 0.35) col *= 1.0 + highlight;
  }

  col = toSRGB(softClip(col * exposure));

  if (posterize > 1.5) {
    float b = ditherOn > 0.5 ? bayer4(gl_FragCoord.xy) : 0.5;
    col = floor(col * (posterize - 1.0) + b) / (posterize - 1.0);
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// 输出已经是 sRGB，这里只做带亚像素偏移的最近邻放大
const BLIT_FRAG = /* glsl */ `
uniform sampler2D tOut;
uniform vec2 bufferSize;
uniform vec2 visibleSize;
uniform vec2 offset;
varying vec2 vUv;
void main() {
  vec2 t = vec2(1.0) + offset + vUv * visibleSize;
  gl_FragColor = texture2D(tOut, t / bufferSize);
}
`;

export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera();
  readonly target = new THREE.Vector3();

  /** 可见区域的低分辨率尺寸（缓冲四周各多 1 像素用于亚像素平移） */
  width = 0;
  height = 0;
  scale = 1;

  private readonly near = 0.1;
  private readonly far = 120;
  private readonly distance = 50;
  private readonly offset = new THREE.Vector2();

  private colorTarget!: THREE.WebGLRenderTarget;
  private normalTarget!: THREE.WebGLRenderTarget;
  private outTarget!: THREE.WebGLRenderTarget;
  private readonly normalMaterial = new THREE.MeshNormalMaterial();
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly blitMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  readonly settings: PixelSettings;
  private readonly container: HTMLElement;

  /** container 不传则铺满整个窗口；传了就按容器大小渲染（预览窗口用） */
  constructor(settings: PixelSettings, container: HTMLElement = document.body) {
    this.settings = settings;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 1);
    this.container.appendChild(this.renderer.domElement);

    this.camera.rotation.order = 'YXZ';

    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        resolution: { value: new THREE.Vector2() },
        depthRange: { value: this.far - this.near },
        outlineOn: { value: 1 },
        depthThreshold: { value: 0 },
        outlineDarken: { value: 0 },
        highlight: { value: 0 },
        posterize: { value: 0 },
        ditherOn: { value: 1 },
        exposure: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: {
        tOut: { value: null },
        bufferSize: { value: new THREE.Vector2() },
        visibleSize: { value: new THREE.Vector2() },
        offset: { value: this.offset },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.resize();
    if (this.container === document.body) window.addEventListener('resize', () => this.resize());
    else new ResizeObserver(() => this.resize()).observe(this.container);
  }

  /** 按窗口大小重新计算整数缩放和低分辨率缓冲 */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const full = this.container === document.body;
    const devW = Math.max(1, Math.round((full ? window.innerWidth : this.container.clientWidth) * dpr));
    const devH = Math.max(1, Math.round((full ? window.innerHeight : this.container.clientHeight) * dpr));
    this.scale = Math.max(1, Math.round(devH / this.settings.baseHeight));
    this.width = Math.ceil(devW / this.scale);
    this.height = Math.ceil(devH / this.scale);

    const canvas = this.renderer.domElement;
    this.renderer.setSize(this.width * this.scale, this.height * this.scale, false);
    canvas.style.width = `${(this.width * this.scale) / dpr}px`;
    canvas.style.height = `${(this.height * this.scale) / dpr}px`;

    this.colorTarget?.dispose();
    this.normalTarget?.dispose();
    this.outTarget?.dispose();
    const bw = this.width + 2;
    const bh = this.height + 2;
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    this.colorTarget = new THREE.WebGLRenderTarget(bw, bh, { ...nearest, type: THREE.HalfFloatType });
    this.colorTarget.depthTexture = new THREE.DepthTexture(bw, bh);
    this.normalTarget = new THREE.WebGLRenderTarget(bw, bh, nearest);
    this.outTarget = new THREE.WebGLRenderTarget(bw, bh, { ...nearest, depthBuffer: false });

    (this.compositeMat.uniforms.resolution.value as THREE.Vector2).set(bw, bh);
    (this.blitMat.uniforms.bufferSize.value as THREE.Vector2).set(bw, bh);
    (this.blitMat.uniforms.visibleSize.value as THREE.Vector2).set(this.width, this.height);
  }

  /** 每像素对应的世界尺寸（米） */
  get texel(): number {
    return this.settings.viewHeight / this.height;
  }

  private updateCamera(): void {
    const s = this.settings;
    const pitch = THREE.MathUtils.degToRad(s.pitchDeg);
    const cam = this.camera;
    cam.rotation.set(-pitch, 0, 0);

    const forward = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch));
    const pos = this.target.clone().addScaledVector(forward, -this.distance);

    const texel = this.texel;
    this.offset.set(0, 0);
    if (s.snap) {
      const pr = pos.dot(right);
      const pu = pos.dot(up);
      const sr = Math.round(pr / texel) * texel;
      const su = Math.round(pu / texel) * texel;
      pos.addScaledVector(right, sr - pr).addScaledVector(up, su - pu);
      this.offset.set((pr - sr) / texel, (pu - su) / texel);
    }
    cam.position.copy(pos);

    const halfW = ((this.width + 2) / 2) * texel;
    const halfH = ((this.height + 2) / 2) * texel;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.near = this.near;
    cam.far = this.far;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  render(scene: THREE.Scene): void {
    const r = this.renderer;
    const s = this.settings;
    this.updateCamera();

    // 1. 颜色 + 深度（含特效层）
    this.camera.layers.set(0);
    this.camera.layers.enable(EFFECT_LAYER);
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.colorTarget);
    r.clear();
    r.render(scene, this.camera);

    // 2. 法线（不含特效层）
    this.camera.layers.set(0);
    scene.overrideMaterial = this.normalMaterial;
    r.setRenderTarget(this.normalTarget);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(scene, this.camera);
    r.setClearColor(0x000000, 1);
    scene.overrideMaterial = null;

    // 3. 描边 + 色调映射 + 色阶，仍在低分辨率
    const u = this.compositeMat.uniforms;
    u.tColor.value = this.colorTarget.texture;
    u.tDepth.value = this.colorTarget.depthTexture;
    u.tNormal.value = this.normalTarget.texture;
    u.outlineOn.value = s.outline ? 1 : 0;
    u.depthThreshold.value = s.depthThreshold;
    u.outlineDarken.value = s.outlineDarken;
    u.highlight.value = s.highlight;
    u.posterize.value = s.posterize;
    u.ditherOn.value = s.dither ? 1 : 0;
    u.exposure.value = s.exposure;
    this.quad.material = this.compositeMat;
    r.setRenderTarget(this.outTarget);
    r.render(this.quadScene, this.quadCam);

    // 4. 整数倍放大到屏幕
    this.blitMat.uniforms.tOut.value = this.outTarget.texture;
    this.quad.material = this.blitMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }

  /** 屏幕坐标 → 当前镜头的 NDC（考虑了边距和亚像素偏移） */
  clientToNdc(clientX: number, clientY: number, out = new THREE.Vector2()): THREE.Vector2 {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const devX = (clientX - rect.left) * dpr;
    const devY = (clientY - rect.top) * dpr;
    const tx = 1 + this.offset.x + devX / this.scale;
    const ty = 1 + this.offset.y + (this.height * this.scale - devY) / this.scale;
    return out.set((tx / (this.width + 2)) * 2 - 1, (ty / (this.height + 2)) * 2 - 1);
  }
}
