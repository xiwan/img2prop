// 画一张参考图：复古皮手提箱，正面、立着放，提手在顶上。无透视、无投影、纯色背景。
// 干邑色皮箱身；深棕皮带两条（绕箱身一圈，所以在顶边、底边各探出来一点）带铜扣和扣眼；深棕包角带铜铆钉；
// 两个铜锁扣（带锁眼）；深棕提手、两个铜提环；右边提环上挂一张行李牌；底下两个铜脚钉。
// 箱身画四层明暗：底色、上沿高光、下沿和两侧暗边、下面四成稍暗。不画品牌。80 厘米 ≈ 880 像素的箱子按 56 厘米算。
//   node examples/suitcase/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

const code = `(() => {
  const W = 1400, H = 900;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#75879a';
  g.fillRect(0, 0, W, H);

  const M = {
    leather: { base: '#9a5a2e', hl: '#b8743f', dark: '#6f3f1f', low: '#8c5229' },
    strap:   { base: '#3f2a1e', hl: '#5a4131', dark: '#2b1c13' },
    brass:   { base: '#c39a3e', hl: '#e3c46e', dark: '#8a6a26' },
    paper:   { base: '#eee4c8', dark: '#d8ccab' },
  };
  const path = (f) => { g.beginPath(); f(); };
  // 一块：填底色，再在里面画几条带子（clip 住）
  const piece = (f, m, bands) => {
    g.save(); path(f); g.fillStyle = m.base; g.fill(); g.clip();
    for (const [x, y, w, h, col] of bands) { g.fillStyle = col; g.fillRect(x, y, w, h); }
    g.restore();
  };

  // 脚钉（先画，箱身压住上半）
  for (const x of [366, 1034]) piece(() => g.ellipse(x, 846, 16, 10, 0, 0, Math.PI * 2), M.brass,
    [[x - 20, 846, 40, 12, M.brass.dark], [x - 20, 840, 40, 3, M.brass.hl]]);
  // 提环（D 形铜环）：先画，提手压住上头、箱身压住下头
  for (const x of [616, 754]) {
    g.beginPath(); g.roundRect(x, 240, 30, 64, 12);
    g.lineWidth = 8; g.strokeStyle = M.brass.base; g.stroke();
    g.beginPath(); g.moveTo(x - 4, 270); g.lineTo(x - 4, 296); g.lineWidth = 3; g.strokeStyle = M.brass.hl; g.stroke();
  }

  // 箱身
  piece(() => g.roundRect(260, 300, 880, 540, 26), M.leather, [
    [250, 624, 900, 220, M.leather.low],
    [250, 300, 900, 12, M.leather.hl],
    [250, 826, 900, 16, M.leather.dark],
    [250, 300, 10 + 10, 540, M.leather.dark],
    [1130, 300, 12, 540, M.leather.dark],
  ]);

  // 两条皮带：绕箱身一圈，顶边、底边各探出 4 像素；左边一条亮边、右边一条暗边；扣子下面一排扣眼
  for (const x of [400, 946]) {
    piece(() => g.rect(x, 296, 54, 548), M.strap, [[x, 296, 4, 548, M.strap.hl], [x + 50, 296, 4, 548, M.strap.dark]]);
    for (const y of [478, 506, 534]) { g.beginPath(); g.arc(x + 27, y, 4, 0, Math.PI * 2); g.fillStyle = M.strap.dark; g.fill(); }
    // 铜扣：方框 + 扣针，框里看得到皮带
    g.beginPath(); g.roundRect(x - 9, 380, 72, 60, 6); g.roundRect(x + 1, 390, 52, 40, 3);
    g.fillStyle = M.brass.base; g.fill('evenodd');
    g.fillStyle = M.brass.hl; g.fillRect(x - 5, 380, 64, 3);
    g.fillStyle = M.brass.dark; g.fillRect(x - 5, 432, 64, 6);
    g.fillStyle = M.brass.base; g.fillRect(x + 24, 390, 6, 44);
  }

  // 包角：外角圆、里角小圆，比箱身探出 4 像素；三颗铜铆钉
  const corners = [[256, 296, [30, 8, 8, 8], [[270, 312], [300, 312], [270, 342]]], [1066, 296, [8, 30, 8, 8], [[1130, 312], [1100, 312], [1130, 342]]],
    [256, 766, [8, 8, 8, 30], [[270, 828], [300, 828], [270, 798]]], [1066, 766, [8, 8, 30, 8], [[1130, 828], [1100, 828], [1130, 798]]]];
  for (const [x, y, r, rivets] of corners) {
    piece(() => g.roundRect(x, y, 78, 78, r), M.strap, [[x, y + 50, 78, 28, M.strap.dark], [x, y, 78, 4, M.strap.hl]]);
    for (const [rx, ry] of rivets) { g.beginPath(); g.arc(rx, ry, 5, 0, Math.PI * 2); g.fillStyle = M.brass.base; g.fill(); }
  }

  // 锁扣：铜底板、上半是亮的搭扣、下面锁眼
  for (const x of [520, 834]) {
    piece(() => g.roundRect(x, 314, 46, 56, 6), M.brass, [[x, 350, 46, 20, M.brass.dark], [x, 314, 46, 4, M.brass.hl]]);
    piece(() => g.roundRect(x + 8, 320, 30, 22, 4), { base: M.brass.hl }, []);
    g.beginPath(); g.arc(x + 23, 352, 4, 0, Math.PI * 2); g.fillStyle = M.strap.dark; g.fill();
    g.fillRect(x + 21, 352, 4, 9);
  }

  // 提手：鼓起来的皮条
  piece(() => g.roundRect(604, 212, 192, 40, 20), M.strap, [[600, 236, 200, 16, M.strap.dark], [600, 216, 200, 5, M.strap.hl]]);

  // 行李牌：米色卡片转 8°，细边框、三行字、铜孔圈；一根细皮绳从右边提环拴过来
  g.save();
  g.translate(792, 382); g.rotate((8 * Math.PI) / 180);
  piece(() => g.roundRect(-29, -46, 58, 92, [12, 12, 4, 4]), M.paper, [[-29, 22, 58, 24, M.paper.dark]]);
  g.strokeStyle = M.strap.base; g.lineWidth = 2;
  g.beginPath(); g.roundRect(-24, -41, 48, 82, [9, 9, 3, 3]); g.stroke();
  for (const y of [-6, 8, 22]) { g.beginPath(); g.moveTo(-17, y); g.lineTo(17, y); g.stroke(); }
  g.beginPath(); g.arc(0, -32, 6, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = M.brass.base; g.stroke();
  g.restore();
  g.beginPath(); g.moveTo(770, 290); g.lineTo(787, 350); g.lineWidth = 4; g.strokeStyle = M.strap.base; g.stroke();
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
