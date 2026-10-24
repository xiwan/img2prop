// 一件道具的详情页：/viewer/item.html?id=<id>。
// 左边像素风预览（拖动转、滚轮缩放、点物体选部件）；右边两页：信息（概况、颜色、开合、插座、部件表）、光照（环境光、主光、轮廓光、点光、画面）。
// 光照存在本机（viewer/look.ts）：这件自己一份，或者存成所有物品的默认；能导出 JSON 拿到游戏里用（render/lighting.ts 的 LightRig）。
import * as THREE from 'three';
import { buildProp, type PropData, type PropModel, type PropPart } from '../runtime/prop.ts';
import { PreviewStage } from '../render/PreviewStage.ts';
import { PRESETS, cloneLights, type LightSettings, type PointSpec } from '../render/lighting.ts';
import { applyLook, clearLook, defaultLook, loadLook, normalizeLook, saveLook } from './look.ts';

const BLOCK = 3;
const GAME_VIEW = 7.5, GAME_ROWS = 270;
const VIEWS: Record<string, { label: string; pitch: number; game?: boolean }> = {
  three: { label: '斜侧', pitch: 22 },
  high: { label: '斜上', pitch: 40 },
  top: { label: '游戏视角（俯 60°）', pitch: 60 },
  game: { label: '游戏里的大小', pitch: 60, game: true },
};
const KIND: Record<string, string> = { loft: '放样', plate: '板', box: '方块', ring: '环', ball: '球' };
const FRAME: Record<string, string> = { side: '正侧面（图右 = 模型 +Z）', front: '正面（图右 = +X）', top: '俯视，平放（图上 = 远处）' };

// ---------- 小工具：DOM（文字一律 textContent，数据是文件里读的，不当 HTML 拼） ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const { cls, ...rest } = props;
  const e = Object.assign(document.createElement(tag), rest);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number, d = 2) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));
const cm = (m: number) => `${fmt(m * 100, 1)} cm`;

// ---------- 读这一件 ----------
const id = new URL(location.href).searchParams.get('id') ?? '';
const list: { id: string; data: string; map: string | null }[] = await (await fetch('/__examples')).json();
const entry = list.find((e) => e.id === id);
if (!entry) {
  $('title').textContent = `没有这件：${id}`;
  throw new Error(`没有这件：${id}`);
}
const data: PropData = await (await fetch(entry.data)).json();
// /examples/<文件夹>/out/<id>.json → /examples/<文件夹>
const dir = entry.data.replace(/\/out\/[^/]+$/, '');
document.title = `${data.id} · img2prop`;
$('title').textContent = data.id;

// ---------- 预览 ----------
const stageEl = $('stage');
const picked = $('picked');
let { look, from } = loadLook(data.id);
let dirty = false;
const stage = new PreviewStage(stageEl, {}, 'felt', look.lights);
stage.autoSpin = 0;
const YAW = data.frame === 'front' ? 0.5 : data.frame === 'top' ? 0.35 : 2.2;
stage.turntable.rotation.y = YAW;
const viewSel = $<HTMLSelectElement>('view');
for (const [k, v] of Object.entries(VIEWS)) viewSel.append(new Option(v.label, k));
const texBox = $<HTMLInputElement>('tex');
const apart = $<HTMLInputElement>('apart');
const spin = $<HTMLInputElement>('spin');
let model!: PropModel;
let zoom = 1;
const open: Record<string, number> = {};
/** 物体大小（米，合上时最长的一边）：点光的范围、位置滑块按它定 */
let R = 1;

function pose(): void {
  model.pose(Number(apart.value), open);
}
function build(): void {
  model = buildProp(data, { split: true, map: texBox.checked && entry!.map ? entry!.map : undefined });
  stage.setContent(model.group);
  stage.place(model.group);
  applyLook(stage, look, model.sockets);
  pose();
  select(selected);
}
function frameView(): void {
  const v = VIEWS[viewSel.value];
  const s = stage.settings;
  s.pitchDeg = v.pitch;
  const rows = stageEl.clientHeight / BLOCK;
  s.baseHeight = rows;
  // 按合上和开满（没拆开、没转）的样子量：开合拉满也不出框
  const yaw = stage.turntable.rotation.y;
  stage.turntable.rotation.y = 0;
  const all = new THREE.Box3();
  for (const o of [0, 1]) {
    model.pose(0, o);
    stage.turntable.updateMatrixWorld(true);
    all.union(new THREE.Box3().setFromObject(model.group));
  }
  pose();
  stage.turntable.rotation.y = yaw;
  const size = all.getSize(new THREE.Vector3());
  if (v.game) s.viewHeight = (rows * GAME_VIEW) / GAME_ROWS;
  else {
    const aspect = stageEl.clientWidth / stageEl.clientHeight;
    const r = Math.max(...[all.min.x, all.max.x].flatMap((x) => [all.min.z, all.max.z].map((z) => Math.hypot(x, z))));
    s.viewHeight = Math.max((2 * r * 1.1) / aspect, size.y * 1.5) / zoom;
  }
  stage.pixel.target.set(0, (all.min.y + all.max.y) / 2, 0);
  stage.pixel.resize();
}

