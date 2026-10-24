// 画一张参考图：87 键（TKL、ANSI）机械键盘的正俯视图，远处（功能键那排）在上，无透视、无投影、纯色背景。
// 比上几件画得细：键帽分侧裙（暗）、顶面（亮）、顶面上沿的高光，印字；外壳有上沿高光、下沿暗边，键帽陷在一个深色的槽里。
// 配色：米白字母键、钢蓝功能键、橙色 Esc / Enter、炭灰外壳。不画任何品牌。1u = 64 像素（19.05 毫米）。
//   node examples/keyboard/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

// [印字, x, y, 宽]（单位 u），颜色按组
const F = 'mod', A = 'alpha', X = 'accent';
const keys = [];
const row = (y, list) => { for (const k of list) keys.push({ y, ...k }); };
const seq = (labels, x0, kind, w = 1) => labels.map((t, i) => ({ t, x: x0 + i * w, w, kind }));
row(0, [{ t: 'Esc', x: 0, w: 1, kind: X }, ...seq(['F1', 'F2', 'F3', 'F4'], 2, F), ...seq(['F5', 'F6', 'F7', 'F8'], 6.5, A),
  ...seq(['F9', 'F10', 'F11', 'F12'], 11, F), ...seq(['PrtSc', 'ScrLk', 'Pause'], 15.25, F)]);
row(1.5, [...seq(['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='], 0, A), { t: 'Backspace', x: 13, w: 2, kind: F },
  ...seq(['Ins', 'Home', 'PgUp'], 15.25, F)]);
row(2.5, [{ t: 'Tab', x: 0, w: 1.5, kind: F }, ...seq(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'], 1.5, A),
  { t: '\\', x: 13.5, w: 1.5, kind: F }, ...seq(['Del', 'End', 'PgDn'], 15.25, F)]);
row(3.5, [{ t: 'Caps', x: 0, w: 1.75, kind: F }, ...seq(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"], 1.75, A),
  { t: 'Enter', x: 12.75, w: 2.25, kind: X }]);
row(4.5, [{ t: 'Shift', x: 0, w: 2.25, kind: F }, ...seq(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'], 2.25, A),
  { t: 'Shift', x: 12.25, w: 2.75, kind: F }, { t: '↑', x: 16.25, w: 1, kind: F }]);
row(5.5, [...seq(['Ctrl', 'Win', 'Alt'], 0, F, 1.25), { t: '', x: 3.75, w: 6.25, kind: A }, ...seq(['Alt', 'Fn', 'Menu', 'Ctrl'], 10, F, 1.25),
  ...seq(['←', '↓', '→'], 15.25, F)]);

const code = `(() => {
  const W = 1400, H = 900, U = 64;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#9ea79a';
  g.fillRect(0, 0, W, H);

  const C = {
    alpha:  { top: '#ece5d3', side: '#cdc4ab', hl: '#f7f2e6', ink: '#45464c' },
    mod:    { top: '#5a83b0', side: '#43678f', hl: '#7099c4', ink: '#f2ecdc' },
    accent: { top: '#e2652f', side: '#b54c20', hl: '#ef8659', ink: '#f2ecdc' },
  };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

  // 外壳：炭灰，上沿一条高光、下沿一条暗边
  const cx0 = 92, cy0 = 218, cw = 1216, ch = 464;
  rr(cx0, cy0, cw, ch, 20); g.fillStyle = '#3d3e44'; g.fill();
  g.save(); rr(cx0, cy0, cw, ch, 20); g.clip();
  g.fillStyle = '#4d4e55'; g.fillRect(cx0, cy0, cw, 5);
  g.fillStyle = '#303136'; g.fillRect(cx0, cy0 + ch - 6, cw, 6);
  g.restore();
  // 键帽陷在里面的槽
  const kx = cx0 + 24, ky = cy0 + 24;
  rr(kx - 6, ky - 6, 18.25 * U + 12, 6.5 * U + 12, 8); g.fillStyle = '#26272b'; g.fill();

  for (const k of ${JSON.stringify(keys)}) {
    const col = C[k.kind];
    const x = kx + k.x * U, y = ky + k.y * U, w = k.w * U, h = U;
    // 侧裙（从上面看得到一圈，前面那边多一点）
    rr(x + 3, y + 3, w - 6, h - 6, 7); g.fillStyle = col.side; g.fill();
    // 顶面 + 上沿高光
    rr(x + 9, y + 6, w - 18, h - 17, 5); g.fillStyle = col.top; g.fill();
    g.save(); rr(x + 9, y + 6, w - 18, h - 17, 5); g.clip();
    g.fillStyle = col.hl; g.fillRect(x + 9, y + 6, w - 18, 3);
    g.restore();
    // 印字（左上角）
    if (k.t) {
      g.fillStyle = col.ink;
      g.font = (k.t.length > 2 ? 'bold 11px' : 'bold 14px') + ' sans-serif';
      g.textBaseline = 'top';
      g.fillText(k.t, x + 14, y + 12);
    }
  }
  return c.toDataURL('image/png');
})()`;

console.log(`${keys.length} 个键`);
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
