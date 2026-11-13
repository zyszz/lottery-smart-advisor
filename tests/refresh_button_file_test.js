// 验证 file:// 模式下「刷新数据」按钮：
//   1) 页面加载后，修改磁盘上的 lottery_data.js（追加更高期号 2026999）
//   2) 点击「刷新数据」按钮
//   3) 断言按钮动态重载 lottery_data.js 并把新期合并进页面数据 + 渲染
// 采用 backup / restore，保证不污染真实数据文件。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const { ROOT } = require('./_env');
const HTML = path.join(ROOT, 'lottery_lib.html');
const DATAJS = path.join(ROOT, 'lottery_data.js');
const BAK = path.join(ROOT, 'lottery_data.js.bak_refreshtest');
const NEW_ISSUE = '2026999';

function extractObj(src) {
  const m = src.match(/window\.LOTTERY_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error('无法解析 lottery_data.js');
  return JSON.parse(m[1]);
}
function rebuild(src, obj) {
  return src.replace(/window\.LOTTERY_DATA\s*=\s*\{[\s\S]*\}\s*;?\s*$/,
    'window.LOTTERY_DATA = ' + JSON.stringify(obj, null, 2) + ';');
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('  ✅ ' + name); pass++; }
  else { console.log('  ❌ ' + name); fail++; }
}

(async () => {
  // 备份
  fs.copyFileSync(DATAJS, BAK);
  let originalSrc = fs.readFileSync(DATAJS, 'utf8');

  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const fileUrl = require('./_env').fileUrl;
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0, { timeout: 15000 });

  // 加载完成时的期号集合
  const before = await page.evaluate(() => SSQ_DATA.map(r => r[0]));

  // —— 关键：页面已加载后，再修改磁盘上的 lottery_data.js ——
  const obj = extractObj(originalSrc);
  obj.ssq.unshift([NEW_ISSUE, [1, 2, 3, 4, 5, 6], [7]]);
  obj.updated = '2099-12-31 23:59:59';
  fs.writeFileSync(DATAJS, rebuild(originalSrc, obj), 'utf8');

  // 点击「刷新数据」按钮
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('刷新数据'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('找到并点击了「刷新数据」按钮', clicked);

  // 等待动态重载并把新期合并进 SSQ_DATA
  let after = null;
  try {
    await page.waitForFunction((iss) => SSQ_DATA.some(r => r[0] === iss), NEW_ISSUE, { timeout: 8000 });
    after = await page.evaluate(() => SSQ_DATA.map(r => r[0]));
  } catch (e) { after = await page.evaluate(() => SSQ_DATA.map(r => r[0])); }

  check('刷新后新期号 ' + NEW_ISSUE + ' 已合并进 SSQ_DATA', after && after.includes(NEW_ISSUE));
  check('刷新前不存在该期号（确保是按钮生效，而非加载时）', before && !before.includes(NEW_ISSUE));

  // 验证渲染：最近一期面板应出现新期号
  const rendered = await page.evaluate((iss) => document.body.innerText.includes(iss), NEW_ISSUE);
  check('新期号已渲染到页面（最近一期面板）', rendered);

  // 验证状态提示出现成功或已是最新（非报错）
  const statusText = await page.evaluate(() => {
    const sb = document.getElementById('network-status');
    return sb ? sb.innerText : '';
  });
  check('状态框给出了明确反馈（成功加载 / 已是最新 / 离线指引）',
    /成功加载|已是最新|离线模式|本地/.test(statusText));

  check('无未捕获 JS 异常', errors.length === 0);

  await browser.close();

  // 还原
  fs.writeFileSync(DATAJS, originalSrc, 'utf8');
  if (fs.existsSync(BAK)) fs.unlinkSync(BAK);

  console.log('\n──────────────── file:// 刷新按钮验证 ────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  // 异常时也尽量还原
  try { if (fs.existsSync(BAK)) { fs.copyFileSync(BAK, DATAJS); fs.unlinkSync(BAK); } } catch (_) {}
  console.error('测试异常:', e);
  process.exit(1);
});
