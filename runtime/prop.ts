import * as THREE from 'three';
import { toon } from '../render/materials.ts';

/**
 * 照参考图做的道具模型（scripts/prop.mjs 从 <文件夹>/prop.json 和参考图生成 out/<id>.json）。
 * 数据只有部件表，几 KB；这里在运行时建网格。
 *
 * 坐标：部件都在参考图的平面里写，u = 图右，v = 图上，w = 朝看图的人，单位毫米，原点 = 模型原点。
 * frame 决定这个平面在模型里怎么放：side = 图右是 +Z、图上是 +Y、看到的是 −X 面（铳：铳口朝 +Z）；front = 图右 +X、图上 +Y、看到的是 +Z 面；
 * top = 俯视图：图右 +X、图上 −Z（远处）、看到的是 +Y 面（顶面），东西平放（键盘、棋盘、地上的箱子）。
 */
export type Vec3 = [number, number, number];
export type Frame = 'side' | 'front' | 'top';

/**
 * 放样：沿一根轴（u / v / w）一站一站的截面，截面是超椭圆（n = 2 椭圆，越大越方）。
 * 每站 [轴上位置, 截面中心 1, 半径 1, 截面中心 2, 半径 2]：轴 u → (v, w)，轴 v → (u, w)，轴 w → (u, v)。
 * 铳床、铳管、子铳、螺丝都是它。hole = 末端开个孔 [半径, 深]（铳口）。
 */
export interface LoftPart {
  k: 'loft';
  axis: 'u' | 'v' | 'w';
  s: [number, number, number, number, number][];
  n?: number;
  seg?: number;
  hole?: [number, number];
}
/** 板：图平面里的一圈轮廓，沿 w 挤出厚 t，中心在 w */
export interface PlatePart { k: 'plate'; pts: [number, number][]; w: number; t: number }
/** 方块：中心、尺寸（u, v, w），rot = 在图平面里转（度，逆时针） */
export interface BoxPart { k: 'box'; at: Vec3; size: Vec3; rot?: number }
/** 环：图平面里的一圈（扳机护圈），半径 [u, v]，管粗（半径） */
export interface RingPart { k: 'ring'; at: Vec3; r: [number, number]; tube: number }
/** 球：中心、三个半径 */
export interface BallPart { k: 'ball'; at: Vec3; r: Vec3 }

export type PropPart = (LoftPart | PlatePart | BoxPart | RingPart | BallPart) & {
  id: string;
  /** 颜色名（colors 里的） */
  c: string;
  /** 单独一个网格（要动的：击锤、子铳），其余按颜色合并 */
  own?: boolean;
  /** 贴参考图的原色（贴图里的 "*" 那一层）：缠绳、花纹这种几个颜色交错的部件；没贴图时还是 c 的颜色 */
  paint?: boolean;
  /** 拆开时一起动的一组：量的时候切开的几段（鞋面前后两半），本来是一个零件 */
  group?: string;
  /** 装在哪个部件上（id）：拆开时先跟着它走，再从它上面弹出来 */
  on?: string;
  /** 拆开往哪挪，不写就按层自动定（见 explodeOffsets） */
  explode?: ExplodeDir;
  /** 开合：一步或几步（接着来），见 Motion；装在它上面（on）、同组（group）的跟着动 */
  open?: Motion | Motion[];
};

/**
 * 开合的一步：绕轴转、平移，或者两样一起。坐标都是图平面的 u, v, w（毫米，模型原点）。
 * 几步接着来：转轴是部件上的点、跟着前面几步走；平移按图的方向，不跟着转。
 */
export interface Motion {
  /** 动作名：同名的一起动，pose 时可以只动某几个；默认 "open" */
  name?: string;
  /** 转轴经过的点（部件上的，静止时的位置）；不写 = 部件（组）的中心 */
  pivot?: Vec3;
  /** 转轴的方向：'u' / 'v' / 'w' 或 [u, v, w]；不写 = 'w'（在图平面里转） */
  axis?: 'u' | 'v' | 'w' | Vec3;
  /** 转多少度：右手定则，拇指朝轴的正向（'w' 时正 = 看图的人看来逆时针） */
  deg?: number;
  /** 平移 [u, v, w] 毫米 */
  move?: Vec3;
  /** 这一步在动作的 0–1 里占哪一段；不写 = 同名的几步平分 */
  span?: [number, number];
}

