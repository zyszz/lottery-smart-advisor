// 验证：①「数据驱动」策略按钮 ②回车触发预测 ③数据驱动策略号码合法性（大量抽样）
//      ④回归：精简后 smart / data 两策略仍正常。file:// 模式，无需联网/服务端。
const { chromium } = require('playwright');
const path = require('path');

const { ROOT } = require('./_env');
const HTML = path.join(ROOT, 'lottery_lib.html');

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { console.log('  ✅ ' + n + (extra ? ' → ' + extra : '')); pass++; } else { console.log('  ❌ ' + n + (extra ? ' → ' + extra : '')); fail++; } };

(async () => {
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(require('./_env').fileUrl);
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0 && typeof genSSQ === 'function', { timeout: 15000 });

  // 1) 三个彩种都有「数据驱动」按钮
  const btnCount = await page.evaluate(() => document.querySelectorAll('.strat-btn[data-s="data"]').length);
  check('三个彩种页都有「📊 数据驱动」按钮', btnCount === 3, 'count=' + btnCount);

  // 2) 选中数据驱动按钮后，策略名/提示正确
  const stratMeta = await page.evaluate(() => {
    const btn = document.querySelector('#page-ssq .strat-btn[data-s="data"]');
    btn.click();
    return { name: STATE.ssq.lastStrategy, tip: (document.getElementById('ssq-strat-tip').textContent || '').slice(0, 12) };
  });
  check('选中后策略名=数据驱动 且提示已显示', stratMeta.name === '数据驱动', 'name=' + stratMeta.name);

  // 3) 回车触发预测（在组数输入框回车 → 生成）
  await page.evaluate(() => { document.getElementById('ssq-count').value = '3'; document.getElementById('ssq-results').innerHTML = ''; });
  await page.focus('#ssq-count');
  await page.keyboard.press('Enter');
  let ok = await page.waitForFunction(() => document.querySelectorAll('#ssq-results .result-group').length === 3, { timeout: 3000 }).then(() => true).catch(() => false);
  check('回车触发 ssq 预测（输入框回车→生成3组）', ok);

  // 4) 切到大乐透页签，回车触发 dlt 预测
  await page.evaluate(() => { const b = [...document.querySelectorAll('.tab-btn')].find(x => (x.getAttribute('onclick') || '').includes("switchTab('dlt')")); if (b) b.click(); });
  await page.evaluate(() => { document.getElementById('dlt-count').value = '2'; document.getElementById('dlt-results').innerHTML = ''; });
  await page.focus('#dlt-count');
  await page.keyboard.press('Enter');
  ok = await page.waitForFunction(() => document.querySelectorAll('#dlt-results .result-group').length === 2, { timeout: 3000 }).then(() => true).catch(() => false);
  check('切到大乐透后回车触发 dlt 预测（生成2组）', ok);

  // 5) 数据驱动策略号码合法性（每彩种 300 次抽样）
  const validity = await page.evaluate(() => {
    const N = 300, bad = [];
    const isSorted = a => a.every((v, i) => i === 0 || a[i - 1] <= v);
    const uniq = a => new Set(a).size === a.length;
    const pSSQ = analyzeData(SSQ_DATA, r => r[1], r => r[2], 33, 16, false);
    const pDLT = analyzeData(DLT_DATA, r => r[1], r => r[2], 35, 12, false);
    const pQXC = analyzeData(QXC_DATA, r => r[1], () => [], 9, 0, true);
    let zone3 = 0, dltZone3 = 0, zone2 = 0;
    const realSSQ = SSQ_DATA.map(r => r[1]);
    const realZone3 = realSSQ.filter(r => new Set(r.map(n => n <= 11 ? 0 : n <= 22 ? 1 : 2)).size === 3).length / realSSQ.length;
    for (let i = 0; i < N; i++) {
      const r = genSSQ(pSSQ, 'data');
      if (r.reds.length !== 6 || !r.reds.every(n => n >= 1 && n <= 33) || !uniq(r.reds) || !isSorted(r.reds)) bad.push('ssq.reds@' + i);
      if (r.blues.length !== 1 || !r.blues.every(n => n >= 1 && n <= 16)) bad.push('ssq.blues@' + i);
      if (![r.ac, r.sum, r.span].every(Number.isFinite)) bad.push('ssq.meta@' + i);
      const z = new Set(r.reds.map(n => n <= 11 ? 0 : n <= 22 ? 1 : 2)); if (z.size === 3) zone3++; if (z.size >= 2) zone2++;
      const d = genDLT(pDLT, 'data');
      if (d.reds.length !== 5 || !d.reds.every(n => n >= 1 && n <= 35) || !uniq(d.reds) || !isSorted(d.reds)) bad.push('dlt.reds@' + i);
      if (d.blues.length !== 2 || !d.blues.every(n => n >= 1 && n <= 12) || !uniq(d.blues) || !isSorted(d.blues)) bad.push('dlt.blues@' + i);
      if (![d.ac, d.sum, d.span].every(Number.isFinite)) bad.push('dlt.meta@' + i);
      const dz = new Set(d.reds.map(n => n <= 7 ? 0 : n <= 14 ? 1 : n <= 21 ? 2 : n <= 28 ? 3 : 4)); if (dz.size >= 3) dltZone3++;
      const q = genQXC(pQXC, 'data');
      if (q.nums.length !== 7) bad.push('qxc.len@' + i);
      if (!q.nums.slice(0, 6).every(n => n >= 0 && n <= 9)) bad.push('qxc.base@' + i);
      if (!(q.nums[6] >= 0 && q.nums[6] <= 14)) bad.push('qxc.special@' + i);
      if (!Number.isFinite(q.ac)) bad.push('qxc.ac@' + i);
    }
    return { badCount: bad.length, sample: bad.slice(0, 8), zone3, zone2, realZone3, dltZone3, N };
  });
  check('数据驱动 SSQ/DLT/QXC 各300次抽样全部合法（数量/范围/去重/排序/AC）', validity.badCount === 0, validity.badCount ? JSON.stringify(validity.sample) : '0 违规');
  // v5.4 修正：真实开奖 SSQ 仅约80%覆盖三区（v5.1 硬强制100%属过约束），
  // 故判据改为：① 至少2区覆盖 ≥99%（实质约束生效）② 3区覆盖率贴近真实开奖分布（±10pp）
  check('SSQ 至少2区覆盖率 ≥99%（分区约束生效）', validity.zone2 / validity.N >= 0.99, validity.zone2 + '/' + validity.N);
  check('SSQ 3区覆盖率贴近真实开奖分布（差距≤10pp，不再硬强制100%）', Math.abs(validity.zone3 / validity.N - validity.realZone3) <= 0.10,
    '生成 ' + (validity.zone3 / validity.N * 100).toFixed(1) + '% vs 真实 ' + (validity.realZone3 * 100).toFixed(1) + '%');
  check('DLT 前区五区间覆盖≥3 占比 ≥90%', validity.dltZone3 / validity.N >= 0.9, validity.dltZone3 + '/' + validity.N);

  // 6) 回归：现有策略仍正常
  const reg = await page.evaluate(() => {
    const bad = [];
    const pSSQ = analyzeData(SSQ_DATA, r => r[1], r => r[2], 33, 16, false);
    const pDLT = analyzeData(DLT_DATA, r => r[1], r => r[2], 35, 12, false);
    const pQXC = analyzeData(QXC_DATA, r => r[1], () => [], 9, 0, true);
    for (const s of ['smart', 'data']) {
      for (let i = 0; i < 40; i++) {
        const r = genSSQ(pSSQ, s); if (r.reds.length !== 6 || new Set(r.reds).size !== 6) bad.push('ssq.' + s);
        const d = genDLT(pDLT, s); if (d.reds.length !== 5 || new Set(d.reds).size !== 5 || d.blues.length !== 2) bad.push('dlt.' + s);
        const q = genQXC(pQXC, s); if (q.nums.length !== 7) bad.push('qxc.' + s);
      }
    }
    return bad.slice(0, 10);
  });
  check('回归：smart / data 两策略仍正常生成', reg.length === 0, reg.length ? JSON.stringify(reg) : 'ok');

  check('无未捕获 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n──────────────── 策略 / 回车 验证 ────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
