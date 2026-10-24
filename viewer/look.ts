// 例子页、详情页共用的「样子」：一套灯（render/lighting.ts）+ 像素画面的几个参数 + 台面颜色。
// 存在本机（localStorage）：每件自己一份（img2prop:look:<id>），加一份所有物品的默认（img2prop:look）。
import type * as THREE from 'three';
import { DEFAULT_LIGHTS, cloneLights, normalizeLights, type LightSettings } from '../render/lighting.ts';
import type { PreviewStage } from '../render/PreviewStage.ts';

export interface PixelLook { exposure: number; outline: boolean; outlineDarken: number; highlight: number; posterize: number; dither: boolean }
export interface Look { lights: LightSettings; pixel: PixelLook; floor: string }

export const DEFAULT_PIXEL: PixelLook = { exposure: 1.2, outline: true, outlineDarken: 0.3, highlight: 0.3, posterize: 0, dither: true };
export const DEFAULT_FLOOR = '#34323c';
export const defaultLook = (): Look => ({ lights: cloneLights(DEFAULT_LIGHTS), pixel: { ...DEFAULT_PIXEL }, floor: DEFAULT_FLOOR });

/** 存的、导入的可能是旧版本或者手改坏了的：只认类型对的字段，缺的用默认 */
export function normalizeLook(raw: unknown): Look {
  const d = defaultLook();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const px = (r.pixel && typeof r.pixel === 'object' ? r.pixel : {}) as Record<string, unknown>;
  const pixel = { ...d.pixel } as Record<string, unknown>;
  for (const [k, v] of Object.entries(d.pixel)) {
    const nv = px[k];
    if (typeof nv === typeof v && (typeof nv !== 'number' || Number.isFinite(nv))) pixel[k] = nv;
  }
  const floor = typeof r.floor === 'string' && /^#[0-9a-f]{6}$/i.test(r.floor) ? r.floor : d.floor;
  return { lights: normalizeLights(r.lights), pixel: pixel as unknown as PixelLook, floor };
}

const KEY = 'img2prop:look';
const keyOf = (id?: string) => (id ? `${KEY}:${id}` : KEY);
function read(k: string): unknown {
  try {
    const s = localStorage.getItem(k);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** 这件自己存的 → 所有物品的默认 → 内置默认 */
export function loadLook(id?: string): { look: Look; from: 'item' | 'all' | 'default' } {
  const own = id ? read(keyOf(id)) : null;
  if (own) return { look: normalizeLook(own), from: 'item' };
  const all = read(KEY);
  if (all) return { look: normalizeLook(all), from: 'all' };
  return { look: defaultLook(), from: 'default' };
}

/** id 不给 = 存成所有物品的默认 */
export function saveLook(look: Look, id?: string): void {
  try { localStorage.setItem(keyOf(id), JSON.stringify(look)); } catch { /* 本机存不了（隐私模式）：这次有效，下次没了 */ }
}
export function clearLook(id?: string): void {
  try { localStorage.removeItem(keyOf(id)); } catch { /* 同上 */ }
}

export function applyLook(stage: PreviewStage, look: Look, sockets?: Record<string, THREE.Object3D>): void {
  stage.lights.apply(look.lights, sockets);
  Object.assign(stage.settings, look.pixel);
  stage.floor.material.color.set(look.floor);
}
