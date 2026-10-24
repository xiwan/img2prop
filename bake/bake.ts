// img2prop 的生成和审图页（scripts/prop.mjs 用 playwright 打开它，参考图和部件表由它塞进 window.__input）：
//   trace  看图：抠背景、量轮廓、取色，出带坐标网格的参考图（写部件表用）
//   生成   照部件表从参考图量出部件 → 模型数据、贴图、法线图，和参考图同机位对比（重合度），
//          出像素风的近看、游戏里的大小、拆开的样子
// 部件表的写法见 SKILL.md。
import * as THREE from 'three';
import { buildProp, type ExplodeDir, type Frame, type LoftPart, type Motion, type PropData, type PropPart, type Vec3 } from '../runtime/prop.ts';
import { PreviewStage } from '../render/PreviewStage.ts';

type XY = [number, number];
type Box4 = [number, number, number, number];
type RGB = [number, number, number];

/** 部件表里的一个部件（坐标都是参考图的像素；d = 离图平面多远，朝看图的人为正） */
interface SrcPart {
  id: string;
  kind: 'sweep' | 'lathe' | 'plate' | 'box' | 'cyl' | 'ring' | 'ball';
  color: string;
  /** 从图上量的时候算哪些颜色（默认就是 color）；"*" = 整个轮廓 */
  mask?: string[];
  /** 只在这个框里量 [x0, y0, x1, y1] */
  box?: Box4;
  d?: number;
  /** 另一面也来一个（d 取反） */
  mirror?: boolean;
  own?: boolean;
  /** 贴参考图的原色，不按颜色分层（缠绳、花纹） */
  paint?: boolean;
  /** 拆开：同一组的一起动（量的时候切开的几段）；on = 装在哪个部件上；explode = 往哪挪（[u, v, w] 时是像素：图右、图上、朝看图的人） */
  group?: string;
  on?: string;
  explode?: ExplodeDir;
  /** 框里 mask 颜色的每一块（连通的）各做一个这样的部件，框 = 那一块的外框，id 后面加序号：键帽、铆钉、按钮 */
  each?: boolean;
  /**
   * 开合：一步或几步。pivot = 转轴经过的点 [x, y, d]（图上的像素，d 不写 = 部件的 d），axis = 'u' / 'v' / 'w' 或 [右, 上, 朝外]，
   * deg = 转多少度，move = 平移 [右, 上, 朝外]（像素），name = 动作名，span = 这一步占 0–1 的哪一段
   */
  open?: SrcMotion | SrcMotion[];
  // sweep / lathe：x = 横着从哪列到哪列，y = 竖着从哪行到哪行
  x?: XY;
  y?: XY;
  /** 手写的截面 [沿轴位置, 上（左）边, 下（右）边, 厚] */
  pts?: number[][];
  /** 被挡住的边自己写：[[沿轴位置, 边], …]，这一段用它，不用量的 */
  top?: XY[];
  bottom?: XY[];
  left?: XY[];
  right?: XY[];
  /** 厚（垂直于图，像素）：一个数，或 [[沿轴位置, 厚], …]；不写 = 和高一样（圆的） */
  w?: number | XY[];
  n?: number;
  seg?: number;
  /** 往外胀几个像素（箍、包边要盖在别的部件外面） */
  grow?: number;
  // lathe
  axis?: number;
  edge?: 'top' | 'bottom' | 'both';
  r?: number | XY[];
  bore?: number;
  /** 孔多深（像素），默认 2.5 倍孔半径 */
  boreDepth?: number;
  vertical?: boolean;
  // plate
  t?: number;
  // box / cyl / ball（box 的 t = 厚，不写 = 框的短边；taper = 往 +w 收口，顶面每边往里收几个像素）
  at?: number[];
  size?: number[];
  rot?: number;
  taper?: number;
  len?: number;
  dir?: 'u' | 'v' | 'w';
  tube?: number;
}

interface SrcMotion { name?: string; pivot?: number[]; axis?: 'u' | 'v' | 'w' | Vec3; deg?: number; move?: number[]; span?: XY }

interface Spec {
  id: string;
  image?: string;
  frame: Frame;
  origin: XY;
  /** [像素, 米]：图上多少像素是多少米 */
  scale: XY;
  /** ref = 图上这个颜色的样子：色号 "#5a2a1a"，或者图上的一个点 [x, y]（取那里 5×5 的平均） */
  colors: Record<string, { ref: (string | XY)[]; game: string }>;
  parts: SrcPart[];
  sockets?: Record<string, number[]>;
  game?: { scale?: Vec3; grip?: 'one' | 'two'; support?: Vec3 };
  /** 也算背景的颜色（阴影） */
  bg?: string[];
  /**
   * 贴图：size = 长边多少个像素（和物品页近看差不多大），tones = 每个颜色几个色阶，contrast = 纹理留多少；false = 不要贴图。
   * normal = 法线图的强度：不写就不进游戏（像素下几乎看不出来，文件比贴图大三倍），审图里照样出一张比着看
   */
  tex?: { size?: number; tones?: number; contrast?: number; normal?: number } | false;
  /** 最细多少像素（更细的加粗，像素下才看得见）、量轮廓时允许偏多少像素 */
  min?: number;
  tol?: number;
}

/** 命令行塞进来的：道具名、部件表（还没写就是 null）、参考图（data URL）、看图还是生成、看图时放大哪块 */
interface Input { id: string; spec: Spec | null; image: string; trace: boolean; zoom?: Box4 }
const input = (window as unknown as { __input: Input }).__input;
const sheet = document.getElementById('sheet')!;
const timing: Record<string, number> = {};
let t0 = performance.now();
const lap = (name: string) => {
  const now = performance.now();
  timing[name] = Math.round(now - t0);
  t0 = now;
};

const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const dist2 = (a: ArrayLike<number>, ai: number, b: RGB) => (a[ai] - b[0]) ** 2 + (a[ai + 1] - b[1]) ** 2 + (a[ai + 2] - b[2]) ** 2;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** 参考色：色号，或者图上一点周围 5×5 的平均 */
function refColor(img: Img, r: string | XY): RGB {
  if (typeof r === 'string') return rgb(r);
  const s: RGB = [0, 0, 0];
  let n = 0;
  for (let y = r[1] - 2; y <= r[1] + 2; y++) for (let x = r[0] - 2; x <= r[0] + 2; x++) {
    const o = (Math.round(y) * img.w + Math.round(x)) * 4;
    s[0] += img.d[o]; s[1] += img.d[o + 1]; s[2] += img.d[o + 2]; n++;
  }
  return [s[0] / n, s[1] / n, s[2] / n];
}

interface Img { w: number; h: number; d: Uint8ClampedArray; el: HTMLImageElement }
async function loadImage(url: string): Promise<Img> {
  const el = await new Promise<HTMLImageElement>((ok, bad) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error('参考图读不出来（不是 PNG / JPEG / WebP？）'));
    im.src = url;
  });
  const c = Object.assign(document.createElement('canvas'), { width: el.width, height: el.height });
  const g = c.getContext('2d')!;
  g.drawImage(el, 0, 0);
  return { w: el.width, h: el.height, d: g.getImageData(0, 0, el.width, el.height).data, el };
}

// ---------- 抠背景 ----------
/** 连通块（4 邻接）：返回每个像素的块号和每块的面积 */
function components(on: (i: number) => boolean, w: number, h: number): { id: Int32Array; area: number[]; border: boolean[] } {
  const id = new Int32Array(w * h).fill(-1);
  const area: number[] = [];
  const border: boolean[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (id[s] >= 0 || !on(s)) continue;
    const n = area.length;
    area.push(0);
    border.push(false);
    id[s] = n;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      area[n]++;
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border[n] = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && id[j] < 0 && on(j)) {
          id[j] = n;
          stack.push(j);
        }
      }
    }
  }
  return { id, area, border };
}

