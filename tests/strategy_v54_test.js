// ★v5.4 数据驱动策略 最终验证（file:// 离线，无需联网/服务端）
// 覆盖：加载无异常 / 按钮与策略名 / 回车触发 / 号码合法性 / 基线采样均匀性(χ²) /
//       生成器边际与均匀一致性 / 结构约束符合度 / 期望命中不劣于随机(z检验) /
//       形态贴近真实开奖 / 其它策略回归
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { ROOT } = require('./_env');
const HTML = path.join(ROOT, 'lottery_lib.html');
const loadRaw = (n) => {
  const p = path.join(ROOT, 'data', 'raw_' + n + '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { console.log('  ✅ ' + n + (extra ? ' → ' + extra : '')); pass++; } else { console.log('  ❌ ' + n + (extra ? ' → ' + extra : '')); fail++; } };

(async () => {
  const raw = { ssq: loadRaw('ssq'), dlt: loadRaw('dlt'), qxc: loadRaw('qxc') };
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(require('./_env').fileUrl);
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0 && typeof genSSQ === 'function' && typeof _uniformSampleDistinct === 'function', { timeout: 15000 });

  // ── 1) 按钮与策略名 ──
  const meta = await page.evaluate(() => {
    const b = document.querySelector('#page-ssq .strat-btn[data-s="data"]');
    if (b) b.click();
    return { btns: document.querySelectorAll('.strat-btn[data-s="data"]').length, name: STATE.ssq.lastStrategy, badge: (document.querySelector('.version-badge') || {}).textContent };
  });
  check('三个彩种页均有「📊 数据驱动」按钮', meta.btns === 3, 'count=' + meta.btns);
  check('选中后策略名 = 数据驱动', meta.name === '数据驱动', 'name=' + meta.name);
  check('版本徽章已更新为 v5.4', String(meta.badge).trim() === 'v5.4', 'badge=' + String(meta.badge).trim());

  // ── 2) 回车触发预测（三彩种） ──
  const ent = async (tab, type, n) => {
    await page.evaluate((t) => { const b = [...document.querySelectorAll('.tab-btn')].find(x => (x.getAttribute('onclick') || '').includes(`switchTab('${t}')`)); if (b) b.click(); }, tab);
    await page.evaluate(({ ty, c }) => { document.getElementById(ty + '-count').value = String(c); document.getElementById(ty + '-results').innerHTML = ''; }, { ty: type, c: n });
    await page.focus('#' + type + '-count');
    await page.keyboard.press('Enter');
    return page.waitForFunction(({ ty, c }) => document.querySelectorAll('#' + ty + '-results .result-group').length === c, { ty: type, c: n }, { timeout: 4000 }).then(() => true).catch(() => false);
  };
  check('回车触发 SSQ 预测（生成3组）', await ent('ssq', 'ssq', 3));
  check('回车触发 DLT 预测（生成2组）', await ent('dlt', 'dlt', 2));
  check('回车触发 QXC 预测（生成2组）', await ent('qxc', 'qxc', 2));

  // ── 3) 号码合法性（每彩种 500 次） ──
  const validity = await page.evaluate(() => {
    const N = 500, bad = [];
    const isSorted = a => a.every((v, i) => i === 0 || a[i - 1] <= v);
    const uniq = a => new Set(a).size === a.length;
    const pSSQ = analyzeData(SSQ_DATA, r => r[1], r => r[2], 33, 16, false);
    const pDLT = analyzeData(DLT_DATA, r => r[1], r => r[2], 35, 12, false);
    const pQXC = analyzeData(QXC_DATA, r => r[1], () => [], 9, 0, true);
    for (let i = 0; i < N; i++) {
      const r = genSSQ(pSSQ, 'data');
      if (r.reds.length !== 6 || !r.reds.every(n => n >= 1 && n <= 33) || !uniq(r.reds) || !isSorted(r.reds)) bad.push('ssq.reds@' + i);
      if (r.blues.length !== 1 || !r.blues.every(n => n >= 1 && n <= 16)) bad.push('ssq.blues@' + i);
      if (![r.ac, r.sum, r.span].every(Number.isFinite)) bad.push('ssq.meta@' + i);
      const d = genDLT(pDLT, 'data');
      if (d.reds.length !== 5 || !d.reds.every(n => n >= 1 && n <= 35) || !uniq(d.reds) || !isSorted(d.reds)) bad.push('dlt.reds@' + i);
      if (d.blues.length !== 2 || !d.blues.every(n => n >= 1 && n <= 12) || !uniq(d.blues) || !isSorted(d.blues)) bad.push('dlt.blues@' + i);
      if (![d.ac, d.sum, d.span].every(Number.isFinite)) bad.push('dlt.meta@' + i);
      const q = genQXC(pQXC, 'data');
      if (q.nums.length !== 7) bad.push('qxc.len@' + i);
      if (!q.nums.slice(0, 6).every(n => n >= 0 && n <= 9)) bad.push('qxc.base@' + i);
      if (!(q.nums[6] >= 0 && q.nums[6] <= 14)) bad.push('qxc.special@' + i);
      if (!Number.isFinite(q.ac)) bad.push('qxc.ac@' + i);
    }
    return { badCount: bad.length, sample: bad.slice(0, 8) };
  });
  check('SSQ/DLT/QXC 各500次抽样全部合法（数量/范围/去重/排序/AC）', validity.badCount === 0, validity.badCount ? JSON.stringify(validity.sample) : '0 违规');

  // ── 4) 基线采样器均匀性（χ² 检验，验证"严格等概率"实现无偏） ──
  const unif = await page.evaluate(() => {
    const nums = Array.from({ length: 33 }, (_, i) => i + 1);
    const cnt = new Array(34).fill(0);
    const M = 20000;
    for (let t = 0; t < M; t++) for (const n of _uniformSampleDistinct(nums, 6)) cnt[n]++;
    const total = M * 6, exp = total / 33;
    let chi2 = 0, maxZ = 0;
    for (let n = 1; n <= 33; n++) { chi2 += (cnt[n] - exp) ** 2 / exp; maxZ = Math.max(maxZ, Math.abs((cnt[n] - exp) / Math.sqrt(exp * (1 - 1 / 33)))); }
    return { chi2, z: (chi2 - 32) / Math.sqrt(64), maxZ };
  });
  check('基线采样器 _uniformSampleDistinct 通过 χ² 均匀性检验(|z|<3)', Math.abs(unif.z) < 3, 'χ²z=' + unif.z.toFixed(2) + ', 单号最大|z|=' + unif.maxZ.toFixed(2));

  // ── 5) 生成器边际与均匀的一致性（应接近均匀，无频率/遗漏倾斜） ──
  const marg = await page.evaluate(() => {
    const pSSQ = analyzeData(SSQ_DATA, r => r[1], r => r[2], 33, 16, false);
    const M = 8000, cnt = new Array(34).fill(0);
    for (let t = 0; t < M; t++) for (const n of genSSQ(pSSQ, 'data').reds) cnt[n]++;
    const total = M * 6, exp = total / 33;
    let maxZ = 0, argmax = 0;
    for (let n = 1; n <= 33; n++) { const z = Math.abs((cnt[n] - exp) / Math.sqrt(exp * (1 - 1 / 33))); if (z > maxZ) { maxZ = z; argmax = n; } }
    return { maxZ, argmax, cnt };
  });
  check('数据驱动 SSQ 边际与均匀无显著倾斜（最大|z|<6）', marg.maxZ < 6, '最大|z|=' + marg.maxZ.toFixed(2) + ' @号码' + marg.argmax);

  // ── 6) 结构约束符合度 + 形态贴近真实开奖 ──
  const shape = await page.evaluate(() => {
    const pctl = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * q)))]; };
    const pSSQ = analyzeData(SSQ_DATA, r => r[1], r => r[2], 33, 16, false);
    const real = SSQ_DATA.map(r => r[1]);
    const realSum = real.map(x => x.reduce((a, b) => a + b, 0));
    const realOdd = real.map(x => x.filter(n => n % 2 === 1).length);
    const realAC = real.map(x => calcAC(x));
    const sLo = pctl(realSum, 0.02), sHi = pctl(realSum, 0.98), oLo = pctl(realOdd, 0.02), oHi = pctl(realOdd, 0.98), aLo = pctl(realAC, 0.02), aHi = pctl(realAC, 0.98);
    const M = 3000;
    const gSum = [], gOdd = [], gAC = [], zone3 = [];
    for (let t = 0; t < M; t++) { const r = genSSQ(pSSQ, 'data'); gSum.push(r.sum); gOdd.push(r.reds.filter(x => x % 2 === 1).length); gAC.push(r.ac); zone3.push(new Set(r.reds.map(n => n <= 11 ? 0 : n <= 22 ? 1 : 2)).size); }
    const inBand = (arr, lo, hi) => arr.filter(x => x >= lo && x <= hi).length / arr.length;
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      sumInBand: inBand(gSum, sLo, sHi), oddInBand: inBand(gOdd, oLo, oHi), acInBand: inBand(gAC, aLo, aHi),
      genSum: mean(gSum), realSum: mean(realSum), genOdd: mean(gOdd), realOdd: mean(realOdd), genAC: mean(gAC), realAC: mean(realAC),
      zone3Rate: zone3.filter(z => z === 3).length / M, band: [sLo, sHi, oLo, oHi, aLo, aHi]
    };
  });
  check('生成和值落在真实 P2~P98 带内 ≥95%', shape.sumInBand >= 0.95, (shape.sumInBand * 100).toFixed(1) + '%  带=[' + shape.band[0] + ',' + shape.band[1] + ']');
  check('生成奇数个数落在真实 P2~P98 带内 ≥95%', shape.oddInBand >= 0.95, (shape.oddInBand * 100).toFixed(1) + '%');
  check('生成 AC 值落在真实 P2~P98 带内 ≥90%', shape.acInBand >= 0.90, (shape.acInBand * 100).toFixed(1) + '%');
  check('和值均值贴近真实开奖（差≤5）', Math.abs(shape.genSum - shape.realSum) <= 5, '生成' + shape.genSum.toFixed(1) + ' vs 真实' + shape.realSum.toFixed(1));
  check('奇数均值贴近真实开奖（差≤0.5）', Math.abs(shape.genOdd - shape.realOdd) <= 0.5, '生成' + shape.genOdd.toFixed(2) + ' vs 真实' + shape.realOdd.toFixed(2));
  check('AC 均值贴近真实开奖（差≤1）', Math.abs(shape.genAC - shape.realAC) <= 1, '生成' + shape.genAC.toFixed(2) + ' vs 真实' + shape.realAC.toFixed(2));

  // ── 7) ★核心：期望命中不劣于随机基线（walk-forward 逐期配对 z 检验，全历史） ──
  const ztest = await page.evaluate((RAW) => {
    const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const se = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2)) / (a.length || 1)); };
    const fy = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a.slice(0, k); };
    const REPS = 15, NPER = 120;
    const out = {};
    for (const ty of ['ssq', 'dlt', 'qxc']) {
      const data = RAW[ty]; if (!data || !data.length) { out[ty] = null; continue; }
      const orig = ty === 'ssq' ? SSQ_DATA.slice() : ty === 'dlt' ? DLT_DATA.slice() : QXC_DATA.slice();
      const D = { ssq: SSQ_DATA, dlt: DLT_DATA, qxc: QXC_DATA }[ty];
      const diffs = [];
      let hitG = 0, hitR = 0, cnt = 0;
      for (let rep = 0; rep < REPS; rep++) {
        let g = 0, r = 0, n = 0;
        for (let i = Math.min(NPER, data.length - 1); i >= 0; i--) {
          const hist = data.slice(i + 1);
          if (hist.length < 200) continue;
          const actual = data[i][1];
          D.splice(0, D.length, ...hist);
          const p = ty === 'ssq' ? analyzeData(hist, r2 => r2[1], r2 => r2[2], 33, 16, false)
            : ty === 'dlt' ? analyzeData(hist, r2 => r2[1], r2 => r2[2], 35, 12, false)
              : analyzeData(hist, r2 => r2[1], () => [], 9, 0, true);
          const gen = ty === 'qxc' ? genQXC(p, 'data') : (ty === 'ssq' ? genSSQ(p, 'data') : genDLT(p, 'data'));
          const rp = ty === 'qxc' ? { nums: [...fy(Array.from({ length: 10 }, (_, z) => z), 6), fy(Array.from({ length: 15 }, (_, z) => z), 1)[0]] }
            : ty === 'ssq' ? { reds: fy(Array.from({ length: 33 }, (_, z) => z + 1), 6), blues: [1 + Math.floor(Math.random() * 16)] }
              : { reds: fy(Array.from({ length: 35 }, (_, z) => z + 1), 5), blues: fy(Array.from({ length: 12 }, (_, z) => z + 1), 2) };
          if (ty === 'qxc') {
            g += gen.nums.slice(0, 6).filter((v, k) => v === actual[k]).length;
            r += rp.nums.slice(0, 6).filter((v, k) => v === actual[k]).length;
          } else {
            g += gen.reds.filter(x => actual.includes(x)).length;
            r += rp.reds.filter(x => actual.includes(x)).length;
          }
          n++;
        }
        diffs.push((g - r) / n); hitG += g / n; hitR += r / n; cnt = n;
      }
      D.splice(0, D.length, ...orig);
      const dm = mean(diffs), ds = se(diffs);
      out[ty] = { gen: hitG / REPS, rnd: hitR / REPS, d: dm, se: ds, z: ds > 0 ? dm / ds : 0, nPer: cnt };
    }
    return out;
  }, raw);
  for (const ty of ['ssq', 'dlt', 'qxc']) {
    const z = ztest[ty];
    if (!z) { check(ty.toUpperCase() + ' 期望命中 z 检验', false, '缺少原始数据'); continue; }
    check(ty.toUpperCase() + ' 期望命中不劣于随机基线（|z|<2）', Math.abs(z.z) < 2,
      '数据驱动=' + z.gen.toFixed(4) + ' vs 随机=' + z.rnd.toFixed(4) + '  Δ=' + (z.d >= 0 ? '+' : '') + z.d.toFixed(4) + '±' + z.se.toFixed(4) + '  z=' + z.z.toFixed(2) + '  (' + z.nPer + '期×' + 15 + '轮)');
  }

  // ── 8) 回归：其它策略仍正常 ──
  const reg = await page.evaluate(() => {
    const bad = [];
    const pSSQ = analyzeData(SSQ_DATA, r => r[1], r => r[2], 33, 16, false);
    const pDLT = analyzeData(DLT_DATA, r => r[1], r => r[2], 35, 12, false);
    const pQXC = analyzeData(QXC_DATA, r => r[1], () => [], 9, 0, true);
    for (const s of ['smart', 'data']) {
      for (let i = 0; i < 30; i++) {
        try {
          const r = genSSQ(pSSQ, s); if (!r || r.reds.length !== 6 || new Set(r.reds).size !== 6) bad.push('ssq.' + s);
          const d = genDLT(pDLT, s); if (!d || d.reds.length !== 5 || new Set(d.reds).size !== 5 || !d.blues || d.blues.length !== 2) bad.push('dlt.' + s);
          const q = genQXC(pQXC, s); if (!q || q.nums.length !== 7) bad.push('qxc.' + s);
        } catch (e) { bad.push(s + ':' + e.message); }
      }
    }
    return bad.slice(0, 8);
  });
  check('回归：精简后 smart(传统加权对照) / data(数据驱动) 两策略均正常', reg.length === 0, reg.length ? JSON.stringify(reg) : 'ok');

  check('无未捕获 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n──────────────── v5.4 数据驱动策略 验证 ────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
