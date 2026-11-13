// 真实浏览器验证：打开页面 → 选「📊 数据驱动」→ 回车 → 记录实际预测结果
const { chromium } = require('playwright');
const path = require('path');
const { ROOT } = require('./_env');
const HTML = path.join(ROOT, 'lottery_lib.html');
const SHOT = path.join(ROOT, 'data', 'v54_enter_result.png');

(async () => {
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server', '--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(require('./_env').fileUrl);
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0, { timeout: 15000 });

  for (const [tab, type, n] of [['ssq', 'ssq', 3], ['dlt', 'dlt', 2], ['qxc', 'qxc', 2]]) {
    await page.evaluate((t) => { const b = [...document.querySelectorAll('.tab-btn')].find(x => (x.getAttribute('onclick') || '').includes(`switchTab('${t}')`)); if (b) b.click(); }, tab);
    // 选中「数据驱动」策略
    await page.evaluate((t) => { const b = document.querySelector(`#page-${t} .strat-btn[data-s="data"]`); if (b) b.click(); }, tab);
    await page.evaluate(({ ty, c }) => { document.getElementById(ty + '-count').value = String(c); document.getElementById(ty + '-results').innerHTML = ''; }, { ty: type, c: n });
    await page.focus('#' + type + '-count');
    await page.keyboard.press('Enter');                       // ← 回车预测
    await page.waitForFunction(({ ty, c }) => document.querySelectorAll('#' + ty + '-results .result-group').length === c, { ty: type, c: n }, { timeout: 6000 });
    const txt = await page.evaluate((t) => (document.getElementById(t + '-results').innerText || '').replace(/\s+/g, ' ').trim(), type);
    console.log(`\n【${type.toUpperCase()} · 数据驱动 · 回车预测】`);
    console.log('  ' + txt.slice(0, 420));
  }

  // 切回 SSQ 截图留档
  await page.evaluate(() => { const b = [...document.querySelectorAll('.tab-btn')].find(x => (x.getAttribute('onclick') || '').includes("switchTab('ssq')")); if (b) b.click(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOT, fullPage: false });
  console.log('\n截图: ' + SHOT);
  console.log('未捕获异常: ' + errs.length + (errs.length ? ' → ' + errs.slice(0, 2).join(' | ') : ''));
  await browser.close();
})().catch(e => { console.error('异常:', e); process.exit(1); });