/** 背景色取图边一圈的中位数；离它远的是东西。去掉小斑点、补上小洞（高光），大洞（扳机护圈里）留着 */
function foreground(img: Img, extra: RGB[]): { bg: RGB; thr: number; fg: Uint8Array; bbox: Box4 } {
  const { w, h, d } = img;
  const edge: RGB[] = [];
  for (let x = 0; x < w; x += 2) for (const y of [0, 1, h - 2, h - 1]) edge.push([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]);
  for (let y = 0; y < h; y += 2) for (const x of [0, 1, w - 2, w - 1]) edge.push([d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]]);
  const med = (k: number) => edge.map((c) => c[k]).sort((a, b) => a - b)[edge.length >> 1];
  const bg: RGB = [med(0), med(1), med(2)];
  // 背景有暗角：阈值取边上离中位数最远的那些再放宽一点
  const ed = edge.map((c) => Math.sqrt(dist2(c, 0, bg))).sort((a, b) => a - b);
  const thr = Math.max(26, ed[Math.floor(ed.length * 0.995)] * 1.4);
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const near = Math.sqrt(dist2(d, i * 4, bg)) < thr || extra.some((c) => Math.sqrt(dist2(d, i * 4, c)) < thr * 0.6);
    fg[i] = near ? 0 : 1;
  }
  const total = w * h;
  const a = components((i) => fg[i] === 1, w, h);
  for (let i = 0; i < total; i++) if (fg[i] && a.area[a.id[i]] < total * 0.0005) fg[i] = 0;
  // 东西里面的洞：小的补上；大的看颜色，真空隙（扳机护圈里）几乎就是背景色，高光离背景远一些
  const b = components((i) => fg[i] === 0, w, h);
  const far = new Float64Array(b.area.length);
  for (let i = 0; i < total; i++) if (!fg[i]) far[b.id[i]] += Math.sqrt(dist2(d, i * 4, bg));
  for (let i = 0; i < total; i++) {
    const n = b.id[i];
    if (fg[i] || b.border[n]) continue;
    if (b.area[n] < total * 0.0004 || far[n] / b.area[n] > thr * 0.45) fg[i] = 1;
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < total; i++) {
    if (!fg[i]) continue;
    const x = i % w, y = (i / w) | 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  return { bg, thr, fg, bbox: [x0, y0, x1, y1] };
}

/** 取色：东西上的颜色聚成 k 类（写部件表时挑参考色用） */
function palette(img: Img, fg: Uint8Array, k = 10): { c: RGB; share: number }[] {
  const px: RGB[] = [];
  const step = Math.max(1, Math.floor(fg.reduce((n, v) => n + v, 0) / 30000));
  let n = 0;
  for (let i = 0; i < fg.length; i++) if (fg[i] && n++ % step === 0) px.push([img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]]);
  // k-means++，种子固定（每次结果一样）
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cs: RGB[] = [px[Math.floor(rand() * px.length)]];
  while (cs.length < k) {
    const dd = px.map((p) => Math.min(...cs.map((c) => dist2(p, 0, c))));
    let r = rand() * dd.reduce((a, b) => a + b, 0);
    let i = 0;
    while ((r -= dd[i]) > 0 && i < px.length - 1) i++;
    cs.push([...px[i]] as RGB);
  }
  const lab = new Int32Array(px.length);
  for (let it = 0; it < 12; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => {
      let best = 0;
      for (let j = 1; j < k; j++) if (dist2(p, 0, cs[j]) < dist2(p, 0, cs[best])) best = j;
      lab[i] = best;
      sum[best][0] += p[0]; sum[best][1] += p[1]; sum[best][2] += p[2]; sum[best][3]++;
    });
    sum.forEach((s, j) => s[3] && (cs[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  const cnt = cs.map((_, j) => lab.filter((l) => l === j).length);
  return cs.map((c, j) => ({ c, share: cnt[j] / px.length })).sort((a, b) => b.share - a.share);
}

/** sRGB → Lab（D65） */
function lab(r: number, g: number, b: number): RGB {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const h = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
}

/**
 * 东西上每个像素归到最近的参考色那一类（1 起）。比的是 Lab，明暗只算三分之一：
 * 照片上同一个材质有亮面暗面（木头的高光、铳管的背光），主要靠色相、鲜艳程度分。再投两轮票（3×3）去掉杂点
 */
function classify(img: Img, fg: Uint8Array, refs: RGB[][]): Uint8Array {
  const { w, h, d } = img;
  const L = refs.map((list) => list.map((c) => lab(...c)));
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!fg[i]) continue;
    const p = lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    let best = 0, bd = Infinity;
    L.forEach((list, k) => list.forEach((c) => {
      const e = ((p[0] - c[0]) * 0.33) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (e < bd) { bd = e; best = k + 1; }
    }));
    raw[i] = best;
  }
  const votes = new Uint8Array(refs.length + 1);
  let cur = raw;
  for (let pass = 0; pass < 2; pass++) {
    const out = cur.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!cur[i]) continue;
        votes.fill(0);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) votes[cur[i + dy * w + dx]]++;
        let best = cur[i];
        for (let k = 1; k < votes.length; k++) if (votes[k] > votes[best]) best = k;
        if (votes[best] >= 5) out[i] = best;
      }
    }
    cur = out;
  }
  return cur;
}

// ---------- 看图：带坐标网格的参考图 ----------
function gridImage(img: Img, fg: Uint8Array, crop: Box4, zoom: number): string {
  const [x0, y0, x1, y1] = crop;
  const W = (x1 - x0) * zoom, H = (y1 - y0) * zoom;
  const pad = 28;
  const c = Object.assign(document.createElement('canvas'), { width: W + pad * 2, height: H + pad * 2 });
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(img.el, x0, y0, x1 - x0, y1 - y0, pad, pad, W, H);
  // 轮廓：东西和背景的分界，品红
  g.fillStyle = '#ff2bd6';
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * img.w + x;
      if (fg[i] && (!fg[i - 1] || !fg[i + 1] || !fg[i - img.w] || !fg[i + img.w])) g.fillRect(pad + (x - x0) * zoom, pad + (y - y0) * zoom, zoom, zoom);
    }
  }
  const span = Math.max(x1 - x0, y1 - y0);
  const major = span > 600 ? 100 : span > 250 ? 50 : 20;
  const minor = major / (major === 100 ? 4 : 5);
  g.font = '11px monospace';
  for (let v = Math.ceil(x0 / minor) * minor; v <= x1; v += minor) {
    const X = pad + (v - x0) * zoom + 0.5;
    g.strokeStyle = v % major === 0 ? 'rgba(0,200,255,0.55)' : 'rgba(0,200,255,0.18)';
    g.beginPath(); g.moveTo(X, pad); g.lineTo(X, pad + H); g.stroke();
    if (v % major === 0) {
      g.fillStyle = '#7fe0ff';
      g.fillText(String(v), X - 10, pad - 8);
      g.fillText(String(v), X - 10, pad + H + 18);
    }
  }
  for (let v = Math.ceil(y0 / minor) * minor; v <= y1; v += minor) {
    const Y = pad + (v - y0) * zoom + 0.5;
    g.strokeStyle = v % major === 0 ? 'rgba(0,200,255,0.55)' : 'rgba(0,200,255,0.18)';
    g.beginPath(); g.moveTo(pad, Y); g.lineTo(pad + W, Y); g.stroke();
    if (v % major === 0) {
      g.fillStyle = '#7fe0ff';
      g.fillText(String(v), 0, Y + 4);
      g.fillText(String(v), pad + W + 2, Y + 4);
    }
  }
  return c.toDataURL('image/png');
}

/** 分类的结果：每类涂成它的游戏颜色（核对参考色挑得对不对） */
function classImage(img: Img, labels: Uint8Array, spec: Spec): string {
  const c = Object.assign(document.createElement('canvas'), { width: img.w, height: img.h });
  const g = c.getContext('2d')!;
  const out = g.createImageData(img.w, img.h);
  const names = Object.keys(spec.colors);
  const cols = names.map((n) => (spec.colors[n].game === 'metal' ? rgb('#3a3d44') : rgb(spec.colors[n].game)));
  for (let i = 0; i < labels.length; i++) {
    const col = labels[i] ? cols[labels[i] - 1] : ([238, 238, 238] as RGB);
    out.data.set([...col, 255], i * 4);
  }
  g.putImageData(out, 0, 0);
  g.font = 'bold 16px sans-serif';
  names.forEach((n, k) => {
    g.fillStyle = hex(cols[k]);
    g.fillRect(10, 10 + k * 24, 18, 18);
    g.fillStyle = '#222';
    g.fillText(n, 34, 25 + k * 24);
  });
  return c.toDataURL('image/png');
}

