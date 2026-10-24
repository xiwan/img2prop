// 画一张参考图：高帮篮球鞋，正侧面、鞋头朝右、平涂两色阶、无投影、无透视。
// 红白黑配色分块（白底、红鞋头、红后跟、红鞋眼片、红脚踝片、黑领口），鞋上不画任何标志。
// 白鞋不用浅灰背景：白色的暗面会和背景混在一起被抠掉，背景用偏蓝的中灰。
//   node examples/sneaker/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

const code = `(() => {
  const W = 1400, H = 900;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#a3acb6';
  g.fillRect(0, 0, W, H);

  const M = {
    white: ['#f4f2ec', '#d4d0c6'],
    red:   ['#c8232c', '#9c1b22'],
    black: ['#2a2a30', '#1a1a1e'],
  };
  // 一块：亮色填满，下 40% 压成暗色
  const draw = (make, mat, bb) => {
    const [base, dark] = M[mat];
    g.save();
    g.beginPath();
    make();
    g.fillStyle = base;
    g.fill();
    g.clip();
    g.fillStyle = dark;
    g.fillRect(bb[0] - 4, bb[1] + (bb[3] - bb[1]) * 0.6, bb[2] - bb[0] + 8, (bb[3] - bb[1]) * 0.45);
    g.restore();
  };
  const tube = (x0, y0, x1, y1, r) => {
    const a = Math.atan2(y1 - y0, x1 - x0);
    g.moveTo(x0 + r * Math.cos(a - Math.PI / 2), y0 + r * Math.sin(a - Math.PI / 2));
    g.arc(x0, y0, r, a - Math.PI / 2, a + Math.PI / 2, true);
    g.arc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2, true);
    g.closePath();
  };

  // 鞋面外形（侧影）：后跟 → 领口 → 鞋舌 → 鞋带线 → 鞋头
  const upper = () => {
    g.moveTo(240, 691);
    g.bezierCurveTo(226, 600, 232, 420, 262, 312);
    g.bezierCurveTo(300, 296, 380, 318, 440, 332);
    g.bezierCurveTo(456, 300, 480, 268, 522, 262);
    g.lineTo(566, 272);
    g.lineTo(884, 522);
    g.bezierCurveTo(990, 588, 1120, 600, 1178, 668);
    g.lineTo(1182, 691);
    g.closePath();
  };
  draw(upper, 'white', [226, 262, 1182, 691]);

  // 拼块都裁在鞋面外形里：侧影只由鞋面决定，不会多出边
  g.save();
  g.beginPath();
  upper();
  g.clip();
  // 红后跟
  draw(() => { g.moveTo(200, 700); g.lineTo(200, 470); g.bezierCurveTo(300, 470, 380, 520, 420, 560); g.bezierCurveTo(440, 600, 440, 650, 436, 700); g.closePath(); }, 'red', [226, 470, 440, 691]);
  // 红脚踝片（鞋舌前面留白）
  draw(() => { g.moveTo(200, 250); g.lineTo(446, 250); g.lineTo(446, 336); g.bezierCurveTo(470, 380, 470, 420, 440, 446); g.bezierCurveTo(360, 456, 280, 446, 200, 436); g.closePath(); }, 'red', [226, 300, 470, 456]);
  // 黑领口
  draw(() => { g.moveTo(200, 250); g.lineTo(450, 250); g.lineTo(450, 345); g.bezierCurveTo(380, 342, 300, 330, 200, 345); g.closePath(); }, 'black', [226, 300, 450, 345]);
  // 红鞋眼片：沿鞋带线往里 55 像素的一条
  draw(() => { g.moveTo(546, 256); g.lineTo(900, 534); g.lineTo(866, 577); g.lineTo(512, 299); g.closePath(); }, 'red', [512, 256, 900, 577]);
  // 红鞋头
  draw(() => { g.moveTo(1200, 700); g.lineTo(880, 700); g.bezierCurveTo(890, 640, 920, 590, 980, 560); g.lineTo(1200, 560); g.closePath(); }, 'red', [880, 560, 1182, 691]);
  // 白鞋带：横过鞋眼片
  const A = [566, 272], B = [884, 522], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const d = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n = [-d[1], d[0]];
  for (let i = 0; i < 6; i++) {
    const t = 0.12 + i * 0.15;
    const P = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const x0 = P[0] + n[0] * 6 - d[0] * 12, y0 = P[1] + n[1] * 6 - d[1] * 12;
    const x1 = P[0] + n[0] * 42 + d[0] * 12, y1 = P[1] + n[1] * 42 + d[1] * 12;
    draw(() => tube(x0, y0, x1, y1, 7), 'white', [Math.min(x0, x1) - 7, Math.min(y0, y1) - 7, Math.max(x0, x1) + 7, Math.max(y0, y1) + 7]);
  }
  g.restore();

  // 鞋底：白中底，红大底（鞋头往上包一点）
  const sole = () => {
    g.moveTo(236, 689);
    g.lineTo(1186, 689);
    g.bezierCurveTo(1196, 700, 1194, 722, 1180, 736);
    g.bezierCurveTo(1150, 756, 1100, 760, 1060, 760);
    g.lineTo(262, 760);
    g.bezierCurveTo(244, 760, 234, 748, 234, 730);
    g.closePath();
  };
  draw(sole, 'white', [234, 689, 1196, 760]);
  g.save();
  g.beginPath();
  sole();
  g.clip();
  draw(() => { g.moveTo(200, 738); g.lineTo(1040, 738); g.bezierCurveTo(1110, 738, 1160, 728, 1200, 706); g.lineTo(1200, 800); g.lineTo(200, 800); g.closePath(); }, 'red', [234, 706, 1196, 760]);
  g.restore();
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
