import * as THREE from 'three';
import { EFFECT_LAYER } from './PixelRenderer.ts';

/**
 * 一套灯：环境光（天空 / 地面两色）、主光（平行光，投影子）、轮廓光（点光，从后面打一圈边），再加任意几盏点光。
 * 全是能存成 JSON 的数：例子页调好了导出来，游戏里 new LightRig(scene).apply(json) 照样用。
 * 位置用方位角 + 高度角 + 距离（米）：方位 0° = 正前方（+Z），90° = 右边（+X）；高度 90° = 头顶。
 */
export type V3 = [number, number, number];

/** 点光：at = 位置（米，物体底部中心为原点）；挂在插座上的，at 是相对插座的偏移，跟着物体转、跟着开合动 */
export interface PointSpec { id: string; color: string; intensity: number; range: number; at: V3; socket?: string }

export interface LightSettings {
  ambient: { sky: string; ground: string; intensity: number };
  key: { color: string; intensity: number; azimuth: number; elevation: number; distance: number; shadow: boolean };
  rim: { on: boolean; color: string; intensity: number; azimuth: number; elevation: number; distance: number; range: number };
  points: PointSpec[];
}

/** 和以前写死在预览台里的三盏灯一样（主光 (−3, 6, 4)，轮廓光 (2.5, 2.2, −2.5)，换成方位、高度、距离） */
export const DEFAULT_LIGHTS: LightSettings = {
  ambient: { sky: '#fff0e0', ground: '#302820', intensity: 0.8 },
  key: { color: '#fff0d8', intensity: 2.2, azimuth: 323.13010235415595, elevation: 50.19442890773481, distance: 7.810249675906654, shadow: true },
  rim: { on: true, color: '#80a0ff', intensity: 6, azimuth: 135, elevation: 31.892102999320755, distance: 4.164132562731403, range: 8 },
  points: [],
};

export const PRESETS: Record<string, LightSettings> = {
  默认: DEFAULT_LIGHTS,
  正午: {
    ambient: { sky: '#ffffff', ground: '#4a4036', intensity: 1.0 },
    key: { color: '#fff6e8', intensity: 3.0, azimuth: 330, elevation: 75, distance: 8, shadow: true },
    rim: { on: true, color: '#cfe0ff', intensity: 2, azimuth: 150, elevation: 30, distance: 4, range: 8 },
    points: [],
  },
  黄昏: {
    ambient: { sky: '#ffb380', ground: '#2a1a22', intensity: 0.6 },
    key: { color: '#ff8a4a', intensity: 2.4, azimuth: 290, elevation: 12, distance: 8, shadow: true },
    rim: { on: true, color: '#6a80ff', intensity: 8, azimuth: 120, elevation: 25, distance: 4, range: 8 },
    points: [],
  },
  夜晚: {
    ambient: { sky: '#203050', ground: '#05060a', intensity: 0.35 },
    key: { color: '#8fa8ff', intensity: 0.6, azimuth: 200, elevation: 40, distance: 8, shadow: true },
    rim: { on: true, color: '#4060ff', intensity: 4, azimuth: 135, elevation: 30, distance: 4, range: 8 },
    points: [{ id: 'p1', color: '#ffb060', intensity: 10, range: 6, at: [1.2, 1.0, 1.2] }],
  },
  室内: {
    ambient: { sky: '#fff0e0', ground: '#403028', intensity: 0.5 },
    key: { color: '#ffe0b0', intensity: 1.2, azimuth: 330, elevation: 60, distance: 8, shadow: true },
    rim: { on: false, color: '#80a0ff', intensity: 0, azimuth: 135, elevation: 30, distance: 4, range: 8 },
    points: [{ id: 'p1', color: '#ffd59a', intensity: 14, range: 8, at: [0, 2.5, 0.6] }],
  },
  逆光: {
    ambient: { sky: '#9fb4d8', ground: '#151820', intensity: 0.4 },
    key: { color: '#ffffff', intensity: 3.2, azimuth: 160, elevation: 35, distance: 8, shadow: true },
    rim: { on: true, color: '#ffd8a0', intensity: 10, azimuth: 200, elevation: 20, distance: 3, range: 8 },
    points: [],
  },
};

/** 方位角（度，从 +Z 往 +X 转）、高度角（度）、距离 → 位置 */
export function spherical(azimuth: number, elevation: number, distance: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuth), e = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(distance * Math.cos(e) * Math.sin(a), distance * Math.sin(e), distance * Math.cos(e) * Math.cos(a));
}

export const cloneLights = (s: LightSettings): LightSettings => structuredClone(s);

/** 拿一份不全的、可能是旧版本存下来的设置，补齐成完整的（缺的用默认） */
export function normalizeLights(raw: unknown): LightSettings {
  const d = cloneLights(DEFAULT_LIGHTS);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<LightSettings>;
  const pick = <T extends object>(base: T, v: unknown): T => {
    if (!v || typeof v !== 'object') return base;
    const out = { ...base } as Record<string, unknown>;
    for (const [k, bv] of Object.entries(base)) {
      const nv = (v as Record<string, unknown>)[k];
      if (typeof nv === typeof bv && (typeof nv !== 'number' || Number.isFinite(nv))) out[k] = nv;
    }
    return out as T;
  };
  const points = Array.isArray(r.points) ? r.points.flatMap((p, i): PointSpec[] => {
    if (!p || typeof p !== 'object') return [];
    const q = pick<PointSpec>({ id: `p${i + 1}`, color: '#ffffff', intensity: 5, range: 6, at: [0, 1, 1] }, p);
    const at = (p as PointSpec).at;
    q.at = Array.isArray(at) && at.length === 3 && at.every((v) => Number.isFinite(v)) ? [at[0], at[1], at[2]] : [0, 1, 1];
    const socket = (p as PointSpec).socket;
    if (typeof socket === 'string') q.socket = socket;
    return [q];
  }) : [];
  return { ambient: pick(d.ambient, r.ambient), key: pick(d.key, r.key), rim: pick(d.rim, r.rim), points };
}

