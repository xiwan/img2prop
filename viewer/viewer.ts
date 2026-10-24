// 看 examples/*/out/ 里生成好的模型：像素风（和审图一样的管线）、拆开、开合、贴图开关、游戏里的大小。npm run dev → /viewer/
import * as THREE from 'three';
import { buildProp, type PropData, type PropModel } from '../runtime/prop.ts';
import { PreviewStage } from '../render/PreviewStage.ts';
import { applyLook, loadLook } from './look.ts';

/** 清单由 scripts/serve.mjs 的 /__examples 给：每件的模型数据和贴图地址 */
const list: { id: string; data: string; map: string | null }[] = await (await fetch('/__examples')).json();
const DATA = await Promise.all(list.map(async (e) => ({ ...e, json: (await (await fetch(e.data)).json()) as PropData })));

/** 像素块多大（页面像素） */
const BLOCK = 3;
/** 俯视像素游戏的镜头：画面 7.5 米高、270 行 */
const GAME_VIEW = 7.5;
const GAME_ROWS = 270;
const VIEWS: Record<string, { label: string; pitch: number; game?: boolean }> = {
  three: { label: '斜侧', pitch: 22 },
  top: { label: '游戏视角（俯 60°）', pitch: 60 },
  game: { label: '游戏里的大小', pitch: 60, game: true },
};

const grid = document.getElementById('grid')!;
const viewSel = document.getElementById('view') as HTMLSelectElement;
const texBox = document.getElementById('tex') as HTMLInputElement;
const apart = document.getElementById('apart') as HTMLInputElement;
const openRange = document.getElementById('open') as HTMLInputElement;
const spin = document.getElementById('spin') as HTMLInputElement;
for (const [k, v] of Object.entries(VIEWS)) viewSel.append(new Option(v.label, k));

/** pick：这一件开合哪个动作（'*' = 全部，'' = 不动） */
interface Card { data: PropData; map: string | null; stage: PreviewStage; box: HTMLElement; model?: PropModel; yaw: number; pick: string }
const cards: Card[] = [];

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => { if (o instanceof THREE.Mesh) n += o.geometry.getAttribute('position').count / 3; });
  return n;
}

/** 按两个滑块和这一件选的动作摆姿势 */
function pose(c: Card): void {
  const t = Number(openRange.value);
  const open = c.pick === '*' ? t : c.pick ? { [c.pick]: t } : 0;
  c.model!.pose(Number(apart.value), open);
}

function build(c: Card): void {
  c.model = buildProp(c.data, { split: true, map: texBox.checked && c.map ? c.map : undefined });
  c.stage.setContent(c.model.group);
  c.stage.place(c.model.group);
  // 详情页调好存下的光照（这件自己的 → 所有物品的默认 → 内置）
  applyLook(c.stage, loadLook(c.data.id).look, c.model.sockets);
  pose(c);
}

function frame(c: Card): void {
  const v = VIEWS[viewSel.value];
  const s = c.stage.settings;
  s.pitchDeg = v.pitch;
  const rows = c.box.clientHeight / BLOCK;
  s.baseHeight = rows;
  // 按合上和开满（没拆开、没转）的样子量大小：开合拉满也不出框
  const yaw = c.stage.turntable.rotation.y;
  c.stage.turntable.rotation.y = 0;
  const all = new THREE.Box3();
  for (const o of [0, 1]) {
    c.model!.pose(0, o);
    c.stage.turntable.updateMatrixWorld(true);
    all.union(new THREE.Box3().setFromObject(c.model!.group));
  }
  const size = all.getSize(new THREE.Vector3());
  pose(c);
  c.stage.turntable.rotation.y = yaw;
  if (v.game) s.viewHeight = (rows * GAME_VIEW) / GAME_ROWS;
  else if (c.model!.actions.length) {
    // 有开合的：开满时会伸出去（箱盖倒在前面），按离转台中轴最远的那点框，转到哪个角度都不出框
    const aspect = c.box.clientWidth / c.box.clientHeight;
    const R = Math.max(...[all.min.x, all.max.x].flatMap((x) => [all.min.z, all.max.z].map((z) => Math.hypot(x, z))));
    s.viewHeight = Math.max((2 * R * 1.05) / aspect, size.y * 1.4);
    c.stage.pixel.target.set(0, (all.min.y + all.max.y) / 2, 0);
    c.stage.pixel.resize();
    return;
  } else {
    const aspect = c.box.clientWidth / c.box.clientHeight;
    s.viewHeight = Math.max((Math.max(size.x, size.y, size.z) * (v.pitch > 45 ? 1.25 : 1.05)) / aspect, size.y * 1.4);
  }
  c.stage.pixel.target.set(0, size.y * 0.5, 0);
  c.stage.pixel.resize();
}

const entries = DATA.sort((a, b) => a.id.localeCompare(b.id));
if (!entries.length) grid.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: '还没有生成的模型：先跑 npm run examples' }));
for (const { json: data, map } of entries) {
  const card = document.createElement('div');
  card.className = 'card';
  const game = buildProp(data);
  const meshes = game.model.children.filter((o) => o instanceof THREE.Mesh).length;
  // 用 textContent：数据是文件里读的，不当 HTML 拼
  const title = document.createElement('div');
  title.className = 'title';
  // 点名字、点画面（没拖动）都进详情页
  const href = `item.html?id=${encodeURIComponent(data.id)}`;
  const name = document.createElement('a');
  name.href = href;
  name.className = 'name';
  name.textContent = data.id;
  const info = document.createElement('span');
  info.textContent = `${data.parts.length} 个部件 · ${triangles(game.model)} 个三角形 · ${meshes} 个网格 · ${(JSON.stringify(data).length / 1024).toFixed(1)} KB`;
  title.append(name, info);
  card.append(title);
  const box = document.createElement('div');
  box.className = 'stage';
  card.append(box);
  grid.append(card);
  const stage = new PreviewStage(box, {}, 'felt');
  stage.autoSpin = 0;
  // 看参考图那一面，斜一点：铳是机头那面（−X），瓶罐是正面（+Z），平放的（top）从前面看顶面
  const c: Card = { data, map, stage, box, yaw: data.frame === 'front' ? 0.5 : data.frame === 'top' ? 0.35 : 2.2, pick: '*' };
  // 有开合的：标题上放一个选哪个动作的下拉框
  if (game.actions.length) {
    const sel = document.createElement('select');
    sel.className = 'pick';
    sel.title = '开合哪个动作';
    sel.append(new Option(`开合：全部（${game.actions.join('、')}）`, '*'));
    for (const a of game.actions) sel.append(new Option(`开合：${a}`, a));
    sel.append(new Option('开合：不动', ''));
    sel.onchange = () => { c.pick = sel.value; pose(c); };
    title.append(sel);
  }
  stage.turntable.rotation.y = c.yaw;
  // 在画面上按下、没怎么动就松开 = 点；拖动是转
  const canvas = stage.pixel.renderer.domElement;
  let down: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) location.href = href;
    down = null;
  });
  canvas.style.cursor = 'pointer';
  build(c);
  cards.push(c);
}
const reframe = () => cards.forEach(frame);
reframe();
viewSel.onchange = reframe;
texBox.onchange = () => { cards.forEach(build); reframe(); };
apart.oninput = () => cards.forEach((c) => pose(c));
openRange.oninput = () => cards.forEach((c) => pose(c));
window.addEventListener('resize', reframe);

let last = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const c of cards) {
    if (spin.checked) c.stage.turntable.rotation.y += 0.4 * dt;
    c.stage.render(dt);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
