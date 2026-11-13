/**
 * auto_update_v5_test.js —— 用真实 Chromium 验证 lottery_lib.html (v5.0) 的自动数据更新
 *
 * 运行（受管 Node 22.22.2-6 + 已装 Playwright/Chromium）：
 *   NODE_PATH=<workspace>/node_modules \
 *   <managed-node>/node.exe tests/auto_update_v5_test.js
 *
 * 验证项：
 *   1) 页面加载 & init() 初始化（内联 SSQ/DLT/QXC 数据已就绪、面板渲染）
 *   2) _mergeInto 纯函数：新增计数 / 置顶 / 降序 / 限长≤50（自动更新核心合并逻辑）
 *   3) autoUpdateFromNetwork：注入合成 window.LOTTERY_DATA 后合并新期 + 写 localStorage
 *   4) 「刷新数据」按钮在 file:// 离线模式下安全回退（不抛错）
 *   5) 无未捕获 JS 异常 / 无严重控制台错误（剔除编辑器注入脚本 inject.js）
 *   6) 截图 data/v5_page_open.png
 */
const { chromium } = require('playwright');

const { ROOT: PROJECT, HTML, fileUrl } = require('./_env');
const SHOT = require('./_env').shot('v5_page_open.png');

// 离线 file:// 模式下，以下资源失败属正常现象，不算缺陷：
//  - /page/page_comm/inject.js : WorkBuddy 页面编辑器注入脚本（绝对路径，仅编辑器内有效）
//  - favicon.ico               : 无图标
//  - lottery_data.js           : 可选外部同步文件，由 fetch_lottery.py 在 http 服务端生成；
//                                本页已内联 SSQ_DATA/DLT_DATA/QXC_DATA，file:// 独立打开时本就不应存在，
//                                页面 updateFromNetwork() 已专门处理「lottery_data.js 未加载」的情况
//  - /api/refresh              : 仅 http:// 模式触发，file:// 下已被协议守卫跳过
const benign = (u) => /(\/page\/page_comm\/inject\.js|favicon\.ico|lottery_data\.js|\/api\/refresh)/.test(u || '');