// ---------- 量图 ----------
class Measure {
  readonly img: Img;
  readonly labels: Uint8Array;
  readonly names: string[];
  constructor(img: Img, labels: Uint8Array, names: string[]) {
    this.img = img;
    this.labels = labels;
    this.names = names;
  }
  /** 部件量哪些颜色 */
  classes(p: SrcPart): Set<number> {
    const list = p.mask ?? [p.color];
    if (list.includes('*')) return new Set(this.names.map((_, k) => k + 1));
    return new Set(list.map((n) => {
      const k = this.names.indexOf(n);
      if (k < 0) throw new Error(`${p.id}：没有颜色 ${n}`);
      return k + 1;
    }));
  }
  hit(x: number, y: number, cls: Set<number>, box?: Box4): boolean {
    if (box && (x < box[0] || x >= box[2] || y < box[1] || y >= box[3])) return false;
    if (x < 0 || y < 0 || x >= this.img.w || y >= this.img.h) return false;
    return cls.has(this.labels[y * this.img.w + x]);
  }
  /** 一列（vertical = 一行）里这些颜色的最上、最下（最左、最右） */
  extent(a: number, vertical: boolean, cls: Set<number>, box?: Box4): XY | null {
    const n = vertical ? this.img.w : this.img.h;
    let lo = -1, hi = -1;
    for (let b = 0; b < n; b++) {
      if (vertical ? this.hit(b, a, cls, box) : this.hit(a, b, cls, box)) {
        if (lo < 0) lo = b;
        hi = b + 1;
      }
    }
    return lo < 0 ? null : [lo, hi];
  }
  bbox(cls: Set<number>, box?: Box4): Box4 | null {
    const [bx0, by0, bx1, by1] = box ?? [0, 0, this.img.w, this.img.h];
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = Math.max(0, by0); y < Math.min(this.img.h, by1); y++) {
      for (let x = Math.max(0, bx0); x < Math.min(this.img.w, bx1); x++) {
        if (!cls.has(this.labels[y * this.img.w + x])) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
      }
    }
    return x1 < 0 ? null : [x0, y0, x1, y1];
  }
  /** 框里这些颜色最大的一块的外轮廓（摩尔邻域跟踪），像素坐标 */
  contour(cls: Set<number>, box: Box4): XY[] {
    const [x0, y0] = box;
    const w = box[2] - box[0], h = box[3] - box[1];
    const on = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) on[y * w + x] = this.hit(x0 + x, y0 + y, cls, box) ? 1 : 0;
    const comp = components((i) => on[i] === 1, w, h);
    if (!comp.area.length) return [];
    const big = comp.area.indexOf(Math.max(...comp.area));
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && comp.id[y * w + x] === big;
    let s = 0;
    while (comp.id[s] !== big) s++;
    const sx = s % w, sy = (s / w) | 0;
    const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
    const pts: XY[] = [];
    let x = sx, y = sy, d = 0, first = -1;
    for (let guard = 0; guard < w * h * 4; guard++) {
      pts.push([x0 + x + 0.5, y0 + y + 0.5]);
      let moved = -1;
      for (let i = 0; i < 8; i++) {
        const nd = (d + 6 + i) % 8;
        if (inside(x + DX[nd], y + DY[nd])) { moved = nd; break; }
      }
      if (moved < 0) break;
      if (first < 0) first = moved;
      else if (x === sx && y === sy && moved === first) break;
      x += DX[moved]; y += DY[moved]; d = moved;
    }
    pts.pop();
    return pts;
  }
}

/** 道格拉斯–普克：多通道的一维序列，留下偏差超过 tol 的点 */
function simplify1d(a: number[], ch: number[][], tol: number): number[] {
  const keep = new Set([0, a.length - 1]);
  const rec = (i: number, j: number) => {
    let worst = 0, at = -1;
    for (let k = i + 1; k < j; k++) {
      const f = (a[k] - a[i]) / (a[j] - a[i] || 1);
      for (const c of ch) {
        const e = Math.abs(c[k] - (c[i] + (c[j] - c[i]) * f));
        if (e > worst) { worst = e; at = k; }
      }
    }
    if (worst > tol && at > 0) {
      keep.add(at);
      rec(i, at);
      rec(at, j);
    }
  };
  rec(0, a.length - 1);
  return [...keep].sort((x, y) => x - y);
}