// ---------- 点物体选部件（拖动不算点） ----------
let selected: string | null = null;
const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
function select(pid: string | null): void {
  for (const [mesh, mat] of originals) mesh.material = mat;
  originals.clear();
  selected = pid;
  const part = model?.parts.find((p) => p.id === pid);
  if (part) {
    const mat = (part.mesh.material as THREE.MeshToonMaterial).clone();
    mat.emissive.set(0x6a4a10);
    originals.set(part.mesh, part.mesh.material);
    part.mesh.material = mat;
  }
  picked.textContent = pid ? `选中：${pid}` : '';
  for (const tr of document.querySelectorAll<HTMLTableRowElement>('tr.p')) tr.classList.toggle('sel', tr.dataset.id === pid);
  showPart(pid);
}
const canvas = stage.pixel.renderer.domElement;
let down: [number, number] | null = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(stage.pixel.clientToNdc(e.clientX, e.clientY), stage.pixel.camera);
  const hit = ray.intersectObjects(model.parts.map((p) => p.mesh), false)[0];
  select(hit ? hit.object.name : null);
  const row = document.querySelector(`tr.p.sel`);
  row?.scrollIntoView({ block: 'nearest' });
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = THREE.MathUtils.clamp(zoom * Math.exp(-e.deltaY * 0.0015), 0.3, 10);
  frameView();
}, { passive: false });
canvas.addEventListener('dblclick', () => { zoom = 1; stage.turntable.rotation.y = YAW; frameView(); });

// ---------- 顶上：开合每个动作一个滑块 ----------
const actionsEl = $('actions');
for (const a of buildProp(data).actions) {
  open[a] = 0;
  const r = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
  r.oninput = () => { open[a] = Number(r.value); pose(); };
  actionsEl.append(el('label', {}, `开合 ${a}`, r));
}

// ---------- 信息页 ----------
const info = $('info');
const partDetail = el('div', { cls: 'detail' });
function showPart(pid: string | null): void {
  const p = data.parts.find((q) => q.id === pid);
  const mesh = model?.parts.find((q) => q.id === pid)?.mesh;
  if (!p || !mesh) { partDetail.textContent = '点物体或者下面表里的一行，看这个部件'; return; }
  const b = mesh.geometry.boundingBox ?? new THREE.Box3().setFromObject(mesh);
  const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const lines = [
    `${p.id}  ·  ${KIND[p.k] ?? p.k}${p.k === 'loft' ? `（${p.s.length} 站，沿 ${p.axis}）` : ''}  ·  颜色 ${p.c}`,
    `大小  ${cm(s.x)} × ${cm(s.y)} × ${cm(s.z)}（模型的 x、y、z）`,
    `中心  ${cm(c.x)}, ${cm(c.y)}, ${cm(c.z)}`,
    ...flags(p).map((f) => `· ${f}`),
  ];
  for (const m of ([] as NonNullable<PropPart['open']>[]).concat(p.open ?? []).flat()) {
    const what = [m.deg ? `转 ${m.deg}°（轴 ${Array.isArray(m.axis) ? m.axis.map((v) => fmt(v, 1)).join(',') : (m.axis ?? 'w')}）` : '', m.move ? `挪 [${m.move.map((v) => fmt(v, 0)).join(', ')}] mm` : ''].filter(Boolean).join('、');
    lines.push(`· 开合 ${m.name ?? 'open'}：${what}${m.span ? `，${m.span[0]}–${m.span[1]}` : ''}`);
  }
  partDetail.textContent = lines.join('\n');
}
function flags(p: PropPart): string[] {
  return [
    p.own ? '单独一个网格（要动的）' : '',
    p.paint ? '贴参考图原色' : '',
    p.group ? `组 ${p.group}` : '',
    p.on ? `装在 ${p.on} 上` : '',
    p.explode ? `拆开 ${Array.isArray(p.explode) ? p.explode.map((v) => fmt(v, 0)).join(',') : p.explode}` : '',
  ].filter(Boolean);
}

