// README 的配图：node scripts/media.mjs [gallery|gif|lighting|all]
//   gallery  → docs/gallery.png：所有例子一张图（先 npm run examples 生成模型）
//   gif      → docs/open.gif：大门、密码箱、钢笔的开合动起来
//   lighting → docs/lighting.png：详情页的光照页（摩托车，夜晚，车灯插座上挂一盏暖光）
// 和 prop.mjs 一样自己起本机服务、用本机的 Chrome，跑完就退出。
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './chrome.mjs';
import { serve } from './serve.mjs';

const what = process.argv[2] ?? 'all';
const docs = new URL('../docs/', import.meta.url).pathname;
mkdirSync(docs, { recursive: true });
const server = await serve();
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  if (what === 'gallery' || what === 'all') {
    const page = await browser.newPage({ width: 1400, height: 1200 });
    await page.goto(`${server.url}/scripts/media.html?mode=gallery`);
    await page.waitFor('window.ready === true', 120000);
    writeFileSync(`${docs}gallery.png`, await page.screenshot('#sheet'));
    console.log('写了 docs/gallery.png');
    await page.close();
  }
  if (what === 'gif' || what === 'all') {
    const page = await browser.newPage({ width: 1400, height: 400 });
    await page.goto(`${server.url}/scripts/media.html?mode=gif`);
    await page.waitFor('window.ready === true', 180000);
    const gif = Buffer.from(await page.evaluate('window.gif'), 'base64');
    writeFileSync(`${docs}open.gif`, gif);
    console.log(`写了 docs/open.gif（${(gif.length / 1024).toFixed(0)} KB）`);
    await page.close();
  }
  if (what === 'lighting' || what === 'all') {
    const page = await browser.newPage({ width: 1440, height: 820 });
    const url = `${server.url}/viewer/item.html?id=motorcycle&tab=light`;
    await page.goto(url);
    await page.waitFor('window.ready === true');
    // 夜晚预设，删掉预设自带的那盏，在车灯插座上挂一盏；存下来再开一次（灯从本机存储里读）
    await page.evaluate(`(() => {
      const click = (sel, text, n = 0) => [...document.querySelectorAll(sel)].filter((b) => b.textContent === text)[n].click();
      click('#light button', '夜晚');
      click('#light button', '删');
      document.getElementById('tabInfo').click();
      click('#info button', '挂一盏灯', 1);
      click('#light button', '存为这件的');
      return true;
    })()`);
    await page.goto(url);
    await page.waitFor('window.ready === true');
    await sleep(800);
    writeFileSync(`${docs}lighting.png`, await page.screenshot('body'));
    await page.evaluate(`localStorage.clear()`);
    console.log('写了 docs/lighting.png');
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