/**
 * 拆开往哪挪：'u' / 'v' / 'w' 沿这根轴挪一步（正负按它在装的部件、或整体中心的哪一边），
 * 前面加 '+' / '-' 定死方向；'none' 不挪（有 on 就只跟着走）；[u, v, w] 毫米 = 直接给位移
 */
export type ExplodeDir = 'u' | 'v' | 'w' | '+u' | '+v' | '+w' | '-u' | '-v' | '-w' | 'none' | Vec3;

export interface PropData {
  id: string;
  frame: Frame;
  /** 颜色名 → 游戏里的颜色；"metal" = 运行时传进来的颜色（opts.metal，比如角色配色里的铁色） */
  colors: Record<string, string>;
  parts: PropPart[];
  /** 插座（u, v, w 毫米）：铳口、火门 */
  sockets?: Record<string, Vec3>;
  /** 游戏里放大多少（模型坐标 x, y, z）：照参考图是真实比例，拿在方块人手里显得细 */
  scale?: Vec3;
  /** 铳：单手 / 双手，左手扶的位置（模型坐标，米，放大以后） */
  gun?: { grip: 'one' | 'two'; support: Vec3 };
  /**
   * 贴图：参考图按机位投到模型上，UV = 顶点在图平面里的位置（不存 UV）。
   * rect = 贴图盖住的范围 [u0, v0, u1, v1]（毫米）；layers = 每个颜色一层，横着排（"*" = 原色那层，paint 的部件用）；
   * 贴图存的是相对这个颜色的明暗（0.5 = 原色），所以换配色（铁色）照样能用
   */
  tex?: { rect: [number, number, number, number]; layers: string[]; normal?: boolean };
  /** 生成时的统计（审图用） */
  stats?: Record<string, number | string>;
}

export interface PropOptions {
  /** metal 用的颜色 */
  metal?: number;
  /** 不合并：每个部件一个网格（模型页拆开看） */
  split?: boolean;
  /** 贴图、法线图的地址；不给就是纯色 */
  map?: string;
  normalMap?: string;
}

export interface PropModel {
  /** 外层（不放大）；model 是放大过的那层，部件、插座都在它下面 */
  group: THREE.Group;
  model: THREE.Group;
  sockets: Record<string, THREE.Object3D>;
  /**
   * split 时每个部件的网格，和拆满时它挪多少（模型坐标，米，放大以前）：
   * 拆开到 t（0 = 合上，1 = 拆满）就是 mesh.position = dir × t。写了 open 的（和跟着它动的）不 split 也单独一个网格
   */
  parts: { id: string; mesh: THREE.Mesh; dir: THREE.Vector3 }[];
  /** 部件表里写了的开合动作名 */
  actions: string[];
  /**
   * 摆姿势：apart = 拆开多少（0–1）；open = 开合多少：一个数 = 所有动作，或者 动作名 → 0–1（没写的动作不动）。
   * 拆开和开合可以一起：先开合、再整个挪开
   */
  pose(apart?: number, open?: number | Record<string, number>): void;
}

const MM = 0.001;

