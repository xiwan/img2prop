// node --test runtime/（Node 自带的测试，直接跑 .ts）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildProp, type PropData, type PropPart } from './prop.ts';

/** 有向体积：面都朝外时是正的 */
function volume(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

const one = (part: PropPart, frame: PropData['frame'] = 'front'): THREE.Mesh => {
  const m = buildProp({ id: 't', frame, colors: { a: '#ffffff' }, parts: [part] });
  return m.model.children[0] as THREE.Mesh;
};

describe('道具部件的网格', () => {
  const s: [number, number, number, number, number][] = [[0, 10, 5, 0, 4], [30, 12, 6, 0, 5], [60, 10, 4, 0, 3]];
  const cases: [string, PropPart][] = [
    ['放样 u', { id: 'a', c: 'a', k: 'loft', axis: 'u', s }],
    ['放样 v', { id: 'a', c: 'a', k: 'loft', axis: 'v', s }],
    ['放样 w', { id: 'a', c: 'a', k: 'loft', axis: 'w', s }],
    ['放样 n=4', { id: 'a', c: 'a', k: 'loft', axis: 'u', s, n: 4 }],
    ['带孔的放样', { id: 'a', c: 'a', k: 'loft', axis: 'u', s: [[0, 0, 10, 0, 10], [80, 0, 10, 0, 10]], hole: [5, 10] }],
    ['板', { id: 'a', c: 'a', k: 'plate', pts: [[0, 0], [40, 0], [40, 20], [0, 20]], w: 3, t: 4 }],
    ['方块', { id: 'a', c: 'a', k: 'box', at: [1, 2, 3], size: [10, 20, 30], rot: 30 }],
    ['环', { id: 'a', c: 'a', k: 'ring', at: [0, 0, 0], r: [20, 15], tube: 3 }],
    ['球', { id: 'a', c: 'a', k: 'ball', at: [0, 0, 0], r: [5, 6, 7] }],
  ];
  for (const [name, part] of cases) {
    it(`${name}：面朝外`, () => {
      assert.ok(volume(one(part).geometry) > 0);
      // 侧放（铳）、平放（键盘）只是转了一下，体积不变
      for (const f of ['side', 'top'] as const) assert.ok(Math.abs(volume(one(part, f).geometry) - volume(one(part).geometry)) < 1e-12, f);
    });
  }

  it('带孔的放样比实心的体积小（孔是挖进去的）', () => {
    const solid = volume(one({ id: 'a', c: 'a', k: 'loft', axis: 'u', s: [[0, 0, 10, 0, 10], [80, 0, 10, 0, 10]] }).geometry);
    const bored = volume(one(cases[4][1]).geometry);
    assert.ok(bored < solid);
    assert.ok(bored > solid * 0.9);
  });

  it('同颜色合成一个网格，要动的部件、拆开看时单独', () => {
    const data: PropData = {
      id: 't', frame: 'side', colors: { a: '#ff0000', b: 'metal' },
      parts: [
        { id: 'p1', c: 'a', k: 'box', at: [0, 0, 0], size: [1, 1, 1] },
        { id: 'p2', c: 'a', k: 'box', at: [5, 0, 0], size: [1, 1, 1] },
        { id: 'p3', c: 'b', k: 'box', at: [0, 5, 0], size: [1, 1, 1], own: true },
      ],
      sockets: { muzzle: [10, 0, 0] },
    };
    const m = buildProp(data, { metal: 0x123456 });
    assert.deepEqual(m.model.children.filter((o) => o instanceof THREE.Mesh).map((o) => o.name).sort(), ['a', 'p3']);
    // side：图右（u）是 +Z
    assert.ok(Math.abs(m.sockets.muzzle.position.z - 0.01) < 1e-9);
    assert.deepEqual(buildProp(data, { split: true }).parts.map((p) => p.id), ['p1', 'p2', 'p3']);
  });

  it('top：图右 +X，图上是远处（−Z），朝看图的人是上（+Y）', () => {
    const m = buildProp({
      id: 't', frame: 'top', colors: { a: '#ffffff' }, parts: [],
      sockets: { right: [10, 0, 0], far: [0, 10, 0], up: [0, 0, 10] },
    });
    const at = (n: string) => m.sockets[n].position.toArray().map((v) => Math.round(v * 1000));
    assert.deepEqual(at('right'), [10, 0, 0]);
    assert.deepEqual(at('far'), [0, 0, -10]);
    assert.deepEqual(at('up'), [0, 10, 0]);
  });
});

describe('拆开', () => {
  const box = (id: string, at: [number, number, number], size: [number, number, number], extra: Partial<PropPart> = {}): PropPart =>
    ({ id, c: 'a', k: 'box', at, size, ...extra }) as PropPart;
  const dirs = (data: Omit<PropData, 'id' | 'colors'>) =>
    Object.fromEntries(buildProp({ id: 't', colors: { a: '#ffffff' }, ...data }, { split: true }).parts.map((p) => [p.id, p.dir]));
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  // 手机：机身跨过中间那个面；背板、模组、镜头一层层叠在 +w，屏幕在 −w
  const phone: PropPart[] = [
    box('body', [0, 0, 0], [70, 146, 8]),
    box('back', [0, 0, 4.5], [68, 144, 1]),
    box('module', [-15, 50, 5.6], [36, 36, 1.2]),
    box('lens', [-15, 50, 7], [14, 14, 1.6]),
    box('screen', [0, 0, -4.5], [68, 144, 1]),
    box('button', [36, 20, 0], [2, 20, 3]),
  ];

  it('front：叠着的沿 w（模型 +Z）一层层往外，越外层挪得越远，不在图平面里乱跑', () => {
    const d = dirs({ frame: 'front', parts: phone });
    assert.ok(d.screen.z < 0);
    assert.ok(0 < d.back.z && d.back.z < d.module.z && d.module.z < d.lens.z);
    for (const id of ['back', 'module', 'lens', 'screen']) assert.ok(near(d[id].x, 0) && near(d[id].y, 0), id);
    // 本体那层（跨过中间的）在图平面里从中心往外：侧键往右，不沿 w
    assert.ok(d.button.x > 0 && near(d.button.z, 0));
  });

  it('side：贴在侧面的沿 w 往外（模型 −X），和 front 一样按图平面算', () => {
    const d = dirs({ frame: 'side', parts: phone });
    assert.ok(d.back.x < 0 && near(d.back.z, 0));
    assert.ok(d.lens.x < d.module.x && d.module.x < d.back.x);
    // 图右（u）是 +Z：侧键往 +Z
    assert.ok(d.button.z > 0 && near(d.button.x, 0));
  });

  it('同一 group 的一起动（切开的几段还是一个零件）', () => {
    const d = dirs({ frame: 'side', parts: [
      box('rear', [-50, 0, 0], [100, 40, 30], { group: 'upper' }),
      box('front', [50, 0, 0], [100, 40, 30], { group: 'upper' }),
      box('sole', [0, -30, 0], [200, 20, 34]),
    ] });
    assert.ok(d.rear.equals(d.front));
    assert.ok(d.sole.y < d.rear.y);
  });

  it('on：先跟着装的部件走，再按 explode 挪一步；none 只跟着走', () => {
    const d = dirs({ frame: 'front', parts: [
      box('base', [0, 0, 0], [100, 100, 10]),
      box('plate', [0, 0, 6], [80, 80, 2]),
      box('knob', [0, 0, 8], [10, 10, 2], { on: 'plate', explode: '-v' }),
      box('pin', [20, 0, 8], [4, 4, 2], { on: 'plate', explode: 'none' }),
    ] });
    const step = 0.1 * 0.1; // 长边 100 毫米的十分之一
    assert.ok(near(d.knob.x, d.plate.x) && near(d.knob.z, d.plate.z) && near(d.knob.y, d.plate.y - step));
    assert.ok(d.pin.equals(d.plate));
  });

  it('on 绕成圈不会卡死', () => {
    const d = dirs({ frame: 'front', parts: [
      box('a', [0, 0, 5], [10, 10, 2], { on: 'b' }),
      box('b', [0, 0, 8], [10, 10, 2], { on: 'a' }),
    ] });
    assert.ok(Number.isFinite(d.a.z) && Number.isFinite(d.b.z));
  });
});

describe('开合', () => {
  const box = (id: string, at: [number, number, number], size: [number, number, number], extra: Partial<PropPart> = {}): PropPart =>
    ({ id, c: 'a', k: 'box', at, size, ...extra }) as PropPart;
  // 竖着的一根（v 从 0 到 100 毫米），绕底端转
  const stick = (extra: Partial<PropPart> = {}) => box('stick', [0, 50, 0], [10, 100, 10], extra);
  const centers = (m: ReturnType<typeof buildProp>) => {
    m.group.updateMatrixWorld(true);
    return Object.fromEntries(m.parts.map((p) => [p.id, new THREE.Box3().setFromObject(p.mesh).getCenter(new THREE.Vector3()).multiplyScalar(1000)]));
  };
  // 顶点存的是 Float32：比到千分之一毫米
  const near = (v: THREE.Vector3, x: number, y: number, z: number) => v.distanceTo(new THREE.Vector3(x, y, z)) < 1e-3;

  it('绕 w 转 90°：看图的人看来逆时针；pose(0, 0) 回到原处', () => {
    const m = buildProp({ id: 't', frame: 'front', colors: { a: '#fff' }, parts: [stick({ open: { pivot: [0, 0, 0], deg: 90 } })] }, { split: true });
    m.pose(0, 1);
    assert.ok(near(centers(m).stick, -50, 0, 0));
    m.pose(0, 0);
    assert.ok(near(centers(m).stick, 0, 50, 0));
  });

  it('side：同一个 open 转到模型里也对（图右 = +Z）', () => {
    const m = buildProp({ id: 't', frame: 'side', colors: { a: '#fff' }, parts: [stick({ open: { pivot: [0, 0, 0], deg: 90 } })] }, { split: true });
    m.pose(0, 1);
    assert.ok(near(centers(m).stick, 0, 0, -50));
  });

  it('装在上面的（on）跟着转；同组（group）一起转', () => {
    const m = buildProp({ id: 't', frame: 'front', colors: { a: '#fff' }, parts: [
      stick({ open: { pivot: [0, 0, 0], deg: 90 } }),
      box('knob', [0, 105, 0], [10, 10, 10], { on: 'stick' }),
      box('a', [20, 0, 0], [10, 10, 10], { group: 'g', open: { pivot: [0, 0, 0], deg: 90 } }),
      box('b', [40, 0, 0], [10, 10, 10], { group: 'g' }),
    ] }, { split: true });
    m.pose(0, 1);
    const c = centers(m);
    assert.ok(near(c.knob, -105, 0, 0));
    assert.ok(near(c.a, 0, 20, 0) && near(c.b, 0, 40, 0));
  });

  it('几步接着来：转轴跟着前面几步走；按动作名只动选的', () => {
    const m = buildProp({ id: 't', frame: 'front', colors: { a: '#fff' }, parts: [
      stick({ open: [{ move: [100, 0, 0] }, { pivot: [0, 0, 0], deg: 90 }] }),
      box('lid', [0, 0, 0], [10, 10, 10], { open: { name: 'lid', move: [0, 0, 30] } }),
    ] }, { split: true });
    assert.deepEqual(m.actions, ['open', 'lid']);
    m.pose(0, 0.5);
    let c = centers(m);
    // 第一步走完，第二步还没开始；lid 那个动作 0.5（慢起慢停，正好一半）
    assert.ok(near(c.stick, 100, 50, 0) && near(c.lid, 0, 0, 15));
    m.pose(0, { open: 1 });
    c = centers(m);
    // 转轴在挪过去以后的底端（100, 0）
    assert.ok(near(c.stick, 50, 0, 0) && near(c.lid, 0, 0, 0));
  });

  it('拆开和开合一起：先开合再整个挪开；要动的不 split 也单独一个网格', () => {
    const data: PropData = { id: 't', frame: 'front', colors: { a: '#fff' }, parts: [
      box('base', [0, 0, 0], [100, 20, 100]),
      box('lid', [0, 20, 0], [100, 20, 100], { open: { pivot: [0, 10, -50], axis: 'u', deg: -90 }, explode: '+v' }),
      box('latch', [0, 20, 52], [10, 10, 4], { on: 'lid', explode: 'none' }),
    ] };
    const m = buildProp(data);
    assert.deepEqual(m.parts.map((p) => p.id), ['lid', 'latch']);
    m.pose(1, 1);
    const c = centers(m);
    const up = m.parts[0].dir.y * 1000;
    // 盖子绕后边往后翻 90°，竖起来；锁扣跟着到上面；再一起往上挪拆开的那一步
    assert.ok(near(c.lid, 0, 10 + 50 + up, -50 - 10));
    assert.ok(near(c.latch, 0, 10 + 102 + up, -50 - 10));
  });
});