/** 一盏灯在画面里的记号：小八面体 + 往物体中心的一根线（特效层：不进描边、法线，不投影子） */
function marker(): { group: THREE.Group; dot: THREE.Mesh; line: THREE.Line } {
  const group = new THREE.Group();
  const dot = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff }));
  for (const o of [dot, line]) o.layers.set(EFFECT_LAYER);
  group.add(dot, line);
  return { group, dot, line };
}

export class LightRig {
  readonly hemi = new THREE.HemisphereLight();
  readonly key = new THREE.DirectionalLight();
  readonly rim = new THREE.PointLight();
  /** 现在的点光（和 settings.points 一一对应） */
  readonly points = new Map<string, THREE.PointLight>();
  /** 灯的记号，默认不显示：gizmos.visible = true */
  readonly gizmos = new THREE.Group();
  /** 记号的大小、主光记号离中心多远（米）：按物体大小设 */
  gizmoRadius = 1.5;
  /** 灯照着的中心（主光记号、连线指向它） */
  readonly center = new THREE.Vector3(0, 0.5, 0);
  settings: LightSettings;
  private readonly scene: THREE.Scene;
  private sockets: Record<string, THREE.Object3D> = {};
  private readonly marks = new Map<string, ReturnType<typeof marker>>();

  constructor(scene: THREE.Scene, settings: LightSettings = DEFAULT_LIGHTS) {
    this.scene = scene;
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -3;
    sc.right = sc.top = 3;
    this.key.shadow.bias = -0.0015;
    this.rim.decay = 2;
    this.gizmos.visible = false;
    scene.add(this.hemi, this.key, this.rim, this.gizmos);
    this.settings = cloneLights(settings);
    this.apply(this.settings);
  }

  /** 照设置摆灯；sockets = 物体的插座（点光挂在插座上用）。点光按 id 增删，只改数的时候不重建（不重新编译材质） */
  apply(s: LightSettings, sockets: Record<string, THREE.Object3D> = this.sockets): void {
    this.settings = s;
    this.sockets = sockets;
    this.hemi.color.set(s.ambient.sky);
    this.hemi.groundColor.set(s.ambient.ground);
    this.hemi.intensity = s.ambient.intensity;
    this.key.color.set(s.key.color);
    this.key.intensity = s.key.intensity;
    this.key.position.copy(spherical(s.key.azimuth, s.key.elevation, s.key.distance));
    this.key.castShadow = s.key.shadow;
    this.rim.visible = s.rim.on;
    this.rim.color.set(s.rim.color);
    this.rim.intensity = s.rim.intensity;
    this.rim.distance = s.rim.range;
    this.rim.position.copy(spherical(s.rim.azimuth, s.rim.elevation, s.rim.distance));

    const want = new Set(s.points.map((p) => p.id));
    for (const [id, light] of this.points) if (!want.has(id)) { light.removeFromParent(); light.dispose(); this.points.delete(id); }
    for (const p of s.points) {
      let light = this.points.get(p.id);
      if (!light) { light = new THREE.PointLight(); light.decay = 2; this.points.set(p.id, light); }
      light.color.set(p.color);
      light.intensity = p.intensity;
      light.distance = p.range;
      light.position.set(...p.at);
      // 挂在插座上、这件东西却没有这个插座的（比如别的物品的默认灯光）：不亮
      const host = p.socket ? sockets[p.socket] : this.scene;
      light.visible = !!host;
      const parent = host ?? this.scene;
      if (light.parent !== parent) parent.add(light);
    }
    this.syncMarkers();
  }

  /** 记号跟着灯（挂在插座上的会跟着物体转）：每帧调一次 */
  updateGizmos(): void {
    if (!this.gizmos.visible) return;
    const size = this.gizmoRadius * 0.035;
    const put = (id: string, at: THREE.Vector3, color: THREE.Color) => {
      const m = this.marks.get(id);
      if (!m) return;
      m.dot.position.copy(at);
      m.dot.scale.setScalar(size);
      (m.dot.material as THREE.MeshBasicMaterial).color.copy(color);
      (m.line.material as THREE.LineBasicMaterial).color.copy(color);
      const pos = m.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, at.x, at.y, at.z);
      pos.setXYZ(1, this.center.x, this.center.y, this.center.z);
      pos.needsUpdate = true;
      m.line.geometry.computeBoundingSphere();
    };
    const s = this.settings;
    // 主光是平行光，真位置可能在画面外：记号放在同一个方向上、离中心 gizmoRadius
    put('key', spherical(s.key.azimuth, s.key.elevation, this.gizmoRadius).add(this.center), this.key.color);
    const m = this.marks.get('rim');
    if (m) m.group.visible = s.rim.on;
    put('rim', this.rim.getWorldPosition(new THREE.Vector3()), this.rim.color);
    for (const [id, light] of this.points) {
      const m = this.marks.get(id);
      if (m) m.group.visible = light.visible;
      put(id, light.getWorldPosition(new THREE.Vector3()), light.color);
    }
  }

  private syncMarkers(): void {
    const ids = ['key', 'rim', ...this.points.keys()];
    for (const [id, m] of this.marks) if (!ids.includes(id)) { m.group.removeFromParent(); this.marks.delete(id); }
    for (const id of ids) {
      if (this.marks.has(id)) continue;
      const m = marker();
      this.marks.set(id, m);
      this.gizmos.add(m.group);
    }
    this.updateGizmos();
  }
}
