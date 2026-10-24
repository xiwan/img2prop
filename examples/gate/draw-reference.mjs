// 画一张参考图：中式朱漆大门，正面。无透视、无投影、纯色背景。
// 两扇朱红门扇（深一圈的门边），每扇 7 行 × 5 列铜门钉（铺首周围空出四颗）；青铜铺首衔环；
// 深色门框、门楣上四个铜门簪、门头上一块匾（金字「平安」）、顶上一道瓦檐（两头微翘）；门槛、石台阶。
// 800 像素 = 4 米。
//   node examples/gate/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

const code = `(() => {
  const W = 1400, H = 900;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#7d9bb5';
  g.fillRect(0, 0, W, H);

  const RED = { base: '#b0301f', hl: '#c8452f', dark: '#8a2418', edge: '#962819', low: '#a02a1b' };
  const FR = { base: '#5a2418', hl: '#6e3020', dark: '#42190f' };
  const BR = { base: '#c9a24a', hl: '#f0d48a', dark: '#8a6a26' };
  const BZ = { base: '#5d7a5e', hl: '#7f9f7c', dark: '#3e5541' };
  const TILE = { base: '#3e4848', hl: '#57625f', dark: '#2c3434' };
  const ST = { base: '#8f8c86', hl: '#aaa79f', dark: '#6f6c67' };
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const disc = (x, y, r, col) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
  // 一块木头：底色、上沿高光、下沿暗边
  const beam = (x, y, w, h, m) => { rect(x, y, w, h, m.base); rect(x, y, w, 4, m.hl); rect(x, y + h - 5, w, 5, m.dark); };

  // 石台阶
  rect(300, 820, 800, 40, ST.base); rect(300, 820, 800, 5, ST.hl); rect(300, 852, 800, 8, ST.dark);
  for (const x of [500, 700, 900]) rect(x, 820, 2, 40, ST.dark);
  // 门框（抱框）、门槛
  beam(380, 200, 60, 620, FR); rect(380, 200, 5, 620, FR.hl); rect(435, 200, 5, 620, FR.dark);
  beam(960, 200, 60, 620, FR); rect(960, 200, 5, 620, FR.hl); rect(1015, 200, 5, 620, FR.dark);
  beam(440, 770, 520, 50, FR);

  // 门扇：门边深一圈，下面四分之一稍暗，中间一道门缝
  for (const x0 of [440, 700]) {
    rect(x0, 240, 260, 530, RED.base);
    rect(x0, 640, 260, 130, RED.low);
    g.strokeStyle = RED.edge; g.lineWidth = 8; g.strokeRect(x0 + 4, 244, 252, 522);
    rect(x0 + 8, 248, 244, 3, RED.hl);
  }
  rect(699, 240, 2, 530, RED.dark);
  // 门钉：铺首、门环挡住的四颗不钉
  const stud = (x, y) => { disc(x, y, 9, BR.dark); disc(x - 1, y - 1, 8, BR.base); disc(x - 3, y - 3, 3, BR.hl); };
  for (const y of [290, 360, 430, 500, 570, 640, 710]) {
    for (const x of [470, 520, 570, 620, 670]) if (!(x === 670 && (y === 500 || y === 570))) stud(x, y);
    for (const x of [730, 780, 830, 880, 930]) if (!(x === 730 && (y === 500 || y === 570))) stud(x, y);
  }
  // 铺首衔环（青铜）：先画环，铺首压住环的上头
  for (const x of [668, 732]) {
    g.beginPath(); g.arc(x, 552, 22.5, 0, Math.PI * 2); g.lineWidth = 7; g.strokeStyle = BZ.base; g.stroke();
    g.beginPath(); g.arc(x, 552, 22.5, Math.PI * 1.1, Math.PI * 1.6); g.lineWidth = 3; g.strokeStyle = BZ.hl; g.stroke();
    disc(x, 492, 30, BZ.base);
    g.beginPath(); g.arc(x, 492, 23, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = BZ.dark; g.stroke();
    g.beginPath(); g.arc(x, 492, 28, Math.PI * 1.05, Math.PI * 1.55); g.lineWidth = 3; g.strokeStyle = BZ.hl; g.stroke();
    disc(x - 9, 486, 4, BZ.dark); disc(x + 9, 486, 4, BZ.dark);
    rect(x - 12, 476, 9, 3, BZ.hl); rect(x + 3, 476, 9, 3, BZ.hl);
    rect(x - 10, 501, 20, 6, BZ.dark);
  }

  // 门楣、门簪
  beam(360, 170, 680, 70, FR);
  for (const x of [520, 630, 770, 880]) {
    disc(x, 205, 18, BR.dark); disc(x - 1, 204, 16, BR.base);
    g.beginPath(); g.arc(x - 1, 204, 10, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = BR.dark; g.stroke();
    disc(x - 5, 199, 3, BR.hl);
  }
  // 门头、匾
  beam(360, 60, 680, 110, FR);
  rect(540, 78, 320, 74, '#1f2b3c'); rect(546, 84, 308, 6, '#2c3b50');
  g.strokeStyle = BR.base; g.lineWidth = 6; g.strokeRect(543, 81, 314, 68);
  g.fillStyle = BR.base; g.font = '900 50px "PingFang SC", "Heiti SC", "Songti SC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('平安', 700, 116);
  // 瓦檐：两头微微上翘，竖着一道道瓦垄
  g.save();
  g.beginPath();
  g.moveTo(330, 54); g.quadraticCurveTo(334, 62, 360, 62); g.lineTo(1040, 62); g.quadraticCurveTo(1066, 62, 1070, 54);
  g.lineTo(1060, 36); g.lineTo(340, 36); g.closePath();
  g.fillStyle = TILE.base; g.fill(); g.clip();
  for (let x = 336; x < 1070; x += 18) rect(x, 36, 5, 26, TILE.hl);
  rect(320, 36, 760, 5, TILE.dark); rect(320, 56, 760, 6, TILE.dark);
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