/** 闭合轮廓的道格拉斯–普克 */
function simplifyLoop(pts: XY[], tol: number): XY[] {
  if (pts.length < 4) return pts;
  const segDist = (p: XY, a: XY, b: XY) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const line = (list: XY[]): XY[] => {
    const keep = new Set([0, list.length - 1]);
    const rec = (i: number, j: number) => {
      let worst = 0, at = -1;
      for (let k = i + 1; k < j; k++) {
        const e = segDist(list[k], list[i], list[j]);
        if (e > worst) { worst = e; at = k; }
      }
      if (worst > tol) { keep.add(at); rec(i, at); rec(at, j); }
    };
    rec(0, list.length - 1);
    return [...keep].sort((x, y) => x - y).map((i) => list[i]);
  };
  let far = 0;
  pts.forEach((p, i) => { if (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i; });
  const a = line(pts.slice(0, far + 1));
  const b = line([...pts.slice(far), pts[0]]);
  return [...a, ...b.slice(1, -1)];
}

const interp = (list: XY[], a: number): number => {
  const s = [...list].sort((p, q) => p[0] - q[0]);
  if (a <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) if (a <= s[i][0]) return s[i - 1][1] + ((s[i][1] - s[i - 1][1]) * (a - s[i - 1][0])) / (s[i][0] - s[i - 1][0] || 1);
  return s[s.length - 1][1];
};
const median = (arr: number[], r: number) => arr.map((_, i) => {
  const w = arr.slice(Math.max(0, i - r), i + r + 1).sort((x, y) => x - y);
  return w[w.length >> 1];
});

// ---------- 部件表 → 模型数据 ----------
interface Resolved { data: PropData; warnings: string[]; rect: Box4 }

function resolve(spec: Spec, m: Measure, bbox: Box4): Resolved {
  const k = (spec.scale[1] * 1000) / spec.scale[0];
  const [ox, oy] = spec.origin;
  const U = (x: number) => r1((x - ox) * k), V = (y: number) => r1((oy - y) * k), L = (px: number) => r1(px * k);
  const long = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const min = spec.min ?? Math.max(2, long / 150);
  const tol = spec.tol ?? Math.max(1, long / 300);
  const warnings: string[] = [];
  const thicken = (p: SrcPart, what: string, v: number) => {
    if (v >= min) return v;
    warnings.push(`${p.id}：${what} ${v.toFixed(1)} 像素太细，加到 ${min.toFixed(1)}`);
    return min;
  };
  const need = <T,>(p: SrcPart, v: T | null | undefined, what: string): T => {
    if (v == null) throw new Error(`${p.id}：${what}`);
    return v;
  };

  const loft = (p: SrcPart): LoftPart & { id: string; c: string } => {
    const lathe = p.kind === 'lathe';
    const vertical = lathe ? !!p.vertical : !!p.y && !p.x;
    const cls = m.classes(p);
    // 每站 [沿轴, 上(左), 下(右), 厚]
    let st: number[][] = [];
    if (p.pts) st = p.pts.map((s) => [...s]);
    else if (lathe && p.r !== undefined && p.axis !== undefined) {
      const range = need(p, vertical ? p.y : p.x, '手写半径要给范围 x（竖的给 y）');
      const rs: XY[] = typeof p.r === 'number' ? [[range[0], p.r], [range[1], p.r]] : p.r;
      st = rs.map(([a, r]) => [a, p.axis! - r, p.axis! + r, 2 * r]);
    } else {
      const bb = need(p, m.bbox(cls, p.box), `框里找不到颜色 ${[...(p.mask ?? [p.color])].join('/')}`);
      const range = (vertical ? p.y : p.x) ?? (vertical ? [bb[1], bb[3]] : [bb[0], bb[2]]);
      const a: number[] = [], lo: number[] = [], hi: number[] = [];
      for (let s = Math.round(range[0]); s < Math.round(range[1]); s++) {
        const e = m.extent(s, vertical, cls, p.box);
        if (!e) continue;
        a.push(s + 0.5);
        lo.push(e[0]);
        hi.push(e[1]);
      }
      // 只剩一两个像素的列不算：两头是抗锯齿的边，中间是被别的部件（箍）挡住、零星分错颜色的像素
      const big = Math.max(...lo.map((v, i) => hi[i] - v));
      for (let i = a.length - 1; i >= 0; i--) {
        if (hi[i] - lo[i] < big * 0.2) { a.splice(i, 1); lo.splice(i, 1); hi.splice(i, 1); }
      }
      if (a.length < 2) throw new Error(`${p.id}：量不到轮廓`);
      // 被挡住的边自己写的那段
      const over = (list: XY[] | undefined, arr: number[]) => {
        if (!list?.length) return;
        const [s0, s1] = [Math.min(...list.map((v) => v[0])), Math.max(...list.map((v) => v[0]))];
        a.forEach((s, i) => { if (s >= s0 && s <= s1) arr[i] = interp(list, s); });
      };
      over(vertical ? p.left : p.top, lo);
      over(vertical ? p.right : p.bottom, hi);
      let LO = median(lo, 3), HI = median(hi, 3);
      if (lathe) {
        const axis = p.axis ?? median(LO.map((v, i) => (v + HI[i]) / 2), 3).sort((x, y) => x - y)[LO.length >> 1];
        const edge = p.edge ?? 'both';
        const r = LO.map((v, i) => (edge === 'top' ? axis - v : edge === 'bottom' ? HI[i] - axis : (HI[i] - v) / 2));
        LO = r.map((v) => axis - v);
        HI = r.map((v) => axis + v);
      }
      const ctr = LO.map((v, i) => (v + HI[i]) / 2);
      const W = a.map((s, i) => {
        if (lathe) return HI[i] - LO[i];
        if (typeof p.w === 'number') return p.w;
        if (Array.isArray(p.w)) return interp(p.w, s);
        // 不写厚：和截面一样（垂直于中线量的高）
        const j0 = Math.max(0, i - 6), j1 = Math.min(a.length - 1, i + 6);
        const slope = (ctr[j1] - ctr[j0]) / (a[j1] - a[j0] || 1);
        return (HI[i] - LO[i]) * Math.cos(Math.atan(slope));
      });
      const keep = simplify1d(a, [LO, HI, W], tol);
      st = keep.map((i) => [a[i], LO[i], HI[i], W[i]]);
      // 两头补到范围的边上（量的是像素中心）
      st[0][0] = Math.min(st[0][0], a[0] - 0.5);
      st[st.length - 1][0] = Math.max(st[st.length - 1][0], a[a.length - 1] + 0.5);
    }
    let warned = false;
    const d = p.d ?? 0;
    const g = p.grow ?? 0;
    const stations = st.map(([s, lo0, hi0, w0]) => {
      let lo = lo0 - g, hi = hi0 + g, w = w0 + 2 * g;
      let h = hi - lo;
      if (h < min || w < min) {
        if (!warned) thicken(p, `截面（${vertical ? 'y' : 'x'} = ${Math.round(s)}）`, Math.min(h, w));
        warned = true;
        const c = (lo + hi) / 2;
        h = Math.max(h, min);
        lo = c - h / 2;
        hi = c + h / 2;
        w = Math.max(w, min);
      }
      const c = (lo + hi) / 2;
      return (vertical ? [V(s), U(c), L(h / 2), L(d), L(w / 2)] : [U(s), V(c), L(h / 2), L(d), L(w / 2)]) as LoftPart['s'][number];
    }).sort((x, y) => x[0] - y[0]);
    const small = Math.max(...stations.map((s) => Math.max(s[2], s[4]))) < (long * k) / 50;
    const out: LoftPart & { id: string; c: string } = { id: p.id, c: p.color, k: 'loft', axis: vertical ? 'v' : 'u', s: stations };
    if (p.n && p.n !== 2) out.n = p.n;
    const seg = p.seg ?? (small ? 6 : 8);
    if (seg !== 8) out.seg = seg;
    if (p.bore) out.hole = [L(p.bore), L(p.boreDepth ?? p.bore * 2.5)];
    return out;
  };

  const region = (p: SrcPart): Box4 => need(p, m.bbox(m.classes(p), p.box), `框 ${JSON.stringify(p.box)} 里找不到颜色 ${(p.mask ?? [p.color]).join('/')}`);

  const one = (p: SrcPart): PropPart => {
    const d = p.d ?? 0;
    const ex = p.explode;
    // 开合：转轴的点是图上的像素（d 不写 = 部件的 d），平移是像素（图右、图上、朝看图的人），都换成毫米；轴的方向不用换
    const motion = (s: SrcMotion): Motion => {
      if (s.deg && s.axis !== undefined && typeof s.axis !== 'string' && s.axis.length !== 3) throw new Error(`${p.id}：open 的 axis 要三个数 [右, 上, 朝外]`);
      return {
        ...(s.name ? { name: s.name } : {}),
        ...(s.pivot ? { pivot: [U(s.pivot[0]), V(s.pivot[1]), L(s.pivot[2] ?? d)] as Vec3 } : {}),
        ...(s.axis !== undefined ? { axis: s.axis } : {}),
        ...(s.deg ? { deg: s.deg } : {}),
        ...(s.move ? { move: [L(s.move[0] ?? 0), L(s.move[1] ?? 0), L(s.move[2] ?? 0)] as Vec3 } : {}),
        ...(s.span ? { span: s.span } : {}),
      };
    };
    const base = {
      id: p.id, c: p.color, ...(p.own ? { own: true } : {}), ...(p.paint ? { paint: true } : {}),
      ...(p.group ? { group: p.group } : {}), ...(p.on ? { on: p.on } : {}),
      // 直接给的位移是像素（图右、图上、朝看图的人），换成毫米
      ...(ex ? { explode: Array.isArray(ex) ? ([L(ex[0]), L(ex[1]), L(ex[2])] as Vec3) : ex } : {}),
      ...(p.open ? { open: ([] as SrcMotion[]).concat(p.open).map(motion) } : {}),
    };
    switch (p.kind) {
      case 'sweep':
      case 'lathe':
        return { ...loft(p), ...base };
      case 'plate': {
        let pts = p.pts as XY[] | undefined;
        if (!pts) {
          const raw = m.contour(m.classes(p), need(p, p.box, '自动描轮廓要给框 box'));
          if (raw.length < 3) throw new Error(`${p.id}：框里描不出轮廓`);
          pts = simplifyLoop(raw, tol);
        }
        const t = thicken(p, '厚', p.t ?? min);
        return { ...base, k: 'plate', pts: pts.map(([x, y]) => [U(x), V(y)] as XY), w: L(d), t: L(t) };
      }
      case 'box': {
        let at = p.at, size = p.size;
        if (!at || !size) {
          const b = region(p);
          at ??= [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, d];
          size ??= [b[2] - b[0], b[3] - b[1], p.t ?? Math.min(b[2] - b[0], b[3] - b[1])];
        }
        const g = p.grow ?? 0;
        const sz = size.map((v, i) => thicken(p, ['长', '高', '厚'][i], i < 2 ? v + 2 * g : v));
        if (p.taper) {
          // 往 +w 收口的梯台（键帽、台座）：底面 = 量到的框，顶面每边往里收 taper 像素；4 段的放样，16 个三角形
          if (p.rot) warnings.push(`${p.id}：taper 和 rot 不能一起用，rot 没管`);
          const [x, y, dd = d] = at;
          const tu = Math.max(min / 2, sz[0] / 2 - p.taper), tv = Math.max(min / 2, sz[1] / 2 - p.taper);
          const s: LoftPart['s'] = [
            [L(dd - sz[2] / 2), U(x), L(sz[0] / 2), V(y), L(sz[1] / 2)],
            [L(dd + sz[2] / 2), U(x), L(tu), V(y), L(tv)],
          ];
          return { ...base, k: 'loft', axis: 'w', s, seg: 4 };
        }
        return { ...base, k: 'box', at: [U(at[0]), V(at[1]), L(at[2] ?? d)], size: [L(sz[0]), L(sz[1]), L(sz[2])], ...(p.rot ? { rot: p.rot } : {}) };
      }
      case 'cyl': {
        const b = p.at && p.r !== undefined ? null : region(p);
        const at = p.at ?? [(b![0] + b![2]) / 2, (b![1] + b![3]) / 2, d];
        const axis = p.dir ?? 'w';
        let r = typeof p.r === 'number' ? p.r : axis === 'w' ? Math.max(b![2] - b![0], b![3] - b![1]) / 2 : axis === 'u' ? (b![3] - b![1]) / 2 : (b![2] - b![0]) / 2;
        r = thicken(p, '粗', r * 2) / 2;
        const len = thicken(p, '长', p.len ?? (axis === 'w' ? r : axis === 'u' ? b![2] - b![0] : b![3] - b![1]));
        const [x, y, dd = d] = at;
        const s: LoftPart['s'] = axis === 'w'
          ? [[L(dd - len / 2), U(x), L(r), V(y), L(r)], [L(dd + len / 2), U(x), L(r), V(y), L(r)]]
          : axis === 'u'
            ? [[U(x - len / 2), V(y), L(r), L(dd), L(r)], [U(x + len / 2), V(y), L(r), L(dd), L(r)]]
            : [[V(y + len / 2), U(x), L(r), L(dd), L(r)], [V(y - len / 2), U(x), L(r), L(dd), L(r)]];
        return { ...base, k: 'loft', axis, s, seg: p.seg ?? 6 };
      }
      case 'ring': {
        const b = region(p);
        const tube = thicken(p, '管粗', p.tube ?? min);
        return { ...base, k: 'ring', at: [U((b[0] + b[2]) / 2), V((b[1] + b[3]) / 2), L(d)], r: [L((b[2] - b[0] - tube) / 2), L((b[3] - b[1] - tube) / 2)], tube: L(tube / 2) };
      }
      case 'ball': {
        const b = p.at ? null : region(p);
        const at = p.at ?? [(b![0] + b![2]) / 2, (b![1] + b![3]) / 2, d];
        const rr = (p.size ?? [(b![2] - b![0]) / 2, (b![3] - b![1]) / 2]).map((v) => thicken(p, '粗', v * 2) / 2);
        return { ...base, k: 'ball', at: [U(at[0]), V(at[1]), L(at[2] ?? d)], r: [L(rr[0]), L(rr[1]), L(rr[2] ?? Math.min(rr[0], rr[1]))] };
      }
    }
  };

  // each：框里 mask 颜色的每一块（连通的）各做一个部件，框就是那一块的外框（键帽、铆钉、按钮：不用一个个读坐标）。
  // 比最大那几块（前 10%）的 15% 还小的不要：键帽上印的字、杂点
  const expand = (p: SrcPart): SrcPart[] => {
    if (!p.each) return [p];
    const cls = m.classes(p);
    const { w, h } = m.img;
    const [bx0, by0, bx1, by1] = p.box ?? [0, 0, w, h];
    const comp = components((i) => {
      const x = i % w, y = (i / w) | 0;
      return x >= bx0 && x < bx1 && y >= by0 && y < by1 && cls.has(m.labels[i]);
    }, w, h);
    const bb = comp.area.map((): Box4 => [Infinity, Infinity, -1, -1]);
    for (let i = 0; i < w * h; i++) {
      const n = comp.id[i];
      if (n < 0) continue;
      const x = i % w, y = (i / w) | 0, b = bb[n];
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x + 1); b[3] = Math.max(b[3], y + 1);
    }
    const desc = [...comp.area].sort((a, b) => b - a);
    const big = desc[Math.floor(desc.length * 0.1)] ?? 0;
    const keep = comp.area.map((_, n) => n).filter((n) => comp.area[n] >= Math.max(min * min, big * 0.15));
    if (!keep.length) throw new Error(`${p.id}：each 在框里找不到颜色 ${[...(p.mask ?? [p.color])].join('/')}`);
    // 一行一行、从左到右编号
    const cy = (n: number) => Math.round((bb[n][1] + bb[n][3]) / 32), cx = (n: number) => bb[n][0] + bb[n][2];
    keep.sort((a, b) => cy(a) - cy(b) || cx(a) - cx(b));
    const dropped = comp.area.length - keep.length;
    warnings.push(`${p.id}：each 拆成 ${keep.length} 个${dropped ? `（${dropped} 块太小，是字或杂点，没要）` : ''}`);
    return keep.map((n, k) => ({ ...p, each: undefined, id: `${p.id}${k + 1}`, box: bb[n] }));
  };
  const src = spec.parts.flatMap(expand);

  // 另一面那个：组、装在谁上面、往哪挪也跟着翻过去（组是另一面自己的一组，比如另一只鞋）
  const mirrored = new Set(src.filter((p) => p.mirror).map((p) => p.id));
  const mirror = (p: PropPart): PropPart => {
    const c = structuredClone(p);
    c.id += '_m';
    if (c.k === 'loft') c.s = c.s.map((s) => (c.axis === 'w' ? [-s[0], s[1], s[2], s[3], s[4]] : [s[0], s[1], s[2], -s[3], s[4]]) as LoftPart['s'][number]).sort((x, y) => x[0] - y[0]);
    else if (c.k === 'plate') c.w = -c.w;
    else c.at[2] = -c.at[2];
    if (c.group) c.group += '_m';
    if (c.on && mirrored.has(c.on)) c.on += '_m';
    if (Array.isArray(c.explode)) c.explode = [c.explode[0], c.explode[1], -c.explode[2]];
    else if (c.explode === '+w') c.explode = '-w';
    else if (c.explode === '-w') c.explode = '+w';
    // 开合照镜子翻：转轴的点、平移的 w 取反；绕 u、v（或带 u、v 的轴）转的反过来转，绕 w 转的不变
    if (c.open) {
      c.open = ([] as Motion[]).concat(c.open).map((s) => {
        const m: Motion = { ...s };
        if (m.pivot) m.pivot = [m.pivot[0], m.pivot[1], -m.pivot[2]];
        if (m.move) m.move = [m.move[0], m.move[1], -m.move[2]];
        if (m.deg && m.axis !== undefined && m.axis !== 'w') {
          if (typeof m.axis !== 'string') m.axis = [m.axis[0], m.axis[1], -m.axis[2]];
          m.deg = -m.deg;
        }
        return m;
      });
    }
    return c;
  };

  const parts: PropPart[] = [];
  for (const p of src) {
    const r = one(p);
    parts.push(r);
    if (p.mirror) parts.push(mirror(r));
  }
  const ids = new Set(parts.map((p) => p.id));
  for (const p of parts) if (p.on && !ids.has(p.on)) warnings.push(`${p.id}：on「${p.on}」没有这个部件，拆开时不跟着谁`);
  const pad = 2;
  const rect: Box4 = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad];
  const data: PropData = {
    id: spec.id,
    frame: spec.frame,
    colors: Object.fromEntries(Object.entries(spec.colors).map(([n, c]) => [n, c.game])),
    ...(spec.game?.scale ? { scale: spec.game.scale } : {}),
    ...(spec.game?.grip ? { gun: { grip: spec.game.grip, support: spec.game.support ?? [0, 0, 0] } } : {}),
    sockets: Object.fromEntries(Object.entries(spec.sockets ?? {}).map(([n, [x, y, dd = 0]]) => [n, [U(x), V(y), L(dd)] as Vec3])),
    parts,
  };
  if (spec.tex !== false) {
    // 只存部件用得到的颜色层（只画在别的部件上的颜色，比如坛子上的红纸，在原色那层里）
    const layers = Object.keys(spec.colors).filter((c) => spec.parts.some((p) => p.color === c && !p.paint));
    if (spec.parts.some((p) => p.paint)) layers.push('*');
    data.tex = { rect: [U(rect[0]), V(rect[3]), U(rect[2]), V(rect[1])], layers };
    if (spec.tex?.normal) data.tex.normal = true;
  }
  return { data, warnings, rect };
}

