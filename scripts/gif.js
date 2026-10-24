// 最小的 GIF89a 编码（浏览器、Node 都能用，不依赖别的）：给 README 的动图用。
// 全局调色板最多 256 色：按出现次数挑，其余就近；LZW 压缩；循环播放。像素画颜色少、大片同色，压得很小。
//   encodeGif(frames: Uint8ClampedArray[] (RGBA), width, height, delay 百分之一秒) → Uint8Array

function lzw(out, idx, minCode) {
  out.push(minCode);
  // 数据分成 ≤ 255 字节的子块，每块前面一个长度字节：先占位，写满了回填
  let sub = out.length;
  out.push(0);
  const clear = 1 << minCode, eoi = clear + 1;
  let next = eoi + 1, size = minCode + 1, cur = 0, shift = 0;
  let table = new Map();
  const flush = (min) => {
    while (shift >= min) {
      out.push(cur & 255);
      cur >>>= 8;
      shift -= 8;
      if (out.length === sub + 256) { out[sub] = 255; sub = out.length; out.push(0); }
    }
  };
  const emit = (c) => { cur |= c << shift; shift += size; flush(8); };
  emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    // 码表满了（4096）：发一个清除码，从头来
    if (next === 4096) { emit(clear); next = eoi + 1; size = minCode + 1; table = new Map(); }
    else { if (next >= 1 << size) size++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  flush(1);
  if (out.length === sub + 1) out[sub] = 0; // 最后一块是空的：它就是结束块
  else { out[sub] = out.length - sub - 1; out.push(0); }
}

export function encodeGif(frames, width, height, delay = 6) {
  const count = new Map();
  for (const f of frames) for (let i = 0; i < f.length; i += 4) { const c = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2]; count.set(c, (count.get(c) ?? 0) + 1); }
  const pal = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map((e) => e[0]);
  const index = new Map(pal.map((c, i) => [c, i]));
  const nearest = (c) => {
    const hit = index.get(c);
    if (hit !== undefined) return hit;
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    let best = 0, bd = Infinity;
    pal.forEach((p, i) => { const d = (r - (p >> 16)) ** 2 + (g - ((p >> 8) & 255)) ** 2 + (b - (p & 255)) ** 2; if (d < bd) { bd = d; best = i; } });
    index.set(c, best);
    return best;
  };
  let bits = 1;
  while (1 << bits < pal.length) bits++;
  const out = [];
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  const ascii = (s) => { for (const ch of s) out.push(ch.charCodeAt(0)); };
  ascii('GIF89a');
  u16(width); u16(height);
  out.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < 1 << bits; i++) { const c = pal[i] ?? 0; out.push(c >> 16, (c >> 8) & 255, c & 255); }
  out.push(0x21, 0xff, 0x0b); ascii('NETSCAPE2.0'); out.push(0x03, 0x01, 0, 0, 0); // 无限循环
  for (const f of frames) {
    out.push(0x21, 0xf9, 0x04, 0x04); u16(delay); out.push(0, 0); // 不透明，画完留着
    out.push(0x2c); u16(0); u16(0); u16(width); u16(height); out.push(0);
    const idx = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < f.length; i += 4, j++) idx[j] = nearest((f[i] << 16) | (f[i + 1] << 8) | f[i + 2]);
    lzw(out, idx, Math.max(2, bits));
  }
  out.push(0x3b);
  return new Uint8Array(out);
}
