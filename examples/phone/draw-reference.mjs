// 画一张参考图：手机的背面，正视、竖放、平涂、无投影、无透视。钛金属配色，三摄模组，背面不画任何标志。
// 比例按 146.6 × 70.6 mm：机身 760 像素高（5.18 像素/毫米）。从背面看：镜头模组在左上，音量键在右边，电源键在左边。
//   node examples/phone/draw-reference.mjs
import { writeFileSync } from 'node:fs';
import { launch } from '../../scripts/chrome.mjs';

const code = `(() => {
  const W = 1400, H = 900;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#5e7184';            // 偏蓝的中灰：和浅色钛金属、深色镜头都拉得开
  g.fillRect(0, 0, W, H);

  // 平的面（机身、模组）一个颜色；圆的（镜头）亮暗两阶
  const flat = (make, color) => { g.beginPath(); make(); g.fillStyle = color; g.fill(); };
  const two = (make, [base, dark], bb) => {
    g.save(); g.beginPath(); make(); g.fillStyle = base; g.fill(); g.clip();
    g.fillStyle = dark; g.fillRect(bb[0] - 2, bb[1] + (bb[3] - bb[1]) * 0.6, bb[2] - bb[0] + 4, (bb[3] - bb[1]) * 0.45);
    g.restore();
  };
  const circle = (x, y, r) => () => g.arc(x, y, r, 0, Math.PI * 2);
  const FRAME = '#8a8780', BACK = '#c9c3b8', MODULE = '#e4e0d8';

  // 侧键（从背面看：动作键、音量键在右，电源键在左），先画，机身盖住里面那半
  for (const [x, y, w, h] of [[878, 200, 10, 40], [878, 275, 10, 70], [878, 362, 10, 70], [512, 295, 10, 115]]) {
    flat(() => g.roundRect(x, y, w, h, 3), FRAME);
  }
  // 机身：钛金属边框 6 像素，里面是磨砂背板
  flat(() => g.roundRect(517, 70, 366, 760, 56), FRAME);
  flat(() => g.roundRect(523, 76, 354, 748, 50), BACK);
  // 镜头模组
  flat(() => g.roundRect(535, 88, 192, 192, 42), MODULE);
  // 三个镜头：外圈深灰金属，里面黑玻璃
  for (const [x, y] of [[585, 140], [585, 228], [673, 184]]) {
    two(circle(x, y, 40), ['#3b3d43', '#2c2e33'], [x - 40, y - 40, x + 40, y + 40]);
    two(circle(x, y, 27), ['#14161b', '#0d0e12'], [x - 27, y - 27, x + 27, y + 27]);
  }
  // 闪光灯（右上）、激光雷达（右下）
  flat(circle(690, 112, 13), '#efe3c0');
  flat(circle(690, 256, 12), '#14161b');
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
