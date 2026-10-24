// 画一张「出图工具应该给出」的参考图：正交侧面、车头朝右、纯色背景、平涂两色阶、无投影、无透视。
// 本机没有 ComfyUI 时用它代替出图那一步。用仓库自带的 Chrome 驱动在 canvas 上画，不加依赖。
//   node examples/motorcycle/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

const code = `(() => {
  const W = 1400, H = 900;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#d7d7d7';            // 纯色浅灰背景
  g.fillRect(0, 0, W, H);

  // 五种材质，各两个色阶（亮面 / 暗面）。色相拉开：classify 比的是 Lab，明暗只算三分之一
  const M = {
    tire:  ['#2a2b33', '#1b1c22'],    // 偏冷的黑
    metal: ['#a9afb7', '#848a93'],    // 中灰
    body:  ['#b23a2c', '#8b2b20'],    // 红
    seat:  ['#4d3b2c', '#362a1f'],    // 棕
    lamp:  ['#e9c94c', '#c2a436'],    // 黄
  };
  // 画一块：填亮色，再把下 40% 压成暗色（平涂的两色阶 cel shading）
  const draw = (make, mat, bb) => {
    const [base, dark] = M[mat];
    g.save();
    g.beginPath();
    make();
    g.fillStyle = base;
    g.fill('evenodd');
    g.clip('evenodd');
    g.fillStyle = dark;
    g.fillRect(bb[0] - 4, bb[1] + (bb[3] - bb[1]) * 0.6, bb[2] - bb[0] + 8, (bb[3] - bb[1]) * 0.45);
    g.restore();
  };
  const tube = (x0, y0, x1, y1, r) => {              // 两点之间一根圆头管子
    const a = Math.atan2(y1 - y0, x1 - x0);
    g.moveTo(x0 + r * Math.cos(a - Math.PI / 2), y0 + r * Math.sin(a - Math.PI / 2));
    g.arc(x0, y0, r, a - Math.PI / 2, a + Math.PI / 2, true);
    g.arc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2, true);
    g.closePath();
  };
  const bbT = (x0, y0, x1, y1, r) => [Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r];

  const RW = [360, 600], FW = [1030, 600], TR = 160, RIM = 112;   // 后轮、前轮中心，胎外半径、轮辐半径

  // 车架下管（从发动机斜上到转向柱）
  draw(() => tube(612, 487, 940, 404, 13), 'metal', bbT(612, 487, 940, 404, 13));
  // 发动机
  draw(() => { g.moveTo(596, 468); g.lineTo(806, 468); g.lineTo(806, 700); g.lineTo(640, 700); g.lineTo(596, 600); g.closePath(); }, 'metal', [596, 468, 806, 700]);
  // 前叉 + 车把（正侧面看车把是朝观察者伸的，只看到一个端头）
  draw(() => tube(1030, 600, 952, 330, 14), 'metal', bbT(1030, 600, 952, 330, 14));
  draw(() => g.arc(962, 306, 16, 0, 7), 'metal', [946, 290, 978, 322]);
  // 轮辐（圆盘，画在轮胎下面：半径多给 6 像素，不然中间透出背景会被当成洞）和轮胎（一圈）
  for (const [cx, cy] of [RW, FW]) {
    draw(() => g.arc(cx, cy, RIM + 6, 0, 7), 'metal', [cx - RIM, cy - RIM, cx + RIM, cy + RIM]);
    draw(() => { g.arc(cx, cy, TR, 0, 7); g.moveTo(cx + RIM, cy); g.arc(cx, cy, RIM, 0, 7, true); }, 'tire', [cx - TR, cy - TR, cx + TR, cy + TR]);
  }
  // 挡泥板（盖在轮胎外面）
  const fender = (cx, cy, a0, a1) => draw(() => {
    g.arc(cx, cy, TR + 26, a0, a1);
    g.arc(cx, cy, TR + 2, a1, a0, true);
    g.closePath();
  }, 'body', [cx - TR - 26, cy - TR - 26, cx + TR + 26, cy + TR + 26]);
  fender(RW[0], RW[1], Math.PI * 1.0, Math.PI * 1.45);
  fender(FW[0], FW[1], Math.PI * 1.06, Math.PI * 1.94);
  // 油箱
  draw(() => {
    g.moveTo(588, 466); g.bezierCurveTo(588, 396, 640, 372, 724, 376);
    g.bezierCurveTo(800, 380, 836, 404, 836, 440); g.lineTo(820, 470); g.closePath();
  }, 'body', [588, 372, 836, 470]);
  // 座垫（含后翘的尾座）
  draw(() => {
    g.moveTo(336, 430); g.bezierCurveTo(330, 408, 352, 400, 392, 402);
    g.lineTo(584, 420); g.lineTo(580, 470); g.lineTo(368, 468); g.closePath();
  }, 'seat', [330, 400, 584, 470]);
  // 大灯（装在前叉前面）
  draw(() => g.arc(1002, 362, 48, 0, 7), 'lamp', [954, 314, 1050, 410]);
  return c.toDataURL('image/png');
})()`;

const browser = await launch();
try {
  const page = await browser.newPage({ width: 1400, height: 900 });
  await page.goto('about:blank');
  const url = await page.evaluate(code);
  const out = new URL('./reference.png', import.meta.url).pathname;
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('写了 ' + out);
  await page.close();
} finally {
  await browser.close();
}
