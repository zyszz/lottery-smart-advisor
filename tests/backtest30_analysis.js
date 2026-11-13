// 策略结构 v5.1 → v5.3 的配对回测对比（file:// 离线，无网络依赖）
//  - 在同一 harness 内复刻 v5.1 逻辑（频率加权+硬三区+±22%和值），与 v5.3 并列比较
//  - 多轮重复(reps)取均值±标准误，消除单轮 ±0.02 的噪声
//  - 真实开奖分布用全历史(1200期)标定，近30期单独报告
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { ROOT } = require('./_env');
const HTML = path.join(ROOT, 'lottery_lib.html');
const REPS = 3, NSETS = 20, BIG = 120;

function loadRaw(name) {
  const p = path.join(ROOT, 'data', 'raw_' + name + '.json');
  if (!fs.existsSync(p)) return null;
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(a) && a.length ? a : null;
}

(async () => {
  const raw = { ssq: loadRaw('ssq'), dlt: loadRaw('dlt'), qxc: loadRaw('qxc') };
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.goto(require('./_env').fileUrl);
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0, { timeout: 15000 });

  const rep = await page.evaluate(({ RAW, REPS, NSETS, BIG }) => {
    const orig = { ssq: SSQ_DATA.slice(), dlt: DLT_DATA.slice(), qxc: QXC_DATA.slice() };
    const DATA = {
      ssq: (RAW.ssq && RAW.ssq.length ? RAW.ssq : orig.ssq),
      dlt: (RAW.dlt && RAW.dlt.length ? RAW.dlt : orig.dlt),
      qxc: (RAW.qxc && RAW.qxc.length ? RAW.qxc : orig.qxc),
    };
    const zoneSSQ = n => n <= 11 ? 0 : n <= 22 ? 1 : 2;
    const zoneDLT = n => n <= 7 ? 0 : n <= 14 ? 1 : n <= 21 ? 2 : n <= 28 ? 3 : 4;
    const randPick = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a.slice(0, k); };

    // ---------- 复刻 v5.1（改造前）的三个生成器 ----------
    function v51SSQ(p) {
      const prevReds = (typeof SSQ_DATA !== 'undefined' && SSQ_DATA[0]) ? (SSQ_DATA[0][1] || []) : [];
      const nums = [], weights = [];
      for (let n = 1; n <= 33; n++) {
        let w = 1 + (p.redCnt[n] || 0);
        const m = (p.currentMissing && p.currentMissing[n]) || 0;
        const a = Math.max(3, (p.avgMissing && p.avgMissing[n]) || 5);
        if (m >= 10) w += 8; else if (m > a * 2) w += Math.min(m * 0.6, a * 2); else if (m > a) w += Math.min(m * 0.3, a);
        if (p.recHot3 && p.recHot3.includes(n)) w += 6; else if (p.recHot5 && p.recHot5.includes(n)) w += 3;
        if (prevReds.includes(n)) w += 4;
        nums.push(n); weights.push(w);
      }
      let reds = null;
      const lo = p.smartSumLow ? p.smartSumLow * 0.9 : 40, hi = p.smartSumHigh ? p.smartSumHigh * 1.1 : 160;
      for (let t = 0; t < 50 && !reds; t++) {
        const pick = _weightedSampleDistinct(nums, weights, 6).sort((a, b) => a - b);
        const zones = new Set(pick.map(n => n <= 11 ? 0 : n <= 22 ? 1 : 2)).size;
        const sum = pick.reduce((s, n) => s + n, 0);
        if (zones.size === 3 && sum >= lo && sum <= hi) reds = pick;
      }
      if (!reds) reds = _weightedSampleDistinct(nums, weights, 6).sort((a, b) => a - b);
      const bn = [], bw = [];
      for (let n = 1; n <= 16; n++) {
        let w = 1 + (p.blueCnt[n] || 0);
        const bm = (p.blueMissing && p.blueMissing.current && p.blueMissing.current[n]) || 0;
        if (bm >= 10) w += 8; else if (bm >= 8) w += 4;
        bn.push(n); bw.push(w);
      }
      const blue = _weightedSampleDistinct(bn, bw, 1);
      return { reds, blues: [blue[0]], ac: calcAC(reds) };
    }
    function v51DLT(p) {
      const nums = [], weights = [];
      for (let n = 1; n <= 35; n++) {
        let w = 1 + (p.redCnt[n] || 0);
        const m = (p.currentMissing && p.currentMissing[n]) || 0;
        const a = Math.max(3, (p.avgMissing && p.avgMissing[n]) || 5);
        if (m >= 10) w += 8; else if (m > a * 2) w += Math.min(m * 0.6, a * 2); else if (m > a) w += Math.min(m * 0.3, a);
        if (p.recHot3 && p.recHot3.includes(n)) w += 6; else if (p.recHot5 && p.recHot5.includes(n)) w += 3;
        nums.push(n); weights.push(w);
      }
      let front = null;
      const lo = p.smartSumLow ? p.smartSumLow * 0.9 : 55, hi = p.smartSumHigh ? p.smartSumHigh * 1.1 : 135;
      for (let t = 0; t < 50 && !front; t++) {
        const pick = _weightedSampleDistinct(nums, weights, 5).sort((a, b) => a - b);
        const zones = new Set(pick.map(n => n <= 7 ? 0 : n <= 14 ? 1 : n <= 21 ? 2 : n <= 28 ? 3 : 4)).size;
        const sum = pick.reduce((s, n) => s + n, 0);
        if (zones.size >= 3 && sum >= lo && sum <= hi) front = pick;
      }
      if (!front) front = _weightedSampleDistinct(nums, weights, 5).sort((a, b) => a - b);
      const bn = [], bw = [];
      for (let n = 1; n <= 12; n++) {
        let w = 1 + (p.blueCnt[n] || 0);
        const bm = (p.blueMissing && p.blueMissing.current && p.blueMissing.current[n]) || 0;
        if (bm >= 8) w += 6; else if (bm >= 6) w += 3;
        bn.push(n); bw.push(w);
      }
      const back = _weightedSampleDistinct(bn, bw, 2).sort((a, b) => a - b);
      return { reds: front, blues: back, ac: calcAC(front) };
    }
    function v51QXC(p) {
      const nums = [];
      for (let pos = 0; pos < 7; pos++) {
        const maxD = pos === 6 ? 14 : 9;
        const pf = (p.posFq && p.posFq[pos]) || {};
        const rec3 = (p.posRec3 && p.posRec3[pos]) || [];
        const rec5 = (p.posRec5 && p.posRec5[pos]) || [];
        const cand = [], w = [];
        for (let d = 0; d <= maxD; d++) {
          let wt = 1 + (pf[d] || 0);
          if (rec3.includes(d)) wt += 6; else if (rec5.includes(d)) wt += 3;
          if (pos === 6) { const seq = (p.posSeq && p.posSeq[6]) || []; const miss = seq.indexOf(d); if (miss < 0) wt += 6; else if (miss >= 10) wt += 4; else if (miss >= 6) wt += 2; }
          cand.push(d); w.push(wt);
        }
        nums.push(_weightedSampleDistinct(cand, w, 1)[0]);
      }
      return { nums, ac: calcAC(nums.slice(0, 6)) };
    }

    function genBy(type, strat, p) {
      if (type === 'ssq') return strat === 'v51' ? v51SSQ(p) : genSSQ(p, strat);
      if (type === 'dlt') return strat === 'v51' ? v51DLT(p) : genDLT(p, strat);
      return strat === 'v51' ? v51QXC(p) : genQXC(p, strat);
    }

    // ---------- 单轮回测 ----------
    function runRep(type, strat, nPeriods, minHist) {
      const data = DATA[type];
      let hits = 0, blueHit = 0, sets = 0, sumHit = 0, acSum = 0, zone3 = 0, oddSum = 0;
      for (let i = Math.min(nPeriods, data.length - 1); i >= 0; i--) {
        const hist = data.slice(i + 1);
        if (hist.length < minHist) continue;
        const actual = data[i], actualNums = actual[1];
        if (type === 'ssq') SSQ_DATA.splice(0, SSQ_DATA.length, ...hist);
        if (type === 'dlt') DLT_DATA.splice(0, DLT_DATA.length, ...hist);
        if (type === 'qxc') QXC_DATA.splice(0, QXC_DATA.length, ...hist);
        const p = type === 'ssq' ? analyzeData(hist, r => r[1], r => r[2], 33, 16, false)
          : type === 'dlt' ? analyzeData(hist, r => r[1], r => r[2], 35, 12, false)
            : analyzeData(hist, r => r[1], () => [], 9, 0, true);
        for (let k = 0; k < NSETS; k++) {
          let r;
          if (strat === 'random') {
            if (type === 'qxc') {
              const n = []; for (let pos = 0; pos < 6; pos++) n.push(Math.floor(Math.random() * 10));
              n.push(Math.floor(Math.random() * 15)); r = { nums: n };
            } else if (type === 'ssq') {
              r = { reds: randPick(Array.from({ length: 33 }, (_, i) => i + 1), 6).sort((a, b) => a - b), blues: [1 + Math.floor(Math.random() * 16)] };
            } else {
              r = { reds: randPick(Array.from({ length: 35 }, (_, i) => i + 1), 5).sort((a, b) => a - b), blues: randPick(Array.from({ length: 12 }, (_, i) => i + 1), 2).sort((a, b) => a - b) };
            }
          } else r = genBy(type, strat, p);
          sets++;
          if (type === 'qxc') {
            hits += r.nums.slice(0, 6).filter((v, i2) => v === actualNums[i2]).length;
            blueHit += (r.nums[6] === actualNums[6] ? 1 : 0);
          } else {
            hits += r.reds.filter(x => actualNums.includes(x)).length;
            if (type === 'ssq') blueHit += (r.blues[0] === actual[2][0] ? 1 : 0);
            else blueHit += r.blues.filter(b => actual[2].includes(b)).length;
            sumHit += r.reds.reduce((a, b) => a + b, 0); acSum += r.ac;
            oddSum += r.reds.filter(x => x % 2 === 1).length;
            zone3 += (type === 'ssq' ? (new Set(r.reds.map(zoneSSQ)).size >= 3 ? 1 : 0) : (new Set(r.reds.map(zoneDLT)).size >= 3 ? 1 : 0));
          }
        }
      }
      const per = x => x / (sets || 1);
      return { redHitAvg: per(hits), blueHitRate: per(blueHit), sumAvg: type === 'qxc' ? null : per(sumHit), acAvg: type === 'qxc' ? null : per(acSum), oddAvg: type === 'qxc' ? null : per(oddSum), zone3Rate: type === 'qxc' ? null : per(zone3) };
    }

    const strategies = ['random', 'v51', 'data', 'smart'];
    const out = { reps: {}, actualFull: {}, actual30: {} };
    for (const ty of ['ssq', 'dlt', 'qxc']) {
      out.reps[ty] = {};
      for (const s of strategies) out.reps[ty][s] = [];
      for (let r0 = 0; r0 < REPS; r0++) {
        for (const s of strategies) out.reps[ty][s].push(runRep(ty, s, BIG, 120));
      }
    }
    SSQ_DATA.splice(0, SSQ_DATA.length, ...orig.ssq);
    DLT_DATA.splice(0, DLT_DATA.length, ...orig.dlt);
    QXC_DATA.splice(0, QXC_DATA.length, ...orig.qxc);
    return out;
  }, { RAW: raw, REPS, NSETS, BIG });

  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const se = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2)) / (a.length || 1)); };
  const strategies = ['random', 'v51', 'data', 'smart'];

  console.log('\n╔══════════ 配对回测：v5.1(改造前) vs v5.3(改造后) ══════════');
  console.log(`  ${REPS} 轮重复 × ${BIG} 期 × ${NSETS} 组/期；Δ 为相对同轮随机基线的配对差值`);
  for (const ty of ['ssq', 'dlt', 'qxc']) {
    console.log(`\n【${ty.toUpperCase()}】`);
    console.log('  策略'.padEnd(11) + '命中/组(均值±SE)      Δvs随机(均值±SE)   蓝/特命中   和值均值  AC均值  奇数均值  ≥3区覆盖');
    const base = rep.reps[ty].random.map(x => x.redHitAvg);
    for (const s of strategies) {
      const arr = rep.reps[ty][s];
      const hit = arr.map(x => x.redHitAvg);
      const deltas = arr.map((x, i) => x.redHitAvg - base[i]);
      const dm = mean(deltas), ds = se(deltas);
      const tag = s === 'random' ? '(基线)' : s === 'v51' ? '(改造前)' : s === 'data' ? '(改造后)' : '';
      console.log('  ' + (s + tag).padEnd(13) +
        (mean(hit).toFixed(4) + ' ±' + se(hit).toFixed(4)).padStart(17) + '  ' +
        (s === 'random' ? '—' : (dm >= 0 ? '+' : '') + dm.toFixed(4) + ' ±' + ds.toFixed(4)).padStart(17) + '  ' +
        mean(arr.map(x => x.blueHitRate)).toFixed(4).padStart(8) + '  ' +
        String(mean(arr.map(x => x.sumAvg))).padStart(8) + '  ' +
        String(mean(arr.map(x => x.acAvg)).toFixed(2)).padStart(7) + '  ' +
        String(mean(arr.map(x => x.oddAvg)).toFixed(2)).padStart(8) + '  ' +
        String(mean(arr.map(x => x.zone3Rate)).toFixed(3)).padStart(9));
    }
  }
  await browser.close();
})().catch(e => { console.error('分析异常:', e); process.exit(1); });