// ---------- 贴图：参考图投到模型上 ----------
/**
 * 每个颜色一层：只取这个颜色的像素（往里收 1 像素，避开和背景、别的颜色混的边），缩到 size；
 * "*" 那层（paint 的部件用）取所有颜色，存原色（去掉七成打光，压成两倍的色阶，存线性值，材质是白色）；
 * 去掉照片的打光（除以大范围的平均，只留纹理），压成几个色阶（像素画），存成相对原色的明暗（0.5 = 原色）。
 * 这一层里取不到的地方（被别的部件挡住的、背面）用最近的填上。法线图从明暗推（亮 = 高）。
 */
function bakeTexture(img: Img, labels: Uint8Array, rect: Box4, names: string[], classNames: string[], opt: { size?: number; tones?: number; contrast?: number; normal?: number }) {
  const paint = names.indexOf('*');
  const size = opt.size ?? 256, tones = opt.tones ?? 4, contrast = opt.contrast ?? 0.9, strength = opt.normal || 2;
  const RW = rect[2] - rect[0], RH = rect[3] - rect[1];
  const LW = RW >= RH ? size : Math.round((size * RW) / RH);
  const LH = RW >= RH ? Math.round((size * RH) / RW) : size;
  const n = names.length;
  const color = Object.assign(document.createElement('canvas'), { width: LW * n, height: LH });
  const normal = Object.assign(document.createElement('canvas'), { width: LW * n, height: LH });
  const cd = color.getContext('2d')!.createImageData(LW * n, LH);
  const nd = normal.getContext('2d')!.createImageData(LW * n, LH);
  const W = img.w;
  const label = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= img.h ? 0 : labels[y * W + x]);
  for (let k = 0; k < n; k++) {
    const cls = classNames.indexOf(names[k]) + 1;
    const all = k === paint;
    const same = (x: number, y: number) => (all ? label(x, y) > 0 : label(x, y) === cls);
    const sum = new Float32Array(LW * LH * 3);
    const cnt = new Float32Array(LW * LH);
    // 原色那层：每个贴图像素里哪种颜色最多，各颜色各自去打光（混在一起求平均，深色的坛身会把浅色的布压暗）
    const K = classNames.length;
    const per = all ? new Float32Array(LW * LH * K * 4) : null;
    for (let y = Math.max(0, rect[1]); y < Math.min(img.h, rect[3]); y++) {
      for (let x = Math.max(0, rect[0]); x < Math.min(W, rect[2]); x++) {
        if (!same(x, y)) continue;
        if (!same(x - 1, y) || !same(x + 1, y) || !same(x, y - 1) || !same(x, y + 1)) continue;
        const tx = Math.min(LW - 1, Math.floor(((x - rect[0]) / RW) * LW));
        const ty = Math.min(LH - 1, Math.floor(((y - rect[1]) / RH) * LH));
        const i = ty * LW + tx, o = (y * W + x) * 4;
        sum[i * 3] += img.d[o]; sum[i * 3 + 1] += img.d[o + 1]; sum[i * 3 + 2] += img.d[o + 2];
        cnt[i]++;
        if (per) {
          const j = (i * K + label(x, y) - 1) * 4;
          per[j] += img.d[o]; per[j + 1] += img.d[o + 1]; per[j + 2] += img.d[o + 2]; per[j + 3]++;
        }
      }
    }
    const has = new Uint8Array(LW * LH);
    const col = new Float32Array(LW * LH * 3);
    for (let i = 0; i < LW * LH; i++) {
      if (!cnt[i]) continue;
      has[i] = 1;
      for (let c = 0; c < 3; c++) col[i * 3 + c] = sum[i * 3 + c] / cnt[i];
    }
    // 大范围的平均（只算有的地方）：照片的打光、圆柱的明暗都在这里面
    const R = Math.max(2, Math.round(Math.max(LW, LH) / 22));
    const blur = boxBlur(col, has, LW, LH, R);
    const ratio = new Float32Array(LW * LH * 3);
    // 原色那层：每个颜色自己的大范围平均和整体平均亮度
    const lightOf: ((i: number) => number)[] = [];
    if (per) {
      for (let c = 0; c < K; c++) {
        const hc = new Uint8Array(LW * LH), cc = new Float32Array(LW * LH * 3);
        for (let i = 0; i < LW * LH; i++) {
          const j = (i * K + c) * 4;
          if (!per[j + 3]) continue;
          hc[i] = 1;
          for (let ch = 0; ch < 3; ch++) cc[i * 3 + ch] = per[j + ch] / per[j + 3];
        }
        const bl = boxBlur(cc, hc, LW, LH, R);
        let m = 0, nm = 0;
        for (let i = 0; i < LW * LH; i++) if (hc[i]) { m += bl[i * 3] + bl[i * 3 + 1] + bl[i * 3 + 2]; nm++; }
        m /= nm || 1;
        // 去掉七成打光：亮的地方压暗、暗的提亮
        lightOf.push((i) => (m / Math.max(1, bl[i * 3] + bl[i * 3 + 1] + bl[i * 3 + 2])) ** 0.7);
      }
    }
    for (let i = 0; i < LW * LH; i++) {
      if (!has[i]) continue;
      if (per) {
        let best = 0;
        for (let c = 1; c < K; c++) if (per[(i * K + c) * 4 + 3] > per[(i * K + best) * 4 + 3]) best = c;
        const k2 = lightOf[best](i);
        for (let c = 0; c < 3; c++) ratio[i * 3 + c] = (col[i * 3 + c] * k2) / 255;
      } else for (let c = 0; c < 3; c++) ratio[i * 3 + c] = 1 + (col[i * 3 + c] / Math.max(1, blur[i * 3 + c]) - 1) * contrast;
    }
    // 色阶：明暗比例（原色那层是颜色）聚成几类
    const q = quantize(ratio, has, all ? tones * 2 : tones);
    // 法线：明暗当高度
    const hgt = new Float32Array(LW * LH);
    for (let i = 0; i < LW * LH; i++) hgt[i] = has[i] ? Math.log(Math.max(0.05, (ratio[i * 3] + ratio[i * 3 + 1] + ratio[i * 3 + 2]) / 3)) : 0;
    fill(q, has, LW, LH, 3);
    for (let y = 0; y < LH; y++) {
      for (let x = 0; x < LW; x++) {
        const i = y * LW + x, o = (y * LW * n + k * LW + x) * 4;
        // 原色那层存线性值（贴图不做 sRGB 换算，材质是白色）；别的层存明暗比例的一半
        for (let c = 0; c < 3; c++) cd.data[o + c] = Math.max(0, Math.min(255, Math.round((all ? srgbToLinear(q[i * 3 + c]) : q[i * 3 + c] * 0.5) * 255)));
        cd.data[o + 3] = 255;
        const hh = (xx: number, yy: number) => hgt[Math.max(0, Math.min(LH - 1, yy)) * LW + Math.max(0, Math.min(LW - 1, xx))];
        let nx = 0, ny = 0;
        if (has[i]) {
          nx = -(hh(x + 1, y) - hh(x - 1, y)) * strength;
          ny = (hh(x, y + 1) - hh(x, y - 1)) * strength;
        }
        const l = Math.hypot(nx, ny, 1);
        nd.data[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
        nd.data[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
        nd.data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
        nd.data[o + 3] = 255;
      }
    }
  }
  color.getContext('2d')!.putImageData(cd, 0, 0);
  normal.getContext('2d')!.putImageData(nd, 0, 0);
  return { color, normal, LW, LH };
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function boxBlur(src: Float32Array, has: Uint8Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(src.length);
  const S = new Float64Array((w + 1) * (h + 1) * 4);
  const at = (x: number, y: number) => (y * (w + 1) + x) * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = at(x + 1, y + 1);
      for (let c = 0; c < 4; c++) {
        const v = c < 3 ? (has[i] ? src[i * 3 + c] : 0) : has[i];
        S[o + c] = v + S[at(x, y + 1) + c] + S[at(x + 1, y) + c] - S[at(x, y) + c];
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const box = (c: number) => S[at(x1, y1) + c] - S[at(x0, y1) + c] - S[at(x1, y0) + c] + S[at(x0, y0) + c];
      const n = box(3) || 1;
      for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = box(c) / n;
    }
  }
  return out;
}

function quantize(v: Float32Array, has: Uint8Array, k: number): Float32Array {
  const idx: number[] = [];
  for (let i = 0; i < has.length; i++) if (has[i]) idx.push(i);
  const out = new Float32Array(v.length).fill(1);
  if (!idx.length) return out;
  const lum = (i: number) => v[i * 3] + v[i * 3 + 1] + v[i * 3 + 2];
  const sorted = [...idx].sort((a, b) => lum(a) - lum(b));
  // 按明暗分位数起头，几轮 k-means
  let cs = Array.from({ length: k }, (_, j) => { const i = sorted[Math.floor(((j + 0.5) / k) * sorted.length)]; return [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]; });
  const lab = new Int32Array(has.length);
  for (let it = 0; it < 8; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const i of idx) {
      let best = 0, bd = Infinity;
      cs.forEach((c, j) => { const e = (v[i * 3] - c[0]) ** 2 + (v[i * 3 + 1] - c[1]) ** 2 + (v[i * 3 + 2] - c[2]) ** 2; if (e < bd) { bd = e; best = j; } });
      lab[i] = best;
      for (let c = 0; c < 3; c++) sum[best][c] += v[i * 3 + c];
      sum[best][3]++;
    }
    cs = cs.map((c, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c));
  }
  for (const i of idx) for (let c = 0; c < 3; c++) out[i * 3 + c] = cs[lab[i]][c];
  return out;
}

