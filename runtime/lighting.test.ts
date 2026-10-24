// node --test runtime/*.test.ts：灯的设置（render/lighting.ts）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIGHTS, PRESETS, normalizeLights, spherical } from '../render/lighting.ts';

describe('灯', () => {
  it('默认的三盏灯和以前写死的位置一样（主光 (−3, 6, 4)，轮廓光 (2.5, 2.2, −2.5)）', () => {
    const k = DEFAULT_LIGHTS.key, r = DEFAULT_LIGHTS.rim;
    const kp = spherical(k.azimuth, k.elevation, k.distance), rp = spherical(r.azimuth, r.elevation, r.distance);
    for (const [a, b] of [[kp.toArray(), [-3, 6, 4]], [rp.toArray(), [2.5, 2.2, -2.5]]]) {
      a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${a} vs ${b}`));
    }
  });

  it('方位 0° = 正前方（+Z），90° = 右边（+X），高度 90° = 头顶', () => {
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    assert.ok(near(spherical(0, 0, 1).toArray(), [0, 0, 1]));
    assert.ok(near(spherical(90, 0, 1).toArray(), [1, 0, 0]));
    assert.ok(near(spherical(0, 90, 1).toArray(), [0, 1, 0]));
  });

  it('读坏了的、旧的设置：类型不对的字段用默认，点光补齐', () => {
    const s = normalizeLights({ key: { intensity: 'x', azimuth: 10 }, rim: null, points: [{ color: '#ff0000', at: [1, 2] }, 3] });
    assert.equal(s.key.intensity, DEFAULT_LIGHTS.key.intensity);
    assert.equal(s.key.azimuth, 10);
    assert.deepEqual(s.rim, DEFAULT_LIGHTS.rim);
    assert.equal(s.points.length, 1);
    assert.equal(s.points[0].color, '#ff0000');
    assert.deepEqual(s.points[0].at, [0, 1, 1]);
    assert.equal(normalizeLights(null).ambient.intensity, DEFAULT_LIGHTS.ambient.intensity);
  });

  it('预设都是完整的设置（normalize 以后不变）', () => {
    for (const [name, p] of Object.entries(PRESETS)) assert.deepEqual(normalizeLights(structuredClone(p)), p, name);
  });
});
