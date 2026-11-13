// 策略结构消融实验：定位哪些约束在拉低期望命中（file:// 离线）
//  变体：random基线 / v51(改造前) / d_full(现状: 和值+奇偶+AC+区间) /
//        d_noOdd / d_noAC / d_noSum / d_none(纯均匀，理论最优)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { ROOT } = require('./_env');
const HTML = path.join(ROOT, 'lottery_lib.html');
const REPS = 8, NSETS = 20, BIG = 120;

const loadRaw = (n) => { const p = path.join(ROOT, 'data', 'raw_' + n + '.json'); if (!fs.existsSync(p)) return null; const a = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(a) && a.length ? a : null; };

(async () => {
  const raw = { ssq: loadRaw('ssq'), dlt: loadRaw('dlt'), qxc: loadRaw('qxc') };
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-proxy-server', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.goto(require('./_env').fileUrl);
  await page.waitForFunction(() => typeof SSQ_DATA !== 'undefined' && SSQ_DATA.length > 0, { timeout: 15000 });

  const rep = await page.evaluate(({ RAW, REPS, NSETS, BIG }) => {
    const orig = { ssq: SSQ_DATA.slice(), dlt: DLT_DATA.slice(), qxc: QXC_DATA.slice() };
    const DATA = { ssq: RAW.ssq || orig.ssq, dlt: RAW.dlt || orig.dlt, qxc: RAW.qxc || orig.qxc };
    const zoneSSQ = n => n <= 11 ? 0 : n <= 22 ? 1 : 2;
    const zoneDLT = n => n <= 7 ? 0 : n <= 14 ? 1 : n <= 21 ? 2 : n <= 28 ? 3 : 4;
    const randPick = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a.slice(0, k); };

    // v5.1 复刻（改造前）
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
      for (let n = 1; n <= 16; n++) { let w = 1 + (p.blueCnt[n] || 0); const bm = (p.blueMissing && p.blueMissing.current && p.blueMissing.current[n]) || 0; if (bm >= 10) w += 8; else if (bm >= 8) w += 4; bn.push(n); bw.push(w); }
      const blue = _weightedSampleDistinct(bn, bw, 1);
      return { reds, blues: [blue[0]], ac: calcAC(reds) };
    }
    function v51DLT(p) {
      const nums = [], weights = [];
      for (let n = 1; n <= 35; n++) {
        let w = 1 + (p.redCnt[n] || 0);
        const m = (p.currentMissing && p.currentMissing[n]) || 0;
        const a = Math.max(3, (p.avgMissing && p.avgMissing[n]) || 5);
        if (m >= 10) w += 8; else if ( m > a * 2) w += Math.min(m * 0.6, a * 2); else if (m > a) w += Math.min(m * 0.3, a);
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
      for (let n = 1; n <= 12; n++) { let w = 1 + (p.blueCnt[n] || 0); const bm = (p.blueMissing && p.blueMissing.current && p.blueMissing.current[n]) || 0; if (bm >= 8) w += 6; else if (bm >= 6) w += 3; bn.push(n); bw.push(w); }
      const back = _weightedSampleDistinct(bn, bw, 2).sort((a, b) => a - b);
      return { reds: front, blues: back, ac: calcAC(front) };
    }
    function v51QXC(p) {
      const nums = [];
      for (let pos = 0; pos < 7; pos++) {
        const maxD = pos === 6 ? 14 : 9;
        const pf = (p.posFq && p.posFq[pos]) || {};
        const rec3 = (p.posRec3 && p.posRec3[pos]) || [], rec5 = (p.posRec5 && p.posRec5[pos]) || [];
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

    const OPTS = {
      d_full:  { sum: true,  odd: true,  ac: true,  zone: true },
      d_noOdd: { sum: true,  odd: false, ac: true,  zone: true },
      d_noAC:  { sum: true,  odd: true,  ac: false, zone: true },
      d_noSum: { sum: false, odd: true,  ac: true,  zone: true },
      d_none:  { sum: false, odd: false, ac: false, zone: false },
    };
    function genBy(type, strat, p) {
      if (strat === 'v51') return type === 'ssq' ? v51SSQ(p) : type === 'dlt' ? v51DLT(p) : v51QXC(p);
      if (OPTS[strat]) {
        const o = OPTS[strat];
        return type === 'ssq' ? dataGenSSQ(p, o) : type === 'dlt' ? dataGenDLT(p, o) : dataGenQXC(p, o);
      }
      return type === 'ssq' ? genSSQ(p, strat) : type === 'dlt' ? genDLT(p, strat) : genQXC(p, strat);
    }

    function runRep(type, strat, nPeriods, minHist) {
      const data = DATA[type];
      let hits = 0, sets = 0, sumHit = 0, acSum = 0, zone3 = 0, oddSum = 0;
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
            if (type === 'qxc') { const n = []; for (let p2 = 0; p2 < 6; p2++) n.push(Math.floor(Math.random() * 10)); n.push(Math.floor(Math.random() * 15)); r = { nums: n }; }
            else if (type === 'ssq') r = { reds: randPick(Array.from({ length: 33 }, (_, i) => i + 1), 6).sort((a, b) => a - b), blues: [1 + Math.floor(Math.random() * 16)] };
            else r = { reds: randPick(Array.from({ length: 35 }, (_, i) => i + 1), 5).sort((a, b) => a - b), blues: randPick(Array.from({ length: 12 }, (_, i) => i + 1), 2).sort((a, b) => a - b) };
          } else r = genBy(type, strat, p);
          sets++;
          if (type === 'qxc') hits += r.nums.slice(0, 6).filter((v, i2) => v === actualNums[i2]).length;
          else {
            hits += r.reds.filter(x => actualNums.includes(x)).length;
            sumHit += r.reds.reduce((a, b) => a + b, 0); acSum += r.ac;
            oddSum += r.reds.filter(x => x % 2 === 1).length;
            zone3 += (type === 'ssq' ? (new Set(r.reds.map(zoneSSQ)).size >= 3 ? 1 : 0) : (new Set(r.reds.map(zoneDLT)).size >= 3 ? 1 : 0));
          }
        }
      }
      const per = x => x / (sets || 1);
      return { redHitAvg: per(hits), sumAvg: type === 'qxc' ? null : per(sumHit), acAvg: type === 'qxc' ? null : per(acSum), oddAvg: type === 'qxc' ? null : per(oddSum), zone3Rate: type === 'qxc' ? null : per(zone3) };
    }

    const strategies = ['random', 'v51', 'd_full', 'd_noOdd', 'd_noAC', 'd_noSum', 'd_none'];
    const out = { reps: {} };
    for (const ty of ['ssq', 'dlt', 'qxc']) {
      out.reps[ty] = {};
      for (const s of strategies) out.reps[ty][s] = [];
      for (let r0 = 0; r0 < REPS; r0++) for (const s of strategies) out.reps[ty][s].push(runRep(ty, s, BIG, 120));
    }
    SSQ_DATA.splice(0, SSQ_DATA.length, ...orig.ssq);
    DLT_DATA.splice(0, DLT_DATA.length, ...orig.dlt);
    QXC_DATA.splice(0, QXC_DATA.length, ...orig.qxc);
    return out;
  }, { RAW: raw, REPS, NSETS, BIG });

  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const se = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2)) / (a.length || 1)); };
  const LBL = { random: 'random基线', v51: 'v5.1改造前', d_full: '现状(全约束)', d_noOdd: '去奇偶约束', d_noAC: '去AC约束', d_noSum: '去和值约束', d_none: '纯均匀(理论最优)' };

  console.log(`\n╔══ 消融实验：${REPS}轮 × ${BIG}期 × ${NSETS}组 ══`);
  for (const ty of ['ssq', 'dlt', 'qxc']) {
    console.log(`\n【${ty.toUpperCase()}】`);
    console.log('  变体'.padEnd(17) + '命中/组(均值±SE)     Δvs随机(均值±SE)   z值    和值均值  AC均值  奇数均值  ≥3区覆盖');
    const base = rep.reps[ty].random.map(x => x.redHitAvg);
    for (const s of Object.keys(rep.reps[ty])) {
      const arr = rep.reps[ty][s];
      const hit = arr.map(x => x.redHitAvg);
      const deltas = arr.map((x, i) => x.redHitAvg - base[i]);
      const dm = mean(deltas), ds = se(deltas);
      const z = ds > 0 ? dm / ds : 0;
      console.log('  ' + LBL[s].padEnd(16) +
        (mean(hit).toFixed(4) + ' ±' + se(hit).toFixed(4)).padStart(16) + '  ' +
        (s === 'random' ? '—' : (dm >= 0 ? '+' : '') + dm.toFixed(4) + ' ±' + ds.toFixed(4)).padStart(18) + '  ' +
        (s === 'random' ? '—' : z.toFixed(2)).padStart(6) + '  ' +
        String(mean(arr.map(x => x.sumAvg))).padStart(8) + '  ' +
        String(mean(arr.map(x => x.acAvg)).toFixed(2)).padStart(7) + '  ' +
        String(mean(arr.map(x => x.oddAvg)).toFixed(2)).padStart(8) + '  ' +
        String(mean(arr.map(x => x.zone3Rate)).toFixed(3)).padStart(9));
    }
  }
  await browser.close();
})().catch(e => { console.error('分析异常:', e); process.exit(1); });