/** 没取到的地方一圈一圈往外填最近的 */
function fill(v: Float32Array, has: Uint8Array, w: number, h: number, ch: number): void {
  let cur = has.slice();
  for (let pass = 0; pass < w + h; pass++) {
    const next = cur.slice();
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) continue;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && cur[j]) {
            for (let c = 0; c < ch; c++) v[i * ch + c] = v[j * ch + c];
            next[i] = 1;
            changed = true;
            break;
          }
        }
      }
    }
    cur = next;
    if (!changed) break;
  }
}

// ---------- 和参考图同机位比 ----------
function compare(data: PropData, spec: Spec, img: Img, labels: Uint8Array, names: string[]) {
  const W = img.w, H = img.h;
  const k = spec.scale[1] / spec.scale[0];
  const [ox, oy] = spec.origin;
  const flat = { ...data, scale: undefined, tex: undefined };
  const built = buildProp(flat, { split: true });
  // paint 的部件贴的是参考图的原色，图上哪种颜色都算对上：画成 255
  const ANY = 255;
  const byId = new Map(data.parts.map((p) => [p.id, p.paint ? ANY : names.indexOf(p.c) + 1]));
  built.model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const cls = byId.get(o.name)!;
    o.material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(cls / 255, 0, 0, THREE.LinearSRGBColorSpace) });
  });
  const scene = new THREE.Scene();
  scene.add(built.group);
  const cam = new THREE.OrthographicCamera(-ox * k, (W - ox) * k, oy * k, -(H - oy) * k, 0.001, 10);
  const toViewer = spec.frame === 'side' ? new THREE.Vector3(-1, 0, 0) : spec.frame === 'top' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  cam.position.copy(toViewer);
  // 俯视：图上 = 远处（−Z）
  if (spec.frame === 'top') cam.up.set(0, 0, -1);
  else cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const rt = new THREE.WebGLRenderTarget(W, H);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.dispose();
  rt.dispose();
  const model = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) model[y * W + x] = buf[((H - 1 - y) * W + x) * 4];
  let both = 0, either = 0, same = 0;
  const inter = new Array(names.length + 1).fill(0), uni = new Array(names.length + 1).fill(0);
  const diff = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = diff.getContext('2d')!;
  const out = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const a = labels[i], b = model[i];
    const ok = a === b || b === ANY;
    let c: RGB;
    if (a && b) {
      both++;
      if (ok) same++;
      const o = i * 4;
      const lum = (img.d[o] + img.d[o + 1] + img.d[o + 2]) / 3;
      c = ok ? [lum * 0.5 + 90, lum * 0.5 + 90, lum * 0.5 + 90] : [235, 200, 40];
    } else if (a) c = [230, 50, 50];
    else if (b) c = [60, 110, 240];
    else c = [24, 24, 28];
    if (a || b) either++;
    for (let n = 1; n <= names.length; n++) {
      if (a === n && (b === n || b === ANY)) inter[n]++;
      if (a === n || b === n) uni[n]++;
    }
    out.data.set([...c, 255], i * 4);
  }
  g.putImageData(out, 0, 0);
  const perClass = Object.fromEntries(names.map((n, j) => [n, uni[j + 1] ? inter[j + 1] / uni[j + 1] : 1]));
  return { iou: both / either, sameColor: same / (both || 1), perClass, diff };
}