async function renderInfo(): Promise<void> {
  const merged = buildProp(data);
  const meshes = merged.model.children.filter((o) => o instanceof THREE.Mesh).length;
  let tris = 0;
  merged.model.traverse((o) => { if (o instanceof THREE.Mesh) tris += o.geometry.getAttribute('position').count / 3; });
  merged.model.scale.set(1, 1, 1);
  merged.group.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(merged.group).getSize(new THREE.Vector3());
  R = Math.max(0.3, size.x, size.y, size.z);

  const ref = el('img', { cls: 'ref', src: `${dir}/reference.png`, alt: '参考图' });
  const kv = el('table', { cls: 'kv' });
  const row = (k: string, v: string | Node) => kv.append(el('tr', {}, el('td', {}, k), el('td', {}, v)));
  row('参考图', FRAME[data.frame] ?? data.frame);
  row('大小', `${cm(size.x)} × ${cm(size.y)} × ${cm(size.z)}（宽 × 高 × 深）`);
  if (data.scale) row('游戏里放大', data.scale.join(' × '));
  row('部件', `${data.parts.length} 个 → 合并成 ${meshes} 个网格`);
  row('三角形', `${tris}`);
  row('模型数据', `${(JSON.stringify(data).length / 1024).toFixed(1)} KB`);
  const texCell = el('span', {}, data.tex ? `每个颜色一层：${data.tex.layers.join('、')}` : '没有');
  row('贴图', texCell);
  if (entry!.map) {
    fetch(entry!.map).then((r) => r.blob()).then(async (b) => {
      const bmp = await createImageBitmap(b);
      texCell.textContent = `${bmp.width} × ${bmp.height}，${(b.size / 1024).toFixed(1)} KB（${data.tex?.layers.join('、')}）`;
    }).catch(() => {});
  }
  const links = el('div', { cls: 'btns' },
    el('a', { href: `${dir}/out/review.png`, target: '_blank', textContent: '审图 review.png' }),
    el('a', { href: `${dir}/out/diff.png`, target: '_blank', textContent: '同机位对比 diff.png' }),
    el('a', { href: entry!.data, target: '_blank', textContent: `模型数据 ${data.id}.json` }));

  // 颜色
  const colors = el('table', { cls: 'kv' });
  for (const [name, hex] of Object.entries(data.colors)) {
    const n = data.parts.filter((p) => p.c === name).length;
    const sw = el('span', { cls: 'sw' });
    sw.style.background = hex === 'metal' ? '#2e3036' : hex;
    colors.append(el('tr', {}, el('td', {}, sw, name), el('td', {}, `${hex === 'metal' ? 'metal（运行时传进来的颜色）' : hex} · ${n} 个部件`)));
  }

  // 开合
  const acts = el('div');
  const actions = merged.actions;
  if (!actions.length) acts.append(el('div', { cls: 'note', textContent: '部件表里没写 open（见 SKILL.md「开合」）' }));
  for (const a of actions) {
    const who = data.parts.filter((p) => ([] as NonNullable<PropPart['open']>[]).concat(p.open ?? []).flat().some((m) => (m.name ?? 'open') === a)).map((p) => p.id);
    acts.append(el('div', {}, el('b', { textContent: a }), `：${who.join('、')}（连同装在它们上面的、同组的）`));
  }

  // 插座：可以挂一盏点光
  const socks = el('table', { cls: 'kv' });
  const sockets = Object.entries(data.sockets ?? {});
  if (!sockets.length) socks.append(el('tr', {}, el('td', { textContent: '没有' })));
  for (const [name, at] of sockets) {
    const add = el('button', { textContent: '挂一盏灯' });
    add.onclick = () => { addPoint(name); showTab('light'); };
    socks.append(el('tr', {}, el('td', { textContent: name }), el('td', {}, `${at.map((v) => fmt(v / 10, 1)).join(', ')} cm（图平面 u, v, w） `, add)));
  }

  // 部件表
  const parts = el('table', { cls: 'parts' }, el('tr', {}, ...['部件', '形状', '颜色', ''].map((t) => el('th', { textContent: t }))));
  for (const p of data.parts) {
    const sw = el('span', { cls: 'sw' });
    const hex = data.colors[p.c];
    sw.style.background = hex === 'metal' ? '#2e3036' : (hex ?? '#000');
    const f = [p.own ? '单独' : '', p.paint ? '原色' : '', p.group ? `组:${p.group}` : '', p.on ? `装:${p.on}` : '', p.open ? '动' : ''].filter(Boolean).join(' ');
    const tr = el('tr', { cls: 'p' }, el('td', { textContent: p.id }), el('td', { textContent: KIND[p.k] ?? p.k }), el('td', {}, sw, p.c), el('td', { textContent: f }));
    tr.dataset.id = p.id;
    tr.onclick = () => select(selected === p.id ? null : p.id);
    parts.append(tr);
  }

  info.replaceChildren(
    ref, links,
    el('div', { cls: 'sec', textContent: '概况' }), kv,
    el('div', { cls: 'sec', textContent: '颜色' }), colors,
    el('div', { cls: 'sec', textContent: '开合' }), acts,
    el('div', { cls: 'sec', textContent: '插座' }), socks,
    el('div', { cls: 'sec', textContent: '选中的部件' }), partDetail,
    el('div', { cls: 'sec', textContent: `部件（${data.parts.length}）` }), el('div', { cls: 'parts-wrap' }, parts),
  );
  showPart(selected);
}

