// 本机的小网页服务（只用 Node 自带的东西，代替 Vite）：给 bake/、viewer/ 页面用。
//   node scripts/serve.mjs [--port 5199]     看例子：打开 http://127.0.0.1:5199/viewer/
// - 只听 127.0.0.1、只认 Host 是 127.0.0.1 / localhost，只接 GET / HEAD，只给这个仓库里的文件（不给 . 开头的，比如 .git）
// - .ts 现场去掉类型再给浏览器（Node 自带的 stripTypeScriptTypes：只删类型，不改写代码，所以源码里不能用 enum、构造函数参数属性）
// - three 由页面里的 import map 指到 node_modules/three
// - /__examples：examples/ 下生成好的模型清单（例子页用）
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, resolve, sep } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
// stripTypeScriptTypes 每个进程会提示一次「实验功能」，别的警告照常
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('stripTypeScriptTypes') ? undefined : emitWarning.call(process, w, ...rest));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
};
const stripped = new Map();

/** 生成好的模型：examples/<文件夹>/out/<id>.json 和同名贴图 */
async function examples() {
  const out = [];
  for (const dir of (await readdir(`${ROOT}/examples`, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    const files = await readdir(`${ROOT}/examples/${dir.name}/out`).catch(() => []);
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      const id = f.slice(0, -5);
      out.push({ id, data: `/examples/${dir.name}/out/${f}`, map: files.includes(`${id}.png`) ? `/examples/${dir.name}/out/${id}.png` : null });
    }
  }
  return out;
}

async function handle(req, res) {
  const send = (code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, '只能 GET');
  // 只认本机的地址：防别的网站用 DNS 换绑（把自己的域名指到 127.0.0.1）来读这里的文件
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return send(403, '只给本机');
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/__examples') return send(200, JSON.stringify(await examples()), 'application/json');
  if (url.pathname === '/favicon.ico') return send(204, '');
  let path = resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  // 只给仓库里的、不是 . 开头的文件
  if (path !== ROOT && !path.startsWith(ROOT + sep)) return send(403, '不给');
  if (path.slice(ROOT.length).split(sep).some((p) => p.startsWith('.'))) return send(403, '不给');
  const info = await stat(path).catch(() => null);
  if (info?.isDirectory()) path = resolve(path, 'index.html');
  const type = TYPES[extname(path)];
  if (!type) return send(404, '没有');
  let body = await readFile(path).catch(() => null);
  if (!body) return send(404, '没有');
  if (path.endsWith('.ts')) {
    const key = `${path}:${(await stat(path)).mtimeMs}`;
    if (!stripped.has(key)) stripped.set(key, stripTypeScriptTypes(body.toString('utf8'), { mode: 'strip' }));
    body = stripped.get(key);
  }
  send(200, body, type);
}

/** 起服务：port 0 = 随便找个空的 */
export function serve(port = 0) {
  return new Promise((ok, bad) => {
    const server = createServer((req, res) => handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e?.message ?? e)); }));
    server.on('error', bad);
    server.listen(port, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--port');
  const { url } = await serve(i > 0 ? Number(process.argv[i + 1]) : 5199);
  console.log(`例子页：${url}/viewer/`);
}