// ---------- 像素风的样子 ----------
/** 转台转多少：看参考图那一面（铳是机头那面、瓶罐是正面），斜一点 */
let YAW = 2.2;
async function pixelViews(data: PropData, mapUrl: string | undefined, normalUrl: string | undefined) {
  // 平放的（top）从前面斜上方看，俯角大一点：顶面才是要看的
  YAW = data.frame === 'front' ? 0.5 : data.frame === 'top' ? 0.35 : 2.2;
  const close = data.frame === 'top' ? 38 : 22;
  const views: { title: string; build: () => ReturnType<typeof buildProp>; yaw: number; pitch: number; game?: boolean; explode?: boolean; open?: boolean; small?: boolean }[] = [
    { title: '近看 · 纯色', build: () => buildProp(data), yaw: YAW, pitch: close },
    { title: '近看 · 贴图', build: () => buildProp(data, { map: mapUrl }), yaw: YAW, pitch: close },
    { title: '近看 · 贴图 + 法线', build: () => buildProp(data, { map: mapUrl, normalMap: normalUrl }), yaw: YAW, pitch: close },
    { title: '游戏视角（俯 60°）· 贴图', build: () => buildProp(data, { map: mapUrl }), yaw: YAW, pitch: 60 },
    { title: '游戏里的大小（像素块再放大 3 倍）', build: () => buildProp(data, { map: mapUrl }), yaw: YAW, pitch: 60, game: true, small: true },
    { title: '拆开', build: () => buildProp(data, { map: mapUrl, split: true }), yaw: YAW, pitch: 30, explode: true },
  ];
  // 写了开合的：再来一格，所有动作都到 1
  const actions = buildProp(data).actions;
  if (actions.length) views.push({ title: `开合（${actions.join('、')}）`, build: () => buildProp(data, { map: mapUrl }), yaw: YAW, pitch: 30, open: true });
  if (!mapUrl) views.splice(1, 2);
  const rows = [el('div', 'row'), el('div', 'row')];
  sheet.append(...rows);
  const stages: { stage: PreviewStage; model: ReturnType<typeof buildProp> }[] = [];
  views.forEach((v, i) => {
    const cell = el('div', 'cell');
    cell.append(Object.assign(el('b'), { textContent: v.title }));
    const box = el('div', `stage${v.small ? ' small' : ''}`);
    cell.append(box);
    rows[i < 3 ? 0 : 1].append(cell);
    const stage = new PreviewStage(box, {}, 'felt');
    stage.autoSpin = 0;
    const model = v.build();
    stage.setContent(model.group);
    if (v.explode) model.pose(1, 0);
    if (v.open) model.pose(0, 1);
    stage.place(model.group);
    // 拆开时有部件沿 w（垂直于参考图）分开的 front 类（瓶罐、手机），机位再侧过来一点：
    // 默认机位离正面只有 0.5，那几层正对着镜头叠在一起看不出来；side 类本来就是 3/4 侧面，不用转
    const depth = v.explode && data.frame === 'front' && model.parts.some((p) => Math.abs(p.dir.z) > 1e-6);
    const s = stage.settings;
    s.pitchDeg = v.pitch;
    stage.turntable.rotation.y = v.yaw + (depth ? 0.4 : 0);
    // 转好了再量：斜着看的时候，画面里的宽是长和厚各投一部分，只按长边算会裁掉（一双鞋）
    stage.turntable.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(stage.turntable).getSize(new THREE.Vector3());
    if (v.game) {
      // 游戏：画面 7.5 米高、270 行像素；这里只取中间一小块（同样每像素多少米），块放大看
      s.viewHeight = 7.5 / 8;
      s.baseHeight = 270 / 8;
      stage.pixel.target.set(0, size.y * 0.5, 0);
    } else {
      // 像素块 3 个页面像素（和游戏、物品页差不多大）：按块的大小定行数，不然格子小，270 行就成了高清
      s.baseHeight = box.clientHeight / 3;
      const aspect = box.clientWidth / box.clientHeight;
      // 画面的宽 = 转好以后的 x；高 = 竖着的 y 和往里的 z 按俯角各投一部分
      const p = THREE.MathUtils.degToRad(v.pitch);
      const tall = size.y * Math.cos(p) + size.z * Math.sin(p);
      s.viewHeight = Math.max((size.x * 1.1) / aspect, tall * 1.15);
      stage.pixel.target.set(0, size.y * 0.5, 0);
    }
    stage.pixel.resize();
    stages.push({ stage, model });
  });
  // 等贴图读进来
  for (let i = 0; i < 40; i++) {
    let ready = true;
    for (const { model } of stages) model.model.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.MeshToonMaterial).map && !(o.material as THREE.MeshToonMaterial).map!.image) ready = false;
    });
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  for (let f = 0; f < 3; f++) for (const { stage } of stages) stage.render(0);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function cropTo(src: HTMLCanvasElement | HTMLImageElement, box: Box4, width: number): HTMLCanvasElement {
  const w = box[2] - box[0], h = box[3] - box[1];
  const c = Object.assign(document.createElement('canvas'), { width, height: Math.round((width * h) / w) });
  const g = c.getContext('2d')!;
  g.drawImage(src, box[0], box[1], w, h, 0, 0, c.width, c.height);
  return c;
}