// ---------- 光照页 ----------
const light = $('light');
const jsonBox = el('textarea', { spellcheck: false });
const status = el('div', { cls: 'note' });
const FROM = { item: '这件自己存的', all: '所有物品的默认', default: '内置默认' } as const;
function changed(rebuildPanel = false): void {
  dirty = true;
  applyLook(stage, look, model.sockets);
  if (rebuildPanel) renderLight();
  else refreshStatus();
}
function refreshStatus(): void {
  status.textContent = `现在用的：${FROM[from]}${dirty ? '（改了，还没存）' : ''}`;
  jsonBox.value = JSON.stringify(look, null, 2);
}

/** 一行滑块：label、取值、设值、范围、步长、显示格式 */
function slider(label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, show = (v: number) => fmt(v)): HTMLElement {
  const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) });
  const val = el('span', { cls: 'val', textContent: show(get()) });
  r.oninput = () => { set(Number(r.value)); val.textContent = show(Number(r.value)); changed(); };
  return el('div', { cls: 'row' }, el('span', { textContent: label }), r, val);
}
function color(label: string, get: () => string, set: (v: string) => void): HTMLElement {
  const c = el('input', { type: 'color', value: get() });
  const val = el('span', { cls: 'val', textContent: get() });
  c.oninput = () => { set(c.value); val.textContent = c.value; changed(); };
  return el('div', { cls: 'row' }, el('span', { textContent: label }), c, val);
}
function check(label: string, get: () => boolean, set: (v: boolean) => void, rebuild = false): HTMLElement {
  const c = el('input', { type: 'checkbox', checked: get() });
  c.onchange = () => { set(c.checked); changed(rebuild); };
  return el('label', { cls: 'btns' }, c, label);
}
const deg = (v: number) => `${v.toFixed(0)}°`;

/** 预设的点光是给一米来大的东西摆的：按这件的大小放缩位置、范围和强度 */
function scaledPreset(p: LightSettings): LightSettings {
  const s = cloneLights(p);
  const k = R / 1.5;
  for (const q of s.points) {
    q.at = [q.at[0] * k, q.at[1] * k, q.at[2] * k];
    q.range *= k;
    q.intensity *= k * k;
  }
  return s;
}
function addPoint(socket?: string): void {
  const n = look.lights.points.length + 1;
  let pid = `p${n}`;
  for (let i = n; look.lights.points.some((p) => p.id === pid); i++) pid = `p${i + 1}`;
  const p: PointSpec = socket
    ? { id: pid, color: '#ffc870', intensity: 1.5 * R * R, range: R, at: [0, 0, 0], socket }
    : { id: pid, color: '#ffd8a0', intensity: 8 * R * R, range: R * 3, at: [R * 0.6, R * 0.8, R * 0.6] };
  look.lights.points.push(p);
  changed(true);
}

