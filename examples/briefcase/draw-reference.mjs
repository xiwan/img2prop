// 画一张参考图：铝合金密码手提箱，平放在桌上，看的是正面那条窄边（提手、密码锁、合缝都在这一面）。无透视、无投影、纯色背景。
// 拉丝铝面板（横纹）、镀铬包边（上沿、下沿、合缝两条、两头）、黑色包角带铆钉、两个镀铬搭扣锁带三位密码轮、
// 黑色提手和镀铬提手座、底下黑色橡胶脚。不画品牌。46 × 11 厘米的箱子 ≈ 1000 × 240 像素。
//   node examples/briefcase/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

const code = `(() => {
  const W = 1400, H = 900;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#3f6f73';
  g.fillRect(0, 0, W, H);

  const ALU = { base: '#b9bec4', hl: '#d7dbe0', dark: '#9aa0a8' };
  const CHR = { base: '#e4e7ea', hl: '#f7f8f9', dark: '#8d939b', hasp: '#f2f4f6' };
  const BLK = { base: '#2a2b30', hl: '#4a4c53', dark: '#1b1c20' };
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

  // 橡胶脚（先画，箱子压住上半）
  for (const x of [260, 1140]) { g.beginPath(); g.ellipse(x, 604, 14, 8, 0, 0, Math.PI * 2); g.fillStyle = BLK.base; g.fill(); }

  // 面板：拉丝铝，每 10 像素一道亮纹一道暗纹
  for (const [y0, y1] of [[372, 470], [490, 588]]) {
    rect(200, y0, 1000, y1 - y0, ALU.base);
    for (let y = y0 + 4; y < y1 - 2; y += 10) { rect(200, y, 1000, 2, ALU.hl); rect(200, y + 2, 1000, 2, ALU.dark); }
  }
  // 镀铬包边：每条上面一道高光、下面一道暗边
  const rim = (y, h) => { rect(200, y, 1000, h, CHR.base); rect(200, y, 1000, 2, CHR.hl); rect(200, y + h - 2, 1000, 2, CHR.dark); };
  rim(360, 12); rim(470, 9); rim(481, 9); rim(588, 12);
  rect(200, 479, 1000, 2, BLK.dark);                       // 合缝
  for (const x of [200, 1192]) { rect(x, 360, 8, 240, CHR.base); rect(x, 360, 2, 240, CHR.hl); }

  // 包角：外角圆，上面一道高光，一颗铆钉
  const corner = (x, y, r) => {
    g.save(); g.beginPath(); g.roundRect(x, y, 54, 54, r); g.fillStyle = BLK.base; g.fill(); g.clip();
    rect(x, y, 54, 4, BLK.hl); rect(x, y + 46, 54, 8, BLK.dark);
    g.restore();
    g.beginPath(); g.arc(x + 27, y + 27, 5, 0, Math.PI * 2); g.fillStyle = CHR.base; g.fill();
  };
  corner(200, 360, [12, 4, 4, 4]); corner(1146, 360, [4, 12, 4, 4]); corner(200, 546, [4, 4, 4, 12]); corner(1146, 546, [4, 4, 12, 4]);

  // 搭扣锁：镀铬底板，上半是压在箱盖上的搭扣（更亮），下半一个黑窗口里三个密码轮
  for (const x of [300, 1040]) {
    g.beginPath(); g.roundRect(x, 452, 60, 60, 5); g.fillStyle = CHR.base; g.fill();
    g.beginPath(); g.roundRect(x + 6, 455, 48, 24, 4); g.fillStyle = CHR.hasp; g.fill();
    rect(x, 508, 60, 4, CHR.dark);
    rect(x + 7, 486, 46, 18, BLK.base);
    g.fillStyle = '#f0f0f0'; g.font = 'bold 12px monospace'; g.textBaseline = 'top';
    ['0', '0', '7'].forEach((d, i) => g.fillText(d, x + 11 + i * 15, 489));
    for (const i of [1, 2]) rect(x + 7 + i * 15, 486, 1, 18, BLK.hl);
  }

  // 提手：镀铬座，黑色握把（上面一道高光、下面暗）
  for (const x of [588, 786]) { g.beginPath(); g.roundRect(x, 486, 26, 34, 4); g.fillStyle = CHR.base; g.fill(); rect(x, 486, 26, 2, CHR.hl); }
  g.save(); g.beginPath(); g.roundRect(596, 498, 208, 34, 16); g.fillStyle = BLK.base; g.fill(); g.clip();
  rect(596, 500, 208, 5, BLK.hl); rect(596, 522, 208, 10, BLK.dark);
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
