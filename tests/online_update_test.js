// 端到端验证 http:// 在线更新是否真正生效：
//   启动 start.py -> 打开 http://.../lottery_lib.html -> 点「刷新数据」
//   -> 断言真正的新期号（比内联最新 2026116 更新的，如 2026117/118/119）被合并并渲染
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');

const { ROOT, PY } = require('./_env');

const PORT = 8124;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('  ✅ ' + name); pass++; } else { console.log('  ❌ ' + name); fail++; }
}
function waitServer(url, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => { const req = http.get(url, r => { r.resume(); resolve(true); }); req.on('error', () => { if (Date.now() > end) reject(new Error('timeout')); else setTimeout(tick, 300); }); };
    tick();
  });
}

(async () => {
  const server = spawn(PY, ['start.py', '--port', String(PORT), '--host', '127.0.0.1'], { cwd: ROOT, env: { ...process.env } });
  server.stderr.on('data', d => process.stderr.write('[start.py] ' + d));
  await waitServer('http://127.0.0.1:' + PORT + '/', 15000);

  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  let apiSource = null, apiLatest = null, apiMs = 0;
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/refresh')) {
      const t0 = Date.now();
      try {
        const j = await resp.json();
        apiSource = j && j.source;
        if (j && j.data && j.data.ssq && j.data.ssq[0]) apiLatest = j.data.ssq[0][0];
      } catch (_) {}
      apiMs = Date.now() - t0;
    }
  });

  await page.goto('http://127.0.0.1:' + PORT + '/lottery_lib.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0, { timeout: 15000 });

  const before = await page.evaluate(() => ({ latest: SSQ_DATA[0][0], issues: SSQ_DATA.map(r => r[0]) }));

  // 点「刷新数据」
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('刷新数据'));
    if (btn) btn.click();
  });

  // /api/refresh 在线模式需实时抓取（给足等待）；CI 设 LOTTERY_OFFLINE=1 时秒回本地缓存
  let after = null, rendered = '';
  try {
    await page.waitForFunction(() => SSQ_DATA[0][0] !== '2026116' && parseInt(SSQ_DATA[0][0]) > 2026116, { timeout: 60000 });
  } catch (_) {}
  await page.waitForTimeout(2500); // 让 /api/refresh 响应被监听器捕获
  after = await page.evaluate(() => ({ latest: SSQ_DATA[0][0], issues: SSQ_DATA.map(r => r[0]) }));
  rendered = await page.evaluate(() => {
    const el = document.getElementById('ssq-last');
    return el ? el.innerText : '';
  });

  console.log('\n──── 在线更新端到端诊断 ────');
  console.log('  点击前内联最新期号 :', before.latest);
  console.log('  点击后页面最新期号 :', after.latest);
  console.log('  /api/refresh source:', apiSource, ' | 返回最新:', apiLatest);
  console.log('  新增期号:', (after.issues || []).filter(x => !before.issues.includes(x)).join(',') || '(无)');
  console.log('  最近一期面板片段  :', rendered.slice(0, 80).replace(/\n/g, ' '));
  console.log('');

  // 离线模式（CI）下 /api/refresh 返回 cache(...)，不应要求 source=fresh
  const offline = process.env.LOTTERY_OFFLINE === '1';
  check(offline
      ? '/api/refresh 被调用且走离线缓存（CI 模式）'
      : '/api/refresh 被调用且 source=fresh（真·在线）',
    offline
      ? (typeof apiSource === 'string' && apiSource.startsWith('cache'))
      : apiSource === 'fresh');
  check('在线返回最新期号 > 内联最新 2026116', apiLatest && parseInt(apiLatest) > 2026116);
  check('点击后 SSQ_DATA 最新期号被更新（不再停在 2026116）', parseInt(after.latest) > 2026116);
  check('新期号出现在页面 SSQ_DATA 中', (after.issues || []).some(x => parseInt(x) > 2026116));
  check('最近一期面板渲染出最新期号', rendered.includes(after.latest));
  check('无未捕获 JS 异常', errors.length === 0);

  await browser.close();
  server.kill('SIGKILL');

  console.log('──────────────────────────────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
