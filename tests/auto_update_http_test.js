/**
 * auto_update_http_test.js —— 验证 lottery_lib.html 在 http:// 服务端模式下的自动刷新
 *
 * 前置：python start.py --port 8000 已在后台运行
 * 运行：NODE_PATH=<workspace>/node_modules <managed-node>/node.exe tests/auto_update_http_test.js
 *
 * 验证项：
 *   1) 通过 http:// 加载页面，window.LOTTERY_DATA 由 lottery_data.js 正常加载（不再 404）
 *   2) init 渲染 + 内联数据就绪
 *   3) 自动刷新已执行：localStorage 'lottery_last_update' 被写入
 *   4) 点击生成号码可正常产出
 *   5) 无未捕获 JS 异常 / 无严重控制台错误（剔除编辑器 inject.js）
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 8125;
const BASE_URL = 'http://127.0.0.1:' + PORT + '/lottery_lib.html';

const { ROOT, PY } = require('./_env');
const SHOT = require('./_env').shot('v5_http_page_open.png');

const benign = (u) => /(\/page\/page_comm\/inject\.js|favicon\.ico)/.test(u || '');

// 自启本地服务（与 refresh_button_http_test / online_update_test 一致，避免端口硬依赖）
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
  const consoleMsgs = [];
  const pageErrors = [];
  const failedReqs = [];
  const benignFailed = [];

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

  const urlOf = (m) => { try { const l = m.location(); return (l && l.url) || ''; } catch (e) { return ''; } };
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text(), url: urlOf(m) }));
  page.on('pageerror', (e) => pageErrors.push(String((e && e.stack) || e)));
  page.on('requestfailed', (r) => { if (benign(r.url())) { benignFailed.push(r.url()); return; } failedReqs.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)); });
  page.on('response', (r) => { if (r.status() >= 400 && !benign(r.url())) failedReqs.push(r.status() + ' ' + r.url()); });

  const results = [];
  const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

  const server = spawn(PY, ['start.py', '--port', String(PORT), '--host', '127.0.0.1'], { cwd: ROOT, env: { ...process.env } });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.stderr.write('[start.py] ' + d));

  try {
    await waitServer('http://127.0.0.1:' + PORT + '/', 15000);
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(
      () => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0 &&
            document.getElementById('ssq-last') &&
            document.getElementById('ssq-last').innerText.trim().length > 0,
      null, { timeout: 20000 });
    ok('http:// 页面加载 & init() 完成', true, '');
  } catch (e) {
    ok('http:// 页面加载 & init() 完成', false, '超时或抛错: ' + e.message);
  }

  // window.LOTTERY_DATA 由 lottery_data.js 加载（验证不再 404）
  const info = await page.evaluate(() => ({
    ld: typeof window.LOTTERY_DATA !== 'undefined' && window.LOTTERY_DATA ? Object.keys(window.LOTTERY_DATA) : null,
    ssq: SSQ_DATA.length, dlt: DLT_DATA.length, qxc: QXC_DATA.length,
    last: (document.getElementById('ssq-last').innerText || '').trim().slice(0, 50).replace(/\s+/g, ' '),
    stored: localStorage.getItem('lottery_last_update'),
  }));
  ok('lottery_data.js 正常加载 (window.LOTTERY_DATA 存在)', Array.isArray(info.ld) && info.ld.includes('ssq'),
    'keys=' + (info.ld ? info.ld.join(',') : 'null'));
  ok('内联数据就绪 (SSQ/DLT/QXC >0)', info.ssq > 0 && info.dlt > 0 && info.qxc > 0,
    `ssq=${info.ssq} dlt=${info.dlt} qxc=${info.qxc}`);
  ok('init 渲染「最近一期」非空', info.last.length > 0, info.last);
  ok('自动刷新已执行 (localStorage lottery_last_update 已写入)', !!info.stored, 'stored=' + (info.stored || '').slice(0, 40));

  // 生成号码
  try {
    await page.evaluate(() => window.generate('ssq'));
    await page.waitForFunction(() => {
      const b = document.getElementById('ssq-results');
      return b && b.innerText.trim().length > 0 && !/生成中/.test(b.innerText);
    }, null, { timeout: 8000 });
    const r = await page.evaluate(() => (document.getElementById('ssq-results').innerText || '').replace(/\s+/g, ' ').slice(0, 80));
    ok('点击生成号码可执行 (ssq)', r.length > 0, r);
  } catch (e) { ok('点击生成号码可执行 (ssq)', false, e.message); }

  const realErrors = consoleMsgs.filter((m) => m.type === 'error' && !(m.url && benign(m.url)));
  ok('无未捕获 JS 异常 (pageerror)', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
  ok('无严重控制台错误 (剔除编辑器 inject.js)', realErrors.length === 0, realErrors.map((m) => m.text).join(' | ').slice(0, 300));
  ok('无失败的网络请求 (剔除编辑器/离线资源)', failedReqs.length === 0, failedReqs.join(' | ').slice(0, 300));

  try { await page.screenshot({ path: SHOT, fullPage: true }); } catch (e) {}
  await browser.close();
  try { server.kill(); } catch (e) {}

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('\n════════ v5.0 http:// 服务端自动刷新 验证报告 ════════');
  for (const r of results) console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? '  → ' + r.detail : ''));
  console.log('────────────────────────────────');
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`  未捕获异常 ${pageErrors.length} 个，失败请求 ${failedReqs.length} 个，预期内资源失败(编辑器inject.js) ${benignFailed.length} 个`);
  console.log('  截图: ' + SHOT);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试脚本自身异常:', e); process.exit(2); });
