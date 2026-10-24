import * as THREE from 'three';

/** 可复现的伪随机数，保证每次生成的纹理一样 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pixelTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shade(hex: number, k: number): string {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * k);
  return `#${c.getHexString()}`;
}

/** 木地板：128px 对应 4 米，约每米 32 像素，和画面像素密度接近 */
export function woodFloor(repeatX: number, repeatY: number, base = 0x4a3020, seed = 7): THREE.CanvasTexture {
  const size = 128;
  const plank = 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(seed);
  for (let y = 0; y < size; y += plank) {
    let x = -Math.floor(rnd() * 48);
    while (x < size) {
      const len = 32 + Math.floor(rnd() * 48);
      ctx.fillStyle = shade(base, 0.8 + rnd() * 0.4);
      ctx.fillRect(x, y, len, plank);
      // 木纹
      for (let i = 0; i < len / 6; i++) {
        ctx.fillStyle = shade(base, 0.7 + rnd() * 0.15);
        ctx.fillRect(x + Math.floor(rnd() * len), y + 1 + Math.floor(rnd() * (plank - 2)), 2 + Math.floor(rnd() * 4), 1);
      }
      ctx.fillStyle = shade(base, 0.45);
      ctx.fillRect(x, y, 1, plank);
      x += len;
    }
    ctx.fillStyle = shade(base, 0.4);
    ctx.fillRect(0, y, size, 1);
  }
  return pixelTexture(canvas, repeatX, repeatY);
}

/** 青砖地：方砖对缝铺，128px 对应 4 米，一块砖半米 */
export function brickFloor(repeatX: number, repeatY: number, base = 0x4a4e52, seed = 11): THREE.CanvasTexture {
  const size = 128;
  const tile = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(seed);
  for (let y = 0; y < size; y += tile) {
    for (let x = 0; x < size; x += tile) {
      ctx.fillStyle = shade(base, 0.85 + rnd() * 0.3);
      ctx.fillRect(x, y, tile, tile);
      // 磨损的斑点
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = shade(base, 0.72 + rnd() * 0.12);
        ctx.fillRect(x + 1 + Math.floor(rnd() * (tile - 3)), y + 1 + Math.floor(rnd() * (tile - 3)), 1 + Math.floor(rnd() * 2), 1);
      }
      ctx.fillStyle = shade(base, 1.18);
      ctx.fillRect(x + 1, y + 1, tile - 2, 1);
    }
  }
  ctx.fillStyle = shade(base, 0.5);
  for (let i = 0; i < size; i += tile) {
    ctx.fillRect(i, 0, 1, size);
    ctx.fillRect(0, i, size, 1);
  }
  return pixelTexture(canvas, repeatX, repeatY);
}

/** 毡毯：暗红底，回纹边，中间一朵团花，一张图铺满整块 */
export function carpet(wPx: number, hPx: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#5a1418';
  ctx.fillRect(0, 0, wPx, hPx);
  // 回纹边：一圈小「回」字
  ctx.fillStyle = '#2a0c0e';
  ctx.fillRect(2, 2, wPx - 4, 10);
  ctx.fillRect(2, hPx - 12, wPx - 4, 10);
  ctx.fillRect(2, 2, 10, hPx - 4);
  ctx.fillRect(wPx - 12, 2, 10, hPx - 4);
  ctx.fillStyle = '#b8892e';
  const fret = (x: number, y: number) => {
    ctx.fillRect(x, y, 6, 1);
    ctx.fillRect(x + 5, y, 1, 6);
    ctx.fillRect(x + 1, y + 5, 5, 1);
    ctx.fillRect(x + 1, y + 2, 1, 4);
    ctx.fillRect(x + 1, y + 2, 3, 1);
  };
  for (let x = 4; x < wPx - 10; x += 8) {
    fret(x, 4);
    fret(x, hPx - 10);
  }
  for (let y = 12; y < hPx - 18; y += 8) {
    fret(4, y);
    fret(wPx - 10, y);
  }
  // 团花
  const cx = wPx / 2;
  const cy = hPx / 2;
  const r = Math.min(wPx, hPx) * 0.22;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      const petal = r * (0.75 + 0.25 * Math.cos(Math.atan2(y, x) * 8));
      if (d > petal) continue;
      ctx.fillStyle = d < r * 0.3 ? '#d8a840' : d < r * 0.55 ? '#7a2a24' : (Math.floor(d) % 3 === 0 ? '#b8892e' : '#6a1c1e');
      ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    }
  }
  return pixelTexture(canvas, 1, 1);
}

/** 粉墙：白灰墙面，每两米一根木柱，底下一截木裙板。64px 对应 2 米宽、2.6 米高 */
export function plasterWall(repeatX: number, base = 0xc8bca8, seed = 3): THREE.CanvasTexture {
  const w = 64;
  const h = 84;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(seed);
  ctx.fillStyle = shade(base, 1);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = shade(base, 0.88 + rnd() * 0.1);
    ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 3), 1);
  }
  // 上头的枋、木柱
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(0, 0, w, 4);
  ctx.fillRect(0, 0, 5, h);
  ctx.fillStyle = '#4e3220';
  ctx.fillRect(1, 0, 2, h);
  // 木裙板
  ctx.fillStyle = '#2e1c12';
  ctx.fillRect(0, h - 28, w, 28);
  ctx.fillStyle = '#44291a';
  ctx.fillRect(0, h - 28, w, 2);
  ctx.fillStyle = '#22140c';
  for (let x = 8; x < w; x += 28) ctx.strokeRect(x + 0.5, h - 22.5, 22, 16);
  return pixelTexture(canvas, repeatX, 1);
}

/** 板壁：竖着拼的木板，用来做隔断 */
export function plankWall(repeatX: number, base = 0x4a3020, seed = 5): THREE.CanvasTexture {
  const w = 32;
  const h = 84;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(seed);
  for (let x = 0; x < w; x += 6) {
    ctx.fillStyle = shade(base, 0.8 + rnd() * 0.35);
    ctx.fillRect(x, 0, 6, h);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = shade(base, 0.68 + rnd() * 0.12);
      ctx.fillRect(x + 1 + Math.floor(rnd() * 4), Math.floor(rnd() * h), 1, 3 + Math.floor(rnd() * 6));
    }
    ctx.fillStyle = shade(base, 0.45);
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.fillStyle = shade(base, 0.4);
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, h - 10, w, 2);
  return pixelTexture(canvas, repeatX, 1);
}

/** 匾额：黑底金字，四周一圈金边 */
export function plaque(text: string, wPx = 128, hPx = 32): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#16100c';
  ctx.fillRect(0, 0, wPx, hPx);
  ctx.strokeStyle = '#b8892e';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, wPx - 4, hPx - 4);
  ctx.fillStyle = '#d8a840';
  ctx.font = `bold ${Math.floor(hPx * 0.62)}px "Songti SC", "STSong", "SimSun", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, wPx / 2, hPx / 2 + 1);
  const tex = pixelTexture(canvas, 1, 1);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