/** 部件表写成好读的 JSON：一个部件一行 */
function pretty(data: PropData): string {
  const lines = Object.entries(data).map(([k, v]) => {
    if (k === 'parts') return `  "parts": [\n${(v as PropPart[]).map((p) => '    ' + JSON.stringify(p)).join(',\n')}\n  ]`;
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => { if (o instanceof THREE.Mesh) n += o.geometry.getAttribute('position').count / 3; });
  return n;
}

async function main(): Promise<void> {
  const spec = input.spec;
  const img = await loadImage(input.image);
  const { bg, thr, fg, bbox } = foreground(img, (spec?.bg ?? []).map(rgb));
  lap('抠背景');

  if (input.trace) {
    const zoom = input.zoom;
    const pal = palette(img, fg);
    const pad = 30;
    const crop: Box4 = zoom ?? [Math.max(0, bbox[0] - pad), Math.max(0, bbox[1] - pad), Math.min(img.w, bbox[2] + pad), Math.min(img.h, bbox[3] + pad)];
    const z = zoom ? Math.max(2, Math.min(8, Math.floor(1100 / Math.max(crop[2] - crop[0], crop[3] - crop[1])))) : 1;
    const out: Record<string, unknown> = {
      size: [img.w, img.h], bg: hex(bg), threshold: Math.round(thr), bbox, long: Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]),
      palette: pal.map((p) => `${hex(p.c)} ${(p.share * 100).toFixed(1)}%`),
      grid: gridImage(img, fg, crop, z),
    };
    if (spec && !zoom) {
      const names = Object.keys(spec.colors);
      out.classes = classImage(img, classify(img, fg, names.map((n) => spec.colors[n].ref.map((r) => refColor(img, r)))), spec);
    }
    lap('看图');
    out.timing = timing;
    (window as unknown as { result: unknown }).result = out;
    return;
  }

  if (!spec) throw new Error(`${input.id} 还没有 prop.json：先 trace 看图，再写部件表`);
  const names = Object.keys(spec.colors);
  const labels = classify(img, fg, names.map((n) => spec.colors[n].ref.map((r) => refColor(img, r))));
  lap('分颜色');
  const { data, warnings, rect } = resolve(spec, new Measure(img, labels, names), bbox);
  lap('量部件');
  let tex: ReturnType<typeof bakeTexture> | null = null;
  if (data.tex) {
    tex = bakeTexture(img, labels, rect, data.tex.layers, names, spec.tex || {});
    lap('贴图');
  }
  const cmp = compare(data, spec, img, labels, names);
  lap('对比');
  const json = pretty(data);
  const game = buildProp(data);
  const stats = {
    triangles: triangles(game.model),
    meshes: game.model.children.filter((o) => o instanceof THREE.Mesh).length,
    parts: data.parts.length,
    bytes: json.length,
  };
  const mapUrl = tex?.color.toDataURL('image/png');
  const normalUrl = tex?.normal.toDataURL('image/png');

  // --- 审图页 ---
  const margin = 24;
  const crop: Box4 = [Math.max(0, bbox[0] - margin), Math.max(0, bbox[1] - margin), Math.min(img.w, bbox[2] + margin), Math.min(img.h, bbox[3] + margin)];
  const top = el('div', 'row');
  const refCell = el('div', 'cell');
  refCell.append(Object.assign(el('b'), { textContent: '参考图' }), cropTo(img.el, crop, 600));
  const diffCell = el('div', 'cell');
  diffCell.append(Object.assign(el('b'), { textContent: `同机位对比：灰 = 对上，红 = 少了，蓝 = 多了，黄 = 颜色不对` }), cropTo(cmp.diff, crop, 600));
  const nums = el('div', 'cell nums');
  const pct = (v: number) => (v * 100).toFixed(1) + '%';
  nums.textContent = [
    `轮廓重合 ${pct(cmp.iou)}   颜色对上 ${pct(cmp.sameColor)}`,
    ...Object.entries(cmp.perClass).map(([n, v]) => `  ${n.padEnd(8)} ${pct(v)}`),
    '',
    `${stats.parts} 个部件 → ${stats.meshes} 个网格，${stats.triangles} 个三角形`,
    `模型数据 ${(stats.bytes / 1024).toFixed(1)} KB` + (tex ? `，贴图 ${tex.LW * data.tex!.layers.length}×${tex.LH}${data.tex?.normal ? ' + 法线图' : '（法线图不进游戏）'}` : ''),
    '',
    ...Object.entries(timing).map(([k, v]) => `${k} ${v} ms`),
  ].join('\n');
  if (warnings.length) nums.append(Object.assign(el('div', 'warn'), { textContent: '\n' + warnings.join('\n') }));
  top.append(refCell, diffCell, nums);
  sheet.append(top);
  await pixelViews(data, mapUrl, normalUrl);
  if (tex) {
    const row = el('div', 'row');
    for (const [title, c] of [['贴图（每个颜色一层，0.5 灰 = 原色）', tex.color], ['法线图', tex.normal]] as const) {
      const cell = el('div', 'cell');
      const big = cropTo(c, [0, 0, c.width, c.height], Math.min(c.width * 2, 1240));
      cell.append(Object.assign(el('b'), { textContent: title }), big);
      row.append(cell);
    }
    sheet.append(row);
  }
  lap('出图');
  // 模型页的缩略图：参考图和同机位对比并排，小 JPEG（原图几百 KB，不进构建）
  const th = Object.assign(document.createElement('canvas'), { height: 240 });
  const cw = Math.round((240 * (crop[2] - crop[0])) / (crop[3] - crop[1]));
  th.width = cw * 2 + 6;
  const tg = th.getContext('2d')!;
  tg.fillStyle = '#1c1b20';
  tg.fillRect(0, 0, th.width, th.height);
  tg.drawImage(img.el, crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1], 0, 0, cw, 240);
  tg.drawImage(cmp.diff, crop[0], crop[1], crop[2] - crop[0], crop[3] - crop[1], cw + 6, 0, cw, 240);
  (window as unknown as { result: unknown }).result = {
    json,
    thumb: th.toDataURL('image/jpeg', 0.85),
    diff: cmp.diff.toDataURL('image/png'),
    map: mapUrl,
    normal: data.tex?.normal ? normalUrl : undefined,
    iou: cmp.iou,
    sameColor: cmp.sameColor,
    perClass: cmp.perClass,
    stats,
    warnings,
    timing,
  };
}

main().catch((e) => {
  console.error(e);
  (window as unknown as { result: unknown }).result = { error: String(e?.message ?? e) };
});
