// ★最终策略结构验证（高功效，逐期配对）
// 变体：uniform(严格等概率) / shape(自标定P2-P98结构塑形) /
//       shape_overdue(叠加遗漏回补权重) / shape_freq(叠加频率权重)
// 对照：真实数据 vs 同构合成均匀数据（同参数）
// 判定标准：Δ vs 均匀 的 z 值；|z|<2 → 与均匀不可区分（策略不损期望命中）
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

const CFG = {
  ssq: { N: 33, k: 6, zone: n => n <= 11 ? 0 : n <= 22 ? 1 : 2, zoneLo: 2, bl: 16, bk: 1 },
  dlt: { N: 35, k: 5, zone: n => n <= 7 ? 0 : n <= 14 ? 1 : n <= 21 ? 2 : n <= 28 ? 3 : 4, zoneLo: 2, bl: 12, bk: 2 },
};
const MISS_T = { ssq: 10, dlt: 8 };

function calibrate(hist, cfg) {
  const sums = [], acs = [], odds = [];
  for (const row of hist) { const r = row[1]; sums.push(r.reduce((a, b) => a + b, 0)); odds.push(r.filter(x => x % 2 === 1).length); acs.push(calcAC(r)); }
  return { sumLo: pctl(sums, 0.02), sumHi: pctl(sums, 0.98), acLo: pctl(acs, 0.02), acHi: pctl(acs, 0.98), oddLo: pctl(odds, 0.02), oddHi: pctl(odds, 0.98), zoneLo: cfg.zoneLo };
}
function histStats(hist, cfg) {
  const cnt = new Array(cfg.N + 1).fill(0), miss = new Array(cfg.N + 1).fill(0);
  for (const row of hist) for (const v of row[1]) cnt[v]++;
  for (let n = 1; n <= cfg.N; n++) { let m = 0; for (const row of hist) { if (row[1].includes(n)) break; m++; } miss[n] = m; }
  return { cnt, miss };
}
// 加权无放回抽样（页面 _weightedSampleDistinct 同逻辑）
function wSample(nums, weights, k) {
  const pool = nums.map((n, i) => ({ n, w: Math.max(0, weights[i] || 0) })), picked = [];
  for (let t = 0; t < k && pool.length; t++) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let idx;
    if (total <= 0) idx = Math.floor(Math.random() * pool.length);
    else { const r = Math.random() * total; let acc = 0; idx = pool.length - 1; for (let i = 0; i < pool.length; i++) { acc += pool[i].w; if (r <= acc) { idx = i; break; } } }
    picked.push(pool.splice(idx, 1)[0].n);
  }
  return picked;
}
function violOf(pick, cal, cfg, use) {
  let v = 0;
  const sum = pick.reduce((s, n) => s + n, 0), odd = pick.filter(x => x % 2 === 1).length, ac = calcAC(pick);
  if (use.sum && cal.sumLo != null && (sum < cal.sumLo || sum > cal.sumHi)) v++;
  if (use.odd && cal.oddLo != null && (odd < cal.oddLo || odd > cal.oddHi)) v++;
  if (use.ac && cal.acLo != null && (ac < cal.acLo || ac > cal.acHi)) v++;
  if (new Set(pick.map(cfg.zone)).size < cal.zoneLo) v++;
  return v;
}
function genSet(variant, hist, cfg) {
  const nums = Array.from({ length: cfg.N }, (_, i) => i + 1);
  if (variant === 'uniform') return fisherYates(nums, cfg.k).sort((a, b) => a - b);
  const cal = calibrate(hist, cfg);
  const { cnt, miss } = histStats(hist, cfg);
  const MT = MISS_T[cfg === CFG.ssq ? 'ssq' : 'dlt'];
  let weights = nums.map(() => 1);
  if (variant === 'shape_overdue') weights = nums.map(n => miss[n] >= MT ? 3 : 1);
  if (variant === 'shape_freq') weights = nums.map(n => 1 + cnt[n]);
  const use = { sum: true, odd: true, ac: true };
  for (let allow = 0; allow <= 3; allow++) {
    for (let t = 0; t < 40; t++) {
      const pick = (variant === 'uniform') ? fisherYates(nums, cfg.k) : wSample(nums, weights, cfg.k);
      const p = pick.slice().sort((a, b) => a - b);
      if (violOf(p, cal, cfg, use) <= allow) return p;
    }
  }
  return fisherYates(nums, cfg.k).sort((a, b) => a - b);
}
function paired(data, cfg, variants, reps, nPer) {
  const res = {};
  for (const v of variants) res[v] = { hit: [], diff: [] };
  for (let rep = 0; rep < reps; rep++) {
    const acc = {};
    for (const v of variants) acc[v] = { h: 0, n: 0 };
    for (let i = Math.min(nPer, data.length - 1); i >= 0; i--) {
      const hist = data.slice(i + 1);
      if (hist.length < 200) continue;
      const actual = data[i][1];
      for (const v of variants) {
        const pick = genSet(v, hist, cfg);
        acc[v].h += pick.filter(x => actual.includes(x)).length; acc[v].n++;
      }
    }
    for (const v of variants) res[v].hit.push(acc[v].h / acc[v].n);
    const base = res.variantsBase = res.uniform.hit[rep];
    for (const v of variants) if (v !== 'uniform') res[v].diff.push(acc[v].h / acc[v].n - base);
  }
  return res;
}
function synthSSQ(n) { const o = []; for (let i = 0; i < n; i++) o.push(['S' + i, fisherYates(Array.from({ length: 33 }, (_, j) => j + 1), 6).sort((a, b) => a - b)]); return o; }
function synthDLT(n) { const o = []; for (let i = 0; i < n; i++) o.push(['S' + i, fisherYates(Array.from({ length: 35 }, (_, j) => j + 1), 5).sort((a, b) => a - b)]); return o; }

