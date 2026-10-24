// 去掉 PNG 里的文字块（tEXt / zTXt / iTXt）和时间（tIME）：ComfyUI 会把整个工作流（模型名、提示词、种子）写进去。
// 只删这几种块，像素、颜色信息原样留着。公开参考图之前跑一遍：
//   node scripts/strip-png.mjs examples/*/reference.png docs/*.png
import { readFileSync, writeFileSync } from 'node:fs';

const DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME']);
const SIG = '89504e470d0a1a0a';

for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== SIG) { console.log(`${file}：不是 PNG，跳过`); continue; }
  const keep = [buf.subarray(0, 8)];
  const dropped = [];
  for (let i = 8; i < buf.length;) {
    const n = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const chunk = buf.subarray(i, i + 12 + n);
    if (DROP.has(type)) dropped.push(`${type} ${n} B`);
    else keep.push(chunk);
    i += 12 + n;
    if (type === 'IEND') break;
  }
  if (!dropped.length) { console.log(`${file}：没有文字块`); continue; }
  writeFileSync(file, Buffer.concat(keep));
  console.log(`${file}：去掉 ${dropped.join('、')}`);
}