(async () => {
  const consoleMsgs = [];
  const pageErrors = [];
  const failedReqs = [];
  const benignFailed = [];

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

  const urlOf = (m) => { try { const l = m.location(); return (l && l.url) || ''; } catch (e) { return ''; } };
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text(), url: urlOf(m) }));
  page.on('pageerror', (e) => pageErrors.push(String((e && e.stack) || e)));
  page.on('requestfailed', (r) => { if (benign(r.url())) { benignFailed.push(r.url()); return; } failedReqs.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)); });
  page.on('response', (r) => { if (r.status() >= 400 && !benign(r.url())) failedReqs.push(r.status() + ' ' + r.url()); });

  const results = [];
  const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

  // 1) 加载页面
  try {
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(
      () => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0 &&
            document.getElementById('ssq-last') &&
            document.getElementById('ssq-last').innerText.trim().length > 0,
      null, { timeout: 20000 });
    ok('页面加载 & init() 初始化完成', true, '');
  } catch (e) {
    ok('页面加载 & init() 初始化完成', false, '超时或抛错: ' + e.message);
  }

  // 2) 数据 & 面板渲染
  const info = await page.evaluate(() => ({
    ssq: SSQ_DATA.length, dlt: DLT_DATA.length, qxc: QXC_DATA.length,
    last: (document.getElementById('ssq-last').innerText || '').trim().slice(0, 60).replace(/\s+/g, ' '),
    missing: (document.getElementById('ssq-missing').innerText || '').length,
    stats: (document.getElementById('ssq-stats').innerText || '').length,
    mandel: (document.getElementById('ssq-mandel').innerText || '').length,
  }));
  ok('内联开奖数据加载 (SSQ/DLT/QXC >0)', info.ssq > 0 && info.dlt > 0 && info.qxc > 0,
    `ssq=${info.ssq} dlt=${info.dlt} qxc=${info.qxc}`);
  ok('init 渲染「最近一期」非空', info.last.length > 0, info.last);
  ok('init 渲染 遗漏/统计/数论 面板非空', info.missing > 0 && info.stats > 0 && info.mandel > 0,
    `missing=${info.missing} stats=${info.stats} mandel=${info.mandel}`);

  // 3) _mergeInto 纯函数：新增计数 / 置顶 / 降序
  const merge = await page.evaluate(() => {
    const arr = [['2026002', [1, 2, 3, 4, 5, 6], [1]], ['2026001', [7, 8, 9, 10, 11, 12], [2]]];
    const added = window._mergeInto(arr, [['2026999', [13, 14, 15, 16, 17, 18], [3]]]);
    return { added, first: arr[0][0], len: arr.length, desc: arr.every((r, i, a) => i === 0 || a[i - 1][0] >= r[0]) };
  });
  ok('_mergeInto：新增计数/置顶/降序', merge.added === 1 && merge.first === '2026999' && merge.desc && merge.len === 3, JSON.stringify(merge));

  // 4) _mergeInto 限长 ≤ 50
  const cap = await page.evaluate(() => {
    const arr = [];
    for (let i = 0; i < 60; i++) arr.push([String(2000000 + i).padStart(7, '0'), [1, 2, 3, 4, 5, 6], [1]]);
    window._mergeInto(arr, [['2099999', [1, 2, 3, 4, 5, 6], [1]]]);
    return arr.length;
  });
  ok('_mergeInto 限长 ≤ 50', cap <= 50, 'len=' + cap);

  // 5) autoUpdateFromNetwork：注入合成 LOTTERY_DATA，验证合并 + localStorage
  const au = await page.evaluate(() => {
    window.LOTTERY_DATA = {
      updated: '2026-10-13 14:00:00',
      ssq: [['2026999', [2, 4, 6, 8, 10, 12], [3]]],
      dlt: [['2026999', [1, 2, 3, 4, 5], [6, 7]]],
      qxc: [['2026999', [1, 2, 3, 4, 5, 6, 7], 9]],
    };
    window.autoUpdateFromNetwork();
    const stored = localStorage.getItem('lottery_last_update');
    return { first: SSQ_DATA[0][0], len: SSQ_DATA.length, stored: !!stored, storedVal: stored };
  });
  ok('autoUpdateFromNetwork 合并新期 & 写 localStorage', au.first === '2026999' && au.len <= 50 && au.stored, JSON.stringify(au));

  // 6) 「刷新数据」按钮：file:// 离线回退，不应抛错
  try {
    await page.evaluate(() => document.querySelector('button[onclick="refreshData()"]').click());
    await page.waitForTimeout(600);
    const status = await page.evaluate(() => document.getElementById('update-status').textContent || '');
    ok('「刷新数据」按钮 (file:// 离线回退) 不报错', true, 'status=' + status.slice(0, 40));
  } catch (e) {
    ok('「刷新数据」按钮 (file:// 离线回退) 不报错', false, e.message);
  }

  // 7) 错误汇总（剔除编辑器注入脚本）
  const realErrors = consoleMsgs.filter((m) => m.type === 'error' && !(m.url && benign(m.url)));
  ok('无未捕获 JS 异常 (pageerror)', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
  ok('无严重控制台错误 (剔除编辑器 inject.js)', realErrors.length === 0, realErrors.map((m) => m.text).join(' | ').slice(0, 300));
  ok('无失败的网络请求 (剔除编辑器/离线资源)', failedReqs.length === 0, failedReqs.join(' | ').slice(0, 300));

  try { await page.screenshot({ path: SHOT, fullPage: true }); } catch (e) { /* ignore */ }
  await browser.close();

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('\n════════ v5.0 自动数据更新 验证报告 ════════');
  for (const r of results) console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? '  → ' + r.detail : ''));
  console.log('────────────────────────────────');
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`  未捕获异常 ${pageErrors.length} 个，失败请求 ${failedReqs.length} 个，预期内资源失败(编辑器inject.js) ${benignFailed.length} 个`);
  console.log('  截图: ' + SHOT);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试脚本自身异常:', e); process.exit(2); });
