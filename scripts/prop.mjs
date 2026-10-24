// img2prop：照一张参考图做像素游戏的道具模型（说明见 SKILL.md）
//   node scripts/prop.mjs <道具文件夹> trace [--zoom x0,y0,x1,y1]
//       看图：<文件夹>/reference.png → out/trace.png（带坐标网格和轮廓）、out/classes.png（有部件表时：按颜色分好的样子）
//   node scripts/prop.mjs <道具文件夹> [更多文件夹…] [--out 目录]
//       生成：<文件夹>/prop.json（部件表）→ out/<id>.json（模型数据）、out/<id>.png（贴图），
//       审图 out/review.png（同机位对比、像素风的近看、游戏里的大小、拆开）、out/diff.png（原尺寸对比）、out/thumb.jpg（缩略图）
//       --out：模型数据和贴图另外写到哪（比如游戏的 content/models/）
// 自己起一个本机网页服务（scripts/serve.mjs），用本机的 Chrome 跑（scripts/chrome.mjs）。除了 three 不用别的包。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { launch } from './chrome.mjs';
import { serve } from './serve.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const zoom = flag('--zoom');
const outDir = flag('--out');
const trace = args.includes('trace');
const dirs = args.filter((a) => a !== 'trace').map((d) => resolve(d));
if (!dirs.length) throw new Error('用法：node scripts/prop.mjs <道具文件夹> [trace [--zoom x0,y0,x1,y1]] [--out 目录]');
const server = await serve();
const base = server.url;
const browser = await launch();
try {
const png = (url) => Buffer.from(url.split(',')[1], 'base64');
const pct = (v) => (v * 100).toFixed(1) + '%';
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

for (const dir of dirs) {
  const started = Date.now();
  const specFile = `${dir}/prop.json`;
  const spec = existsSync(specFile) ? JSON.parse(readFileSync(specFile, 'utf8')) : null;
  // id 拼进输出的文件名、image 拼进读的路径：部件表可能是别人给的，不许带路径（不然 "../../x" 能写到 out/ 外面去）
  const id = spec?.id ?? basename(dir);
  const image = spec?.image ?? 'reference.png';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    console.log(`${dir}：id「${id}」只能用字母、数字、_、-`);
    continue;
  }
  if (image !== basename(image) || !/\.(png|jpe?g|webp)$/i.test(image)) {
    console.log(`${id}：image「${image}」只能是这个文件夹里的图片文件名`);
    continue;
  }
  const imageFile = `${dir}/${image}`;
  if (!existsSync(imageFile)) {
    console.log(`${id}：没有参考图 ${imageFile}`);
    continue;
  }
  const out = `${dir}/out/`;
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage({ width: 1600, height: 1000 });
  const mime = imageFile.endsWith('.png') ? 'image/png' : imageFile.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const input = { id, spec, image: `data:${mime};base64,${readFileSync(imageFile).toString('base64')}`, trace, zoom: zoom?.split(',').map(Number) };
  await page.initScript(`window.__input = ${JSON.stringify(input)};`);
  await page.goto(`${base}/bake/index.html`);
  await page.waitFor(`'result' in window`);
  const r = await page.evaluate('window.result');
  console.log(`— ${id}`);
  if (r.error) {
    console.log('出错：', r.error);
  } else if (trace) {
    const name = zoom ? `trace-${zoom.replaceAll(',', '_')}.png` : 'trace.png';
    writeFileSync(out + name, png(r.grid));
    if (r.classes) writeFileSync(out + 'classes.png', png(r.classes));
    console.log(`图 ${r.size.join('×')}，背景 ${r.bg}（阈值 ${r.threshold}），东西在 [${r.bbox.join(', ')}]，长边 ${r.long} 像素`);
    console.log('东西上的颜色：', r.palette.join('  '));
    console.log(`写了 out/${name}${r.classes ? '、out/classes.png' : ''}`);
  } else {
    writeFileSync(`${out}review.png`, await page.screenshot('#sheet'));
    writeFileSync(`${out}diff.png`, png(r.diff));
    writeFileSync(`${out}thumb.jpg`, png(r.thumb));
    for (const target of [out, outDir && resolve(outDir) + '/'].filter(Boolean)) {
      mkdirSync(target, { recursive: true });
      writeFileSync(`${target}${id}.json`, r.json);
      if (r.map) writeFileSync(`${target}${id}.png`, png(r.map));
      if (r.normal) writeFileSync(`${target}${id}-n.png`, png(r.normal));
    }
    console.log(`轮廓重合 ${pct(r.iou)}，颜色对上 ${pct(r.sameColor)}（${Object.entries(r.perClass).map(([n, v]) => `${n} ${pct(v)}`).join('，')}）`);
    console.log(`${r.stats.parts} 个部件 → ${r.stats.meshes} 个网格，${r.stats.triangles} 个三角形`);
    console.log(`模型数据 ${kb(r.stats.bytes)}` + (r.map ? `，贴图 ${kb(png(r.map).length)}` : '') + (r.normal ? `，法线图 ${kb(png(r.normal).length)}` : ''));
    for (const w of r.warnings) console.log('  注意：' + w);
    console.log(`写了 out/${id}.json${r.map ? `、${id}.png` : ''}、review.png、diff.png、thumb.jpg${outDir ? `，模型也写到了 ${outDir}` : ''}`);
  }
  console.log(`用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
  await page.close();
}
} finally {
  // 出错也要关：不然后台留着 Chrome 和它的临时配置
  await browser.close();
  await server.close();
}