const VARIANTS = ['uniform', 'shape', 'shape_overdue', 'shape_freq'];
const LBL = { uniform: '严格均匀(新基线)', shape: '结构塑形P2-P98', shape_overdue: '结构+遗漏权重', shape_freq: '结构+频率权重' };
const REPS = 40, NPER = 120;

for (const [ty, cfg, real, syn] of [['ssq', CFG.ssq, loadRaw('ssq'), synthSSQ(1200)], ['dlt', CFG.dlt, loadRaw('dlt'), synthDLT(1200)]]) {
  console.log('\n════════════ ' + ty.toUpperCase() + ' ════════════');
  for (const [label, data] of [['真实数据', real], ['合成均匀对照', syn]]) {
    console.log('  【' + label + '】');
    const r = paired(data, cfg, VARIANTS, REPS, NPER);
    const base = r.uniform.hit;
    console.log('    ' + LBL.uniform.padEnd(18) + (mean(base).toFixed(4) + ' ±' + se(base).toFixed(4)).padStart(14) + '   （基线）');
    for (const v of VARIANTS.slice(1)) {
      const dm = mean(r[v].diff), ds = se(r[v].diff);
      console.log('    ' + LBL[v].padEnd(18) + (mean(r[v].hit).toFixed(4)).padStart(14) + '   Δ=' + (dm >= 0 ? '+' : '') + dm.toFixed(4) + ' ±' + ds.toFixed(4) + '   z=' + (dm / ds).toFixed(2));
    }
  }
}

// ── QXC 专项 ──
console.log('\n════════════ QXC 七星彩 ═══════════');
function qxcCalibrate(hist) {
  const sums = [], odds = [];
  for (const row of hist) { const r = row[1]; sums.push(r.reduce((a, b) => a + b, 0)); odds.push(r.filter(x => x % 2 === 1).length); }
  return { sumLo: pctl(sums, 0.02), sumHi: pctl(sums, 0.98), oddLo: pctl(odds, 0.02), oddHi: pctl(odds, 0.98) };
}
function qxcGen(variant, hist) {
  const cal = variant === 'uniform' ? null : qxcCalibrate(hist);
  const pickPos = (pos) => {
    const maxD = pos === 6 ? 14 : 9;
    if (variant === 'shape_overdue' && pos === 6) {
      const seq = (hist[0] && hist[0][1]) ? hist[0][1][6] : null;
      // 特别号：统计遗漏
      const cnt = new Array(15).fill(0);
      for (const row of hist) cnt[row[1][6]]++;
      const w = []; for (let d = 0; d <= 14; d++) w.push(1 + (cnt[d] === 0 ? 2 : 0));
      return wSample(Array.from({ length: 15 }, (_, i) => i), w, 1)[0];
    }
    return Math.floor(Math.random() * (maxD + 1));
  };
  let fallback = null;
  for (let t = 0; t < 60; t++) {
    const cand = Array.from({ length: 7 }, (_, pos) => pickPos(pos));
    const sum = cand.reduce((s, n) => s + n, 0), odd = cand.filter(x => x % 2 === 1).length;
    if (!cal) return cand;
    if (sum >= cal.sumLo && sum <= cal.sumHi && odd >= cal.oddLo && odd <= cal.oddHi) return cand;
    if (!fallback) fallback = cand;
  }
  return fallback;
}
function synthQXC(n) { const o = []; for (let i = 0; i < n; i++) { const a = []; for (let p = 0; p < 6; p++) a.push(Math.floor(Math.random() * 10)); a.push(Math.floor(Math.random() * 15)); o.push(['S' + i, a]); } return o; }
for (const [label, data] of [['真实数据', loadRaw('qxc')], ['合成均匀对照', synthQXC(903)]]) {
  console.log('  【' + label + '】');
  const out = { uniform: { hit: [], diff: [] }, shape: { hit: [], diff: [] }, shape_overdue: { hit: [], diff: [] } };
  for (let rep = 0; rep < REPS; rep++) {
    const acc = { uniform: { h: 0, n: 0 }, shape: { h: 0, n: 0 }, shape_overdue: { h: 0, n: 0 } };
    for (let i = Math.min(NPER, data.length - 1); i >= 0; i--) {
      const hist = data.slice(i + 1);
      if (hist.length < 200) continue;
      const actual = data[i][1];
      for (const v of Object.keys(acc)) {
        const pick = qxcGen(v, hist);
        acc[v].h += pick.slice(0, 6).filter((x, k) => x === actual[k]).length; acc[v].n++;
      }
    }
    for (const v of Object.keys(acc)) out[v].hit.push(acc[v].h / acc[v].n);
    for (const v of ['shape', 'shape_overdue']) out[v].diff.push(acc[v].h / acc[v].n - acc.uniform.h / acc.uniform.n);
  }
  console.log('    ' + '严格均匀(新基线)'.padEnd(18) + (mean(out.uniform.hit).toFixed(4) + ' ±' + se(out.uniform.hit).toFixed(4)).padStart(14) + '   （基线）');
  for (const v of ['shape', 'shape_overdue']) {
    const dm = mean(out[v].diff), ds = se(out[v].diff);
    console.log('    ' + (v === 'shape' ? '结构塑形P2-P98' : '结构+遗漏权重').padEnd(18) + (mean(out[v].hit).toFixed(4)).padStart(14) + '   Δ=' + (dm >= 0 ? '+' : '') + dm.toFixed(4) + ' ±' + ds.toFixed(4) + '   z=' + (dm / ds).toFixed(2));
  }
}
