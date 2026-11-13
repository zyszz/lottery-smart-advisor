// 验证 http:// 模式下「刷新数据」按钮：
//   启动 start.py 本地服务 -> 打开 http://127.0.0.1:8000/lottery_lib.html
//   -> 点击「刷新数据」按钮 -> 断言真正发起了 /api/refresh 且返回成功
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const { ROOT, PY } = require('./_env');

const PORT = 8123;
const BASE = 'http://127.0.0.1:' + PORT + '/lottery_lib.html';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('  ✅ ' + name); pass++; }
  else { console.log('  ❌ ' + name); fail++; }
}
function waitServer(url, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, res => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() > end) reject(new Error('server timeout'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

(async () => {
  const server = spawn(PY, ['start.py', '--port', String(PORT), '--host', '127.0.0.1'], { cwd: ROOT, env: { ...process.env } });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.stderr.write('[start.py] ' + d));

  await waitServer('http://127.0.0.1:' + PORT + '/', 15000);

  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  let apiCalled = false, apiOk = false, apiBody = null;
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/refresh')) {
      apiCalled = true;
      try { const j = await resp.json(); apiOk = !!(j && j.success); apiBody = j; } catch (_) {}
    }
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0, { timeout: 15000 });

  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('刷新数据'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('找到并点击了「刷新数据」按钮', clicked);

  // 等待 /api/refresh 响应
  try { await page.waitForFunction(() => window.__apiRefreshSeen === true, { timeout: 10000 }); } catch (_) {}
  // 给响应监听一点时间
  await page.waitForTimeout(2500);

  check('按钮触发了 /api/refresh 请求', apiCalled);
  check('/api/refresh 返回 success=true', apiOk);
  if (apiBody) {
    check('返回数据含 ssq/dlt/qxc 三彩种', !!(apiBody.data && apiBody.data.ssq && apiBody.data.dlt && apiBody.data.qxc));
  }
  check('无未捕获 JS 异常', errors.length === 0);

  await browser.close();
  server.kill('SIGKILL');

  console.log('\n──────────────── http:// 刷新按钮验证 ────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
