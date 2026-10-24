// 直接用 Chrome 的调试协议（CDP）驱动本机 Chrome（只用 Node 自带的 WebSocket，代替 playwright）。
// 每次用一个临时的空白配置（不碰你平时的浏览器、登录状态），关掉后台联网、同步、扩展，用完删掉。
// 找不到 Chrome：设 CHROME_PATH 指到 Chrome / Chromium 的可执行文件。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export async function launch() {
  const exe = CANDIDATES.find((p) => p && existsSync(p));
  if (!exe) throw new Error('找不到 Chrome：设 CHROME_PATH 指到 Chrome 或 Chromium');
  const profile = await mkdtemp(join(tmpdir(), 'img2prop-chrome-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--disable-domain-reliability', '--metrics-recording-only', '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  // 不管脚本怎么退出（出错、Ctrl-C），都别把 Chrome 留在后台
  const killChrome = () => { if (proc.exitCode === null) proc.kill('SIGKILL'); };
  process.on('exit', killChrome);
  const exited = new Promise((r) => proc.once('exit', r));
  const endpoint = await new Promise((ok, bad) => {
    let buf = '';
    const timer = setTimeout(() => bad(new Error('Chrome 15 秒没起来')), 15000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); ok(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); bad(new Error(`Chrome 退出了（${code}）`)); });
  });
  const ws = new WebSocket(endpoint);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('连不上 Chrome')); });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.bad(new Error(msg.error.message));
      else p?.ok(msg.result);
    } else for (const f of listeners) f(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, bad) => {
    const id = ++seq;
    pending.set(id, { ok, bad });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return {
    /** 开一个页面：viewport 宽高（页面像素，1 倍） */
    async newPage({ width = 1600, height = 1000 } = {}) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const s = (method, params) => send(method, params, sessionId);
      const once = (method) => new Promise((ok) => {
        const f = (msg) => { if (msg.sessionId === sessionId && msg.method === method) { listeners.delete(f); ok(msg.params); } };
        listeners.add(f);
      });
      // 页面里的报错打出来
      listeners.add((msg) => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Runtime.exceptionThrown') console.log('[页面出错]', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') console.log('[页面 error]', msg.params.args.map((a) => a.value ?? a.description).join(' '));
        // 模块加载失败（比如 .ts 去类型出错、文件 404）走的是 Log
        if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') console.log('[页面 error]', msg.params.entry.text, msg.params.entry.url ?? '');
      });
      await s('Page.enable');
      await s('Runtime.enable');
      await s('Log.enable');
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const evaluate = async (expression) => {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      };
      return {
        /** 页面加载前先跑的脚本（塞输入用） */
        initScript: (source) => s('Page.addScriptToEvaluateOnNewDocument', { source }),
        async goto(url) {
          const loaded = once('Page.loadEventFired');
          await s('Page.navigate', { url });
          await loaded;
        },
        evaluate,
        /** 等到表达式为真 */
        async waitFor(expression, timeout = 60000) {
          const end = Date.now() + timeout;
          while (!(await evaluate(expression))) {
            if (Date.now() > end) throw new Error(`等了 ${timeout / 1000} 秒：${expression}`);
            await new Promise((r) => setTimeout(r, 100));
          }
        },
        /** 截一个元素（超出窗口的部分也截） */
        async screenshot(selector) {
          const clip = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
            return { x: r.x + scrollX, y: r.y + scrollY, width: Math.ceil(r.width), height: Math.ceil(r.height), scale: 1 }; })()`);
          const { data } = await s('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
          return Buffer.from(data, 'base64');
        },
        close: () => send('Target.closeTarget', { targetId }),
      };
    },
    async close() {
      await Promise.race([send('Browser.close').catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
      ws.close();
      // 等它真退出了再删临时配置（不然还在写）
      if (proc.exitCode === null) {
        proc.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
        killChrome();
      }
      process.off('exit', killChrome);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
