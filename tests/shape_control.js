// 决定性对照实验：真实数据 vs 同构合成均匀数据，跑完全相同的"自标定结构塑形"策略
// 理论上：若开奖均匀（π≡k/N），任何 q 的期望命中恒为 k²/N → Δ必须为0
// 若合成数据 Δ≈0 而真实数据 Δ<0 → 说明真实数据存在与历史相关的结构（harness无误）
// 若合成数据也 Δ<0 → harness/实现有偏
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./_env');
const loadRaw = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'raw_' + n + '.json'), 'utf8'));

function fisherYates(arr, k) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a.slice(0, k);
}
function calcAC(pick) {
  const s = new Set(pick); let c = 0;
  for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) { const d = Math.abs(pick[i] - pick[j]); if (d !== 0 && !s.has(d)) { c++; s.add(d); } }
  return c;
}
const pctl = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * q)))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const se = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2)) / (a.length || 1)); };

// 自标定：从给定历史标定 结构窗口
function calibrate(hist, zoneLo, qLo, qHi) {
  const sums = [], acs = [], odds = [];
  for (const row of hist) { const r = row[1]; sums.push(r.reduce((a, b) => a + b, 0)); odds.push(r.filter(x => x % 2 === 1).length); acs.push(calcAC(r)); }
  return {
    sumLo: pctl(sums, qLo), sumHi: pctl(sums, qHi),
    acLo: pctl(acs, qLo), acHi: pctl(acs, qHi),
    oddLo: pctl(odds, qLo), oddHi: pctl(odds, qHi),
    zoneLo
  };
}
const zoneSSQ = n => n <= 11 ? 0 : n <= 22 ? 1 : 2;

// 结构塑形采样（与页面 dataGen 同逻辑：违反项逐级放宽）
function shapedPick(N, k, cal, zoneFn) {
  const nums = Array.from({ length: N }, (_, i) => i + 1);
  const viol = (pick) => {
    let v = 0;
    const sum = pick.reduce((s, n) => s + n, 0), odd = pick.filter(n => n % 2 === 1).length, ac = calcAC(pick);
    if (cal.sumLo != null && (sum < cal.sumLo || sum > cal.sumHi)) v++;
    if (cal.oddLo != null && (odd < cal.oddLo || odd > cal.oddHi)) v++;
    if (cal.acLo != null && (ac < cal.acLo || ac > cal.acHi)) v++;
    if (new Set(pick.map(zoneFn)).size < cal.zoneLo) v++;
    return v;
  };
  for (let allow = 0; allow <= 3; allow++) {
    for (let t = 0; t < 40; t++) {
      const pick = fisherYates(nums, k).sort((a, b) => a - b);
      if (viol(pick) <= allow) return pick;
    }
  }
  return fisherYates(nums, k).sort((a, b) => a - b);
}

// 逐期配对实验：每期用同一批历史，分别生成 random 与 shaped，比差值
function pairedExperiment(data, N, k, nPeriods, qLo, qHi, zoneLo, reps) {
  const nums = Array.from({ length: N }, (_, i) => i + 1);
  const diffs = [], hitsR = [], hitsS = [];
  let sn = 0;
  for (let rep = 0; rep < reps; rep++) {
    let sr = 0, ss = 0; sn = 0;
    for (let i = Math.min(nPeriods, data.length - 1); i >= 0; i--) {
      const hist = data.slice(i + 1);
      if (hist.length < 200) continue;
      const actual = data[i][1];
      const cal = calibrate(hist, zoneLo, qLo, qHi);
      const rp = fisherYates(nums, k).sort((a, b) => a - b);
      const sp = shapedPick(N, k, cal, zoneSSQ);
      sr += rp.filter(x => actual.includes(x)).length;
      ss += sp.filter(x => actual.includes(x)).length;
      sn++;
    }
    hitsR.push(sr / sn); hitsS.push(ss / sn);
    diffs.push((ss - sr) / sn);
  }
  const dm = mean(diffs), ds = se(diffs);
  return { d: dm, se: ds, z: ds > 0 ? dm / ds : 0, r: mean(hitsR), s: mean(hitsS), nPer: sn };
}

// 合成同构数据（uniform）
function synth(nPeriods, N, k) {
  const out = [];
  for (let i = 0; i < nPeriods; i++) out.push(['S' + i, fisherYates(Array.from({ length: N }, (_, j) => j + 1), k).sort((a, b) => a - b)]);
  return out;
}

const REPS = 40, PER = 120;
console.log('══════ 决定性对照：结构塑形 vs 均匀（逐期配对, ' + REPS + '轮 × ' + (PER + 1) + '期）══════\n');
const real = loadRaw('ssq');
const syn = synth(1200, 33, 6);

for (const [label, data] of [['真实SSQ数据', real], ['合成均匀数据(对照)', syn]]) {
  console.log('【' + label + '】');
  for (const [qname, qLo, qHi] of [['P2~P98(现状)', 0.02, 0.98], ['P10~P90', 0.10, 0.90], ['P0~P100(无约束)', 0, 1]]) {
    const r = pairedExperiment(data, 33, 6, PER, qLo, qHi, 2, REPS);
    console.log('  窗口' + qName(qname).padEnd(20) + ' random命中=' + r.r.toFixed(4) + '  shaped命中=' + r.s.toFixed(4) + '  Δ=' + (r.d >= 0 ? '+' : '') + r.d.toFixed(4) + '±' + r.se.toFixed(4) + '  z=' + r.z.toFixed(2));
  }
  console.log('');
}
function qName(s) { return s; }