function renderLight(): void {
  const L = look.lights, P = look.pixel;
  const presets = el('div', { cls: 'btns' });
  for (const name of Object.keys(PRESETS)) {
    const b = el('button', { textContent: name });
    b.onclick = () => { look.lights = scaledPreset(PRESETS[name]); changed(true); };
    presets.append(b);
  }
  const gizmo = check('显示灯的位置（小菱形 + 连到中心的线）', () => stage.lights.gizmos.visible, (v) => { stage.lights.gizmos.visible = v; });

  const points = el('div');
  const socketNames = Object.keys(data.sockets ?? {});
  for (const p of L.points) {
    const where = el('select');
    where.append(new Option('固定在场景里', ''));
    for (const s of socketNames) where.append(new Option(`挂在插座 ${s}（跟着动）`, s));
    if (p.socket && !socketNames.includes(p.socket)) where.append(new Option(`插座 ${p.socket}（这件没有，不亮）`, p.socket));
    where.value = p.socket ?? '';
    where.onchange = () => {
      if (where.value) { p.socket = where.value; p.at = [0, 0, 0]; } else { delete p.socket; p.at = [R * 0.6, R * 0.8, R * 0.6]; }
      changed(true);
    };
    const del = el('button', { textContent: '删' });
    del.onclick = () => { L.points = L.points.filter((q) => q !== p); changed(true); };
    const span = p.socket ? R * 0.5 : R * 2;
    points.append(el('div', { cls: 'point' },
      el('div', { cls: 'phead' }, el('b', { textContent: `点光 ${p.id}` }), where, del),
      color('颜色', () => p.color, (v) => { p.color = v; }),
      slider('强度', () => p.intensity, (v) => { p.intensity = v; }, 0, Math.max(50, p.intensity * 3), 0.1),
      slider('范围', () => p.range, (v) => { p.range = v; }, 0.05, Math.max(R * 6, p.range * 2), 0.01, (v) => `${fmt(v)} m`),
      slider(p.socket ? '偏 x' : 'x', () => p.at[0], (v) => { p.at[0] = v; }, -span, span, span / 200, (v) => `${fmt(v)} m`),
      slider(p.socket ? '偏 y' : '高 y', () => p.at[1], (v) => { p.at[1] = v; }, p.socket ? -span : 0, p.socket ? span : R * 2.5, span / 200, (v) => `${fmt(v)} m`),
      slider(p.socket ? '偏 z' : 'z', () => p.at[2], (v) => { p.at[2] = v; }, -span, span, span / 200, (v) => `${fmt(v)} m`),
    ));
  }
  const add = el('button', { textContent: '＋ 加一盏点光' });
  add.onclick = () => addPoint();

  const saveItem = el('button', { textContent: '存为这件的' });
  saveItem.onclick = () => { saveLook(look, data.id); from = 'item'; dirty = false; refreshStatus(); };
  const saveAll = el('button', { textContent: '存为所有物品的默认' });
  saveAll.onclick = () => { saveLook(look); clearLook(data.id); from = 'all'; dirty = false; refreshStatus(); };
  const reset = el('button', { textContent: '这件恢复' });
  reset.title = '删掉这件自己存的，用所有物品的默认（没有就用内置的）';
  reset.onclick = () => { clearLook(data.id); ({ look, from } = loadLook(data.id)); dirty = false; changed(true); dirty = false; refreshStatus(); };
  const factory = el('button', { textContent: '全部恢复内置' });
  factory.title = '删掉这件的和所有物品的默认';
  factory.onclick = () => { clearLook(data.id); clearLook(); look = defaultLook(); from = 'default'; changed(true); dirty = false; refreshStatus(); };
  const copy = el('button', { textContent: '复制 JSON' });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(jsonBox.value); copy.textContent = '复制好了'; }
    catch { jsonBox.select(); copy.textContent = '已选中，按 ⌘C'; }
    setTimeout(() => (copy.textContent = '复制 JSON'), 1500);
  };
  const load = el('button', { textContent: '用框里的 JSON' });
  load.onclick = () => {
    try { look = normalizeLook(JSON.parse(jsonBox.value)); changed(true); }
    catch (e) { status.textContent = `JSON 读不了：${(e as Error).message}`; }
  };

  light.replaceChildren(
    el('div', { cls: 'sec', textContent: '预设' }), presets, gizmo,
    el('div', { cls: 'sec', textContent: '环境光（天空 / 地面两个颜色）' }),
    color('天空', () => L.ambient.sky, (v) => { L.ambient.sky = v; }),
    color('地面', () => L.ambient.ground, (v) => { L.ambient.ground = v; }),
    slider('强度', () => L.ambient.intensity, (v) => { L.ambient.intensity = v; }, 0, 3, 0.01),
    el('div', { cls: 'sec', textContent: '主光（平行光，投影子）' }),
    color('颜色', () => L.key.color, (v) => { L.key.color = v; }),
    slider('强度', () => L.key.intensity, (v) => { L.key.intensity = v; }, 0, 8, 0.01),
    slider('方位', () => L.key.azimuth, (v) => { L.key.azimuth = v; }, 0, 360, 1, deg),
    slider('高度', () => L.key.elevation, (v) => { L.key.elevation = v; }, 2, 90, 1, deg),
    check('投影子', () => L.key.shadow, (v) => { L.key.shadow = v; }),
    el('div', { cls: 'sec', textContent: '轮廓光（点光，从后面描一圈亮边）' }),
    check('开', () => L.rim.on, (v) => { L.rim.on = v; }),
    color('颜色', () => L.rim.color, (v) => { L.rim.color = v; }),
    slider('强度', () => L.rim.intensity, (v) => { L.rim.intensity = v; }, 0, 40, 0.1),
    slider('方位', () => L.rim.azimuth, (v) => { L.rim.azimuth = v; }, 0, 360, 1, deg),
    slider('高度', () => L.rim.elevation, (v) => { L.rim.elevation = v; }, -10, 90, 1, deg),
    slider('距离', () => L.rim.distance, (v) => { L.rim.distance = v; }, 0.3, 12, 0.01, (v) => `${fmt(v)} m`),
    slider('范围', () => L.rim.range, (v) => { L.rim.range = v; }, 0.5, 30, 0.1, (v) => `${fmt(v)} m`),
    el('div', { cls: 'sec', textContent: `点光（${L.points.length}）` }), points, el('div', { cls: 'btns' }, add,
      el('span', { cls: 'note', textContent: socketNames.length ? `也可以在「信息」页的插座上挂（${socketNames.join('、')}）` : '' })),
    el('div', { cls: 'sec', textContent: '画面' }),
    slider('曝光', () => P.exposure, (v) => { P.exposure = v; }, 0.2, 3, 0.01),
    check('描边', () => P.outline, (v) => { P.outline = v; }),
    slider('描边深浅', () => P.outlineDarken, (v) => { P.outlineDarken = v; }, 0, 1, 0.01),
    slider('折边提亮', () => P.highlight, (v) => { P.highlight = v; }, 0, 1, 0.01),
    slider('色阶', () => P.posterize, (v) => { P.posterize = v; }, 0, 16, 1, (v) => (v < 2 ? '关' : `${v} 阶`)),
    check('色阶抖动', () => P.dither, (v) => { P.dither = v; }),
    color('台面', () => look.floor, (v) => { look.floor = v; }),
    el('div', { cls: 'sec', textContent: '存 / 导出' }), status,
    el('div', { cls: 'btns' }, saveItem, saveAll, reset, factory),
    el('div', { cls: 'note', textContent: '存在这台电脑的浏览器里（localStorage）。例子页也按这个显示：这件自己存的优先，没有就用所有物品的默认。' }),
    el('div', { cls: 'btns' }, copy, load),
    jsonBox,
    el('div', { cls: 'note', textContent: '游戏里：new LightRig(scene).apply(json.lights, model.sockets)（render/lighting.ts，只依赖 three）' }),
  );
  refreshStatus();
}

function showTab(t: 'info' | 'light'): void {
  $('info').hidden = t !== 'info';
  $('light').hidden = t !== 'light';
  $('tabInfo').classList.toggle('on', t === 'info');
  $('tabLight').classList.toggle('on', t === 'light');
  // 进光照页自动显示灯的位置，离开就收起
  stage.lights.gizmos.visible = t === 'light';
  if (t === 'light') renderLight();
}
$('tabInfo').onclick = () => showTab('info');
$('tabLight').onclick = () => showTab('light');

// ---------- 开始 ----------
build();
await renderInfo();
renderLight();
frameView();
viewSel.onchange = frameView;
texBox.onchange = () => { build(); frameView(); };
apart.oninput = pose;
new ResizeObserver(() => frameView()).observe(stageEl);
if (new URL(location.href).searchParams.get('tab') === 'light') showTab('light');

let last = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (spin.checked) stage.turntable.rotation.y += 0.4 * dt;
  stage.render(dt);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
(window as unknown as { ready: boolean }).ready = true;