/** 放样的网格：截面一圈 seg 个点（转半格，八边形的平边朝上下左右），两头封口（封口单独的顶点，边缘不糊） */
function loftGeometry(p: LoftPart): THREE.BufferGeometry {
  const seg = p.seg ?? 8;
  const e = 2 / (p.n ?? 2);
  const pos: number[] = [];
  const idx: number[] = [];
  const place = (t: number, a: number, b: number): Vec3 => (p.axis === 'u' ? [t, a, b] : p.axis === 'v' ? [a, t, b] : [a, b, t]);
  // 多边形的外框要正好是量到的尺寸（不然八边形的平边只到半径的 92%，整个模型小一圈）
  const cs: number[] = [], sn: number[] = [];
  for (let j = 0; j < seg; j++) {
    const th = ((j + 0.5) / seg) * Math.PI * 2;
    cs.push(Math.sign(Math.cos(th)) * Math.abs(Math.cos(th)) ** e);
    sn.push(Math.sign(Math.sin(th)) * Math.abs(Math.sin(th)) ** e);
  }
  const kc = 1 / Math.max(...cs.map(Math.abs)), ks = 1 / Math.max(...sn.map(Math.abs));
  const ring = (st: number[], j: number): Vec3 => place(st[0], st[1] + st[2] * cs[j] * kc, st[3] + st[4] * sn[j] * ks);
  for (const st of p.s) for (let j = 0; j < seg; j++) pos.push(...ring(st, j));
  // 轴 v 的第二个截面方向（w）和轴向的叉乘方向相反，绕向要翻过来，法线才朝外
  const flip = p.axis === 'v';
  for (let i = 0; i < p.s.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (st: number[], end: boolean, inward = 0, r = 1): void => {
    const base = pos.length / 3;
    const scaled = [st[0], st[1], st[2] * r, st[3], st[4] * r];
    for (let j = 0; j < seg; j++) pos.push(...ring(scaled, j));
    pos.push(...place(st[0] - inward, st[1], st[3]));
    const fwd = end !== flip;
    for (let j = 0; j < seg; j++) {
      const a = base + j, b = base + ((j + 1) % seg);
      if (fwd) idx.push(base + seg, a, b);
      else idx.push(base + seg, b, a);
    }
  };
  cap(p.s[0], false);
  const last = p.s[p.s.length - 1];
  if (p.hole) {
    // 铳口：端面一圈到孔边，孔往里一截，孔底封口
    const [hr, depth] = p.hole;
    const k = hr / Math.max(last[2], last[4]);
    const dir = Math.sign(last[0] - p.s[0][0]) || 1;
    const rim = pos.length / 3;
    for (const [t, r] of [[last[0], 1], [last[0], k], [last[0] - dir * depth, k]] as const) {
      for (let j = 0; j < seg; j++) pos.push(...ring([t, last[1], last[2] * r, last[3], last[4] * r], j));
    }
    for (let q = 0; q < 2; q++) {
      for (let j = 0; j < seg; j++) {
        const a = rim + q * seg + j, b = rim + q * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
        // 端面朝外、孔壁朝里：和侧面同一个绕法反过来
        if ((dir > 0) !== flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
    cap([last[0] - dir * depth, last[1], last[2] * k, last[3], last[4] * k], dir > 0);
  } else cap(last, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.map((v) => v * MM), 3));
  g.setIndex(idx);
  return g;
}

function partGeometry(p: PropPart): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (p.k) {
    case 'loft':
      g = loftGeometry(p);
      g.computeVertexNormals();
      return g.toNonIndexed();
    case 'plate': {
      const shape = new THREE.Shape(p.pts.map(([u, v]) => new THREE.Vector2(u * MM, v * MM)));
      g = new THREE.ExtrudeGeometry(shape, { depth: p.t * MM, bevelEnabled: false, curveSegments: 1 });
      g.translate(0, 0, (p.w - p.t / 2) * MM);
      break;
    }
    case 'box':
      g = new THREE.BoxGeometry(p.size[0] * MM, p.size[1] * MM, p.size[2] * MM);
      if (p.rot) g.rotateZ(THREE.MathUtils.degToRad(p.rot));
      g.translate(p.at[0] * MM, p.at[1] * MM, p.at[2] * MM);
      break;
    case 'ring':
      g = new THREE.TorusGeometry(1, p.tube / Math.max(p.r[0], p.r[1]), 6, 16);
      g.scale(p.r[0] * MM, p.r[1] * MM, Math.max(p.r[0], p.r[1]) * MM);
      g.translate(p.at[0] * MM, p.at[1] * MM, p.at[2] * MM);
      break;
    case 'ball':
      g = new THREE.SphereGeometry(1, 8, 6);
      g.scale(p.r[0] * MM, p.r[1] * MM, p.r[2] * MM);
      g.translate(p.at[0] * MM, p.at[1] * MM, p.at[2] * MM);
      break;
  }
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

/**
 * 贴图坐标：顶点在图平面里的位置，落在这个颜色那一层。
 * 侧着的面（顶、底、两侧）取到的是参考图最边上那一圈，常是描边、高光、和背景混的颜色，拉满一整面：
 * 这些面往里多取一点（长边的 1.5%，约 4 个贴图像素）
 */
function projectUv(g: THREE.BufferGeometry, tex: NonNullable<PropData['tex']>, layer: number): void {
  const [u0, v0, u1, v1] = tex.rect.map((x) => x * MM);
  const inset = Math.max(u1 - u0, v1 - v0) * 0.015;
  const n = tex.layers.length;
  const p = g.getAttribute('position');
  const nm = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const side = Math.max(0, 1 - Math.abs(nm.getZ(i)) * 1.5);
    const u = p.getX(i) - nm.getX(i) * inset * side, v = p.getY(i) - nm.getY(i) * inset * side;
    const s = THREE.MathUtils.clamp((u - u0) / (u1 - u0), 0, 1);
    uv[i * 2] = (layer + s) / n;
    uv[i * 2 + 1] = (v - v0) / (v1 - v0);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    if (!list.every((g) => g.getAttribute(name))) continue;
    const size = list[0].getAttribute(name).itemSize;
    const arr = new Float32Array(list.reduce((n, g) => n + g.getAttribute(name).count * size, 0));
    let o = 0;
    for (const g of list) {
      arr.set(g.getAttribute(name).array as Float32Array, o);
      o += g.getAttribute(name).array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/** 拆开：叠一层挪长边的多少；图平面里按离中心多远挪（u、v 各乘多少，和改之前一样） */
const STEP = 0.1;
const PLANE_U = 0.6, PLANE_V = 0.72;

/**
 * 拆满时每个部件挪多少（图平面坐标 u, v, w，米；调用的再转到模型坐标）。
 * - 同一个 group 的一起动；
 * - on：先跟着装的那个部件走，再从它上面弹出来：w 方向叠在它上面的沿 w 弹，挨在旁边的在图平面里从它那儿往外；
 * - 默认按层：跨过中间那个面（w = 整体中心）的是本体，在图平面里从中心往外挪（离中心越远挪得越多）；
 *   别的是贴在侧面、叠在上面的（机头、背板、模组、镜头），只沿 w 往外挪，压着几层就挪几步。
 * 部件表里的部件是「怎么量方便」切的，不一定是真零件：切开的几段用 group 绑在一起。
 */
export function explodeOffsets(parts: PropPart[], boxes: THREE.Box3[]): THREE.Vector3[] {
  const all = new THREE.Box3();
  for (const b of boxes) all.union(b);
  const center = all.getCenter(new THREE.Vector3());
  const size = all.getSize(new THREE.Vector3());
  const long = Math.max(size.x, size.y, size.z);
  const step = long * STEP;
  const eps = long * 0.002;

  interface Unit { box: THREE.Box3; c: THREE.Vector3; on?: string; ex?: ExplodeDir }
  const units: Unit[] = [];
  const unitOf: number[] = [];
  const byGroup = new Map<string, number>();
  parts.forEach((p, i) => {
    let u = p.group ? byGroup.get(p.group) : undefined;
    if (u === undefined) {
      u = units.push({ box: new THREE.Box3(), c: new THREE.Vector3() }) - 1;
      if (p.group) byGroup.set(p.group, u);
    }
    units[u].box.union(boxes[i]);
    units[u].on ??= p.on;
    units[u].ex ??= p.explode;
    unitOf[i] = u;
  });
  for (const u of units) u.box.getCenter(u.c);
  const index = new Map(parts.map((p, i) => [p.id, i]));
  const parentOf = (u: Unit): Unit | undefined => {
    const i = u.on === undefined ? undefined : index.get(u.on);
    const pu = i === undefined ? undefined : units[unitOf[i]];
    return pu === u ? undefined : pu;
  };
  // 图平面里（u、v）有没有重叠：叠在一起的才算压着
  const overlap = (a: THREE.Box3, b: THREE.Box3) =>
    a.min.x < b.max.x - eps && b.min.x < a.max.x - eps && a.min.y < b.max.y - eps && b.min.y < a.max.y - eps;
  const crosses = (u: Unit) => u.box.min.z <= center.z + eps && u.box.max.z >= center.z - eps;
  const side = (u: Unit) => Math.sign(u.c.z - center.z) || 1;

  // 第几层：0 = 本体；别的 = 1 + 压着的（同一边、更靠里、图平面里重叠）里最高的那层
  const layers = new Map<Unit, number>();
  const layerOf = (u: Unit): number => {
    let l = layers.get(u);
    if (l !== undefined) return l;
    l = 0;
    if (!crosses(u)) {
      const s = side(u);
      l = 1;
      for (const b of units) {
        if (b === u || !overlap(u.box, b.box)) continue;
        if (s * (b.c.z - center.z) >= s * (u.c.z - center.z)) continue;
        if (!crosses(b) && side(b) !== s) continue;
        l = Math.max(l, layerOf(b) + 1);
      }
    }
    layers.set(u, l);
    return l;
  };

  const done = new Map<Unit, THREE.Vector3>();
  const busy = new Set<Unit>();
  const offsetOf = (u: Unit): THREE.Vector3 => {
    const hit = done.get(u);
    if (hit) return hit;
    // on 装来装去绕成了圈：这一环不跟着
    if (busy.has(u)) return new THREE.Vector3();
    busy.add(u);
    const parent = parentOf(u);
    const out = parent ? offsetOf(parent).clone() : new THREE.Vector3();
    const ref = parent ? parent.c : center;
    const ex = u.ex;
    if (Array.isArray(ex)) out.add(new THREE.Vector3(ex[0] * MM, ex[1] * MM, ex[2] * MM));
    else if (ex && ex !== 'none') {
      const k = ({ u: 'x', v: 'y', w: 'z' } as const)[ex.slice(-1) as 'u' | 'v' | 'w'];
      const sign = ex[0] === '-' ? -1 : ex[0] === '+' ? 1 : Math.sign(u.c[k] - ref[k]) || 1;
      out[k] += sign * step;
    } else if (!ex && parent) {
      const stacked = u.box.min.z >= parent.box.max.z - eps || u.box.max.z <= parent.box.min.z + eps;
      if (stacked) out.z += (Math.sign(u.c.z - parent.c.z) || 1) * step;
      else out.add(new THREE.Vector3((u.c.x - ref.x) * PLANE_U, (u.c.y - ref.y) * PLANE_V, 0));
    } else if (!ex) {
      const l = layerOf(u);
      if (l === 0) out.add(new THREE.Vector3((u.c.x - center.x) * PLANE_U, (u.c.y - center.y) * PLANE_V, 0));
      else out.z += side(u) * l * step;
    }
    busy.delete(u);
    done.set(u, out);
    return out;
  };
  return parts.map((_, i) => offsetOf(units[unitOf[i]]).clone());
}

/** 一个部件怎么动：自己（组）的几步，装在谁上面（下标，−1 = 没有），转轴默认在哪 */
interface Rig { steps: (Motion & { span: [number, number] })[]; parent: number; center: THREE.Vector3 }

/** 每个部件的开合（图平面坐标，米）：同一个 group 的用组里第一个写的 open、on */
export function rigOf(parts: PropPart[], boxes: THREE.Box3[]): Rig[] {
  const gOpen = new Map<string, Motion[]>(), gOn = new Map<string, string>(), gBox = new Map<string, THREE.Box3>();
  parts.forEach((p, i) => {
    if (!p.group) return;
    gBox.set(p.group, (gBox.get(p.group) ?? new THREE.Box3()).union(boxes[i]));
    if (p.open && !gOpen.has(p.group)) gOpen.set(p.group, ([] as Motion[]).concat(p.open));
    if (p.on && !gOn.has(p.group)) gOn.set(p.group, p.on);
  });
  const index = new Map(parts.map((p, i) => [p.id, i]));
  return parts.map((p, i) => {
    const open = p.group ? gOpen.get(p.group) : p.open && ([] as Motion[]).concat(p.open);
    const on = p.group ? gOn.get(p.group) : p.on;
    let parent = on === undefined ? -1 : (index.get(on) ?? -1);
    // 装在自己组里的：不算
    if (parent === i || (parent >= 0 && p.group && parts[parent].group === p.group)) parent = -1;
    // 同名的几步，没写 span 的平分
    const steps = (open ?? []).map((s, _, all) => {
      if (s.span) return { ...s, span: s.span };
      const same = all.filter((o) => (o.name ?? 'open') === (s.name ?? 'open'));
      const j = same.indexOf(s);
      return { ...s, span: [j / same.length, (j + 1) / same.length] as [number, number] };
    });
    return { steps, parent, center: (p.group ? gBox.get(p.group)! : boxes[i]).getCenter(new THREE.Vector3()) };
  });
}

const AXES = { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] } as const;

/** 部件自己这几步走到哪（图平面坐标，米）：t = 动作名 → 0–1 */
function localMotion(r: Rig, t: (name: string) => number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  for (const s of r.steps) {
    let k = THREE.MathUtils.clamp((t(s.name ?? 'open') - s.span[0]) / (s.span[1] - s.span[0] || 1), 0, 1);
    if (k === 0) continue;
    // 慢起慢停
    k = k * k * (3 - 2 * k);
    if (s.deg) {
      const P = (s.pivot ? new THREE.Vector3(...s.pivot).multiplyScalar(MM) : r.center.clone()).applyMatrix4(m);
      const a = typeof s.axis === 'string' || !s.axis ? AXES[s.axis ?? 'w'] : s.axis;
      const A = new THREE.Vector3(a[0], a[1], a[2]).transformDirection(m);
      m.premultiply(new THREE.Matrix4().makeTranslation(-P.x, -P.y, -P.z))
        .premultiply(new THREE.Matrix4().makeRotationAxis(A, THREE.MathUtils.degToRad(s.deg * k)))
        .premultiply(new THREE.Matrix4().makeTranslation(P.x, P.y, P.z));
    }
    if (s.move) m.premultiply(new THREE.Matrix4().makeTranslation(s.move[0] * MM * k, s.move[1] * MM * k, s.move[2] * MM * k));
  }
  return m;
}

const textures = new Map<string, THREE.Texture>();
function loadTexture(url: string): THREE.Texture {
  let t = textures.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    // 像素风：近看一个贴图像素对一个画面像素，远了取 mip 的平均，不糊成一片
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapNearestFilter;
    // 存的是明暗比例和法线，不是颜色：不做 sRGB 换算
    t.colorSpace = THREE.NoColorSpace;
    textures.set(url, t);
  }
  return t;
}

/** 照部件表建模型 */
export function buildProp(data: PropData, opts: PropOptions = {}): PropModel {
  const group = new THREE.Group();
  const model = new THREE.Group();
  if (data.scale) model.scale.set(...data.scale);
  group.add(model);
  // 图平面 → 模型：side 绕竖轴转 −90°（u → +Z，w → −X）；top 绕横轴转 −90°（v → −Z，w → +Y）
  const frame = new THREE.Matrix4();
  if (data.frame === 'side') frame.makeRotationY(-Math.PI / 2);
  else if (data.frame === 'top') frame.makeRotationX(-Math.PI / 2);
  const map = opts.map && data.tex ? loadTexture(opts.map) : undefined;
  const normalMap = opts.normalMap && data.tex ? loadTexture(opts.normalMap) : undefined;

  // paint 的部件有贴图时用原色那层（单独一种材质：白色 × 贴图）
  const paintLayer = !!data.tex?.layers.includes('*');
  const keyOf = (p: PropPart) => (p.paint && map && paintLayer ? '*' : p.c);
  const mats = new Map<string, THREE.Material>();
  const material = (c: string): THREE.Material => {
    let m = mats.get(c);
    if (!m && c === '*') mats.set(c, (m = toon(0xffffff, { map })));
    if (!m) {
      const hex = data.colors[c] === 'metal' ? (opts.metal ?? 0x2e3036) : new THREE.Color(data.colors[c]).getHex();
      const textured = map && data.tex!.layers.includes(c);
      const t = toon(hex, textured ? { map, ...(normalMap ? { normalMap, normalScale: new THREE.Vector2(0.6, 0.6) } : {}) } : {});
      // 贴图 0.5 = 原色：颜色放大一倍
      if (textured) t.color.multiplyScalar(2);
      mats.set(c, (m = t));
    }
    return m;
  };

  const parts: PropModel['parts'] = [];
  const groups = new Map<string, THREE.BufferGeometry[]>();
  const built = data.parts.map((p) => {
    const g = partGeometry(p);
    if (data.tex) {
      const layer = data.tex.layers.indexOf(p.paint && paintLayer ? '*' : p.c);
      if (layer >= 0) projectUv(g, data.tex, layer);
    }
    // 拆开按图平面算（u, v, w），转到模型坐标以前先记下框
    g.computeBoundingBox();
    const uvw = g.boundingBox!.clone();
    g.applyMatrix4(frame);
    return { p, g, uvw };
  });
  const dirs = explodeOffsets(data.parts, built.map((b) => b.uvw)).map((v) => v.applyMatrix4(frame));
  const rigs = rigOf(data.parts, built.map((b) => b.uvw));
  // 要动的：自己有开合，或者装在要动的上面（顺着 on 往上找，绕成圈的不算）
  const moving = rigs.map((_, i) => {
    const seen = new Set<number>();
    for (let j = i; j >= 0 && !seen.has(j); j = rigs[j].parent) {
      if (rigs[j].steps.length) return true;
      seen.add(j);
    }
    return false;
  });
  const meshOf: { mesh: THREE.Mesh; i: number }[] = [];
  built.forEach(({ p, g }, i) => {
    if (opts.split || p.own || moving[i]) {
      const mesh = new THREE.Mesh(g, material(keyOf(p)));
      mesh.name = p.id;
      mesh.castShadow = mesh.receiveShadow = true;
      model.add(mesh);
      parts.push({ id: p.id, mesh, dir: dirs[i] });
      meshOf.push({ mesh, i });
    } else {
      const list = groups.get(keyOf(p)) ?? [];
      list.push(g);
      groups.set(keyOf(p), list);
    }
  });
  for (const [c, list] of groups) {
    const mesh = new THREE.Mesh(merge(list), material(c));
    mesh.name = c;
    mesh.castShadow = mesh.receiveShadow = true;
    model.add(mesh);
  }
  const sockets: Record<string, THREE.Object3D> = {};
  for (const [name, at] of Object.entries(data.sockets ?? {})) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(at[0] * MM, at[1] * MM, at[2] * MM).applyMatrix4(frame);
    model.add(o);
    sockets[name] = o;
  }

  const actions = [...new Set(rigs.flatMap((r) => r.steps.map((s) => s.name ?? 'open')))];
  const frameInv = frame.clone().invert();
  const pose = (apart = 0, open: number | Record<string, number> = 0): void => {
    const t = typeof open === 'number' ? () => open : (n: string) => open[n] ?? 0;
    // 整个走到哪 = 装的那个走到哪 × 自己这几步（图平面坐标）
    const world = new Map<number, THREE.Matrix4>();
    const busy = new Set<number>();
    const worldOf = (i: number): THREE.Matrix4 => {
      const hit = world.get(i);
      if (hit) return hit;
      const own = localMotion(rigs[i], t);
      const p = rigs[i].parent;
      // on 绕成圈：这一环不跟着
      busy.add(i);
      const m = p >= 0 && !busy.has(p) ? worldOf(p).clone().multiply(own) : own;
      busy.delete(i);
      world.set(i, m);
      return m;
    };
    for (const { mesh, i } of meshOf) {
      // 图平面 → 模型：frame × 动 × frame⁻¹，再整个挪开
      const m = frame.clone().multiply(worldOf(i)).multiply(frameInv);
      m.premultiply(new THREE.Matrix4().makeTranslation(dirs[i].x * apart, dirs[i].y * apart, dirs[i].z * apart));
      m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    }
  };
  return { group, model, sockets, parts, actions, pose };
}
