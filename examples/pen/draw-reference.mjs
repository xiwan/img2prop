// 画一张参考图：钢笔，正侧面、笔尖朝右，笔帽插在笔尾（写字时的样子），笔尖正面朝看图的人。
// 墨绿色大理石纹树脂笔杆和笔帽、金色笔夹 / 帽箍 / 腰环、黑色握位、金银双色笔尖（通气孔、笔缝）。
// 圆的东西画三层明暗：底色、上面一条高光、下面一片暗面；树脂上画大理石纹。不画品牌。
// 赭红色背景：笔上的金、银、绿、黑和它都离得远（浅灰背景会和银色笔尖的暗面混在一起被抠掉）。
//   node examples/pen/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

const code = `(() => {
  const W = 1400, H = 900, AX = 450;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#b9796a';
  g.fillRect(0, 0, W, H);

  const M = {
    resin: { base: '#1f4a3a', hl: '#5f9a80', dark: '#12302a', vein: ['#2f6a52', '#173a2d'] },
    gold:  { base: '#c9a24a', hl: '#e8cd7a', dark: '#8f6e2a' },
    black: { base: '#1b1c20', hl: '#3a3c42', dark: '#111216' },
  };
  // 回转体的侧影：r(x) 折线插值，按 1 像素一站描上边、下边
  const lerp = (pts, x) => {
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
      const [x0, r0] = pts[i - 1], [x1, r1] = pts[i];
      return r0 + (r1 - r0) * ((x - x0) / (x1 - x0 || 1));
    }
    return pts[pts.length - 1][1];
  };
  // 两条边之间的一条带子：f0、f1 = 从轴往外几成半径（−1 = 上沿，1 = 下沿）
  const band = (pts, f0, f1) => {
    const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    g.beginPath();
    for (let x = x0; x <= x1; x++) g.lineTo(x, AX + f0 * lerp(pts, x));
    for (let x = x1; x >= x0; x--) g.lineTo(x, AX + f1 * lerp(pts, x));
    g.closePath();
  };
  // 种子固定的随机数（大理石纹每次一样）
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const turned = (pts, m) => {
    const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    g.save();
    band(pts, -1, 1); g.fillStyle = m.base; g.fill(); g.clip();
    if (m.vein) {
      // 大理石纹：顺着笔杆方向的弯曲细条
      for (let i = 0; i < (x1 - x0) / 9; i++) {
        const sx = x0 + rand() * (x1 - x0), sy = AX + (rand() * 2 - 1) * 55, len = 40 + rand() * 120;
        g.beginPath();
        g.moveTo(sx, sy);
        g.bezierCurveTo(sx + len * 0.3, sy + (rand() - 0.5) * 30, sx + len * 0.7, sy + (rand() - 0.5) * 30, sx + len, sy + (rand() - 0.5) * 20);
        g.strokeStyle = m.vein[i % 2];
        g.lineWidth = 2 + rand() * 4;
        g.stroke();
      }
    }
    band(pts, 0.45, 1.05); g.fillStyle = m.dark; g.fill();
    band(pts, -0.72, -0.5); g.fillStyle = m.hl; g.fill();
    g.restore();
  };

  // 笔帽（插在笔尾）：圆顶 + 微微变粗的帽身
  const cap = [];
  for (let x = 140; x <= 175; x++) cap.push([x, 52 * Math.sqrt(Math.max(0, 1 - ((175 - x) / 35) ** 2))]);
  cap.push([300, 55], [518, 56]);
  turned(cap, M.resin);
  // 帽箍
  turned([[518, 57], [520, 58], [560, 58], [562, 57]], M.gold);
  // 笔夹：顶上的夹座、夹身、圆头，压在帽身前面
  g.save();
  g.beginPath();
  g.roundRect(178, AX - 16, 40, 32, 6);
  g.rect(214, AX - 8, 248, 16);
  g.moveTo(478, AX); g.arc(466, AX, 12, 0, Math.PI * 2);
  g.fillStyle = M.gold.base; g.fill(); g.clip();
  g.fillStyle = M.gold.dark; g.fillRect(170, AX + 3, 320, 20);
  g.fillStyle = M.gold.hl; g.fillRect(170, AX - 6, 320, 3);
  g.restore();
  // 笔杆（往笔尖那头微微变细）、腰环
  turned([[562, 50], [892, 47]], M.resin);
  turned([[892, 49], [908, 49]], M.gold);

  // 笔尖：先画，握位的口沿压在它根上
  const nib = () => {
    g.beginPath();
    g.moveTo(1020, AX - 34); g.lineTo(1080, AX - 35);
    g.quadraticCurveTo(1195, AX - 30, 1255, AX);
    g.quadraticCurveTo(1195, AX + 30, 1080, AX + 35);
    g.lineTo(1020, AX + 34);
    g.closePath();
  };
  g.save();
  nib(); g.fillStyle = M.gold.base; g.fill(); g.clip();
  g.fillStyle = M.gold.dark; g.fillRect(1000, AX + 14, 300, 40);
  g.fillStyle = M.gold.hl; g.fillRect(1000, AX - 30, 300, 5);
  // 中间的银色心形（铑金镀层）
  g.beginPath();
  g.moveTo(1062, AX);
  g.bezierCurveTo(1062, AX - 30, 1110, AX - 26, 1205, AX);
  g.bezierCurveTo(1110, AX + 26, 1062, AX + 30, 1062, AX);
  g.fillStyle = '#c8ccd2'; g.fill();
  g.save(); g.clip();
  g.fillStyle = '#9aa0a8'; g.fillRect(1000, AX + 8, 300, 40);
  g.fillStyle = '#e6e9ee'; g.fillRect(1000, AX - 18, 300, 4);
  g.restore();
  // 通气孔、笔缝
  g.beginPath(); g.arc(1112, AX, 6, 0, Math.PI * 2); g.fillStyle = M.black.base; g.fill();
  g.fillRect(1116, AX - 1, 140, 2);
  g.restore();

  // 握位：中间微微内凹，前端一圈口沿
  turned([[908, 45], [960, 41], [1000, 39.5], [1022, 41.5], [1032, 41.5], [1040, 37]], M.black);
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
