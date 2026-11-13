// 边际概率 π(x) 分析：判定真实开奖是否偏离均匀，并据此评估各候选策略的理论期望命中
// 关键恒等式：E[命中数] = Σ_x π(x)·q(x)
//   π(x) = 真实开奖中号码 x 出现的概率；q(x) = 策略选中 x 的概率
//   若 π ≡ k/N（完全均匀）⇒ 任何 q 的期望命中恒为 k²/N（策略无法超越随机）
//   若 π 非均匀 ⇒ 最优 q ∝ π，可通过"频率/结构塑形"真正提升期望
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
  for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) {
    const d = Math.abs(pick[i] - pick[j]); if (d !== 0 && !s.has(d)) { c++; s.add(d); }
  }
  return c;
}
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const se = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2)) / (a.length || 1)); };

// ── 1. π(x) 估计与均匀性检验 ──
function marginal(data, N, k, slotOf) {
  const c = new Array(N + 1).fill(0);
  for (const row of data) for (const v of row[1]) c[v]++;
  const p = c.map(x => x / data.length);      // p[0] 未用
  const expect = k / N;
  const obs = [];
  for (let n = 1; n <= N; n++) obs.push({ n, rate: p[n], exp: expect, z: (p[n] - expect) / Math.sqrt(expect * (1 - expect) / data.length) });
  // 卡方：是否偏离均匀
  let chi2 = 0;
  for (const o of obs) chi2 += (o.rate - expect) ** 2 / (expect * (1 - expect) / data.length);
  return { p, obs, chi2, df: N - 1, chi2z: (chi2 - (N - 1)) / Math.sqrt(2 * (N - 1)) };
}

// ── 2. 用实测 π 计算各候选策略的理论期望命中 ──
function evalQ(q, pi, N) {
  let e = 0;
  for (let n = 1; n <= N; n++) e += pi[n] * q[n];
  return e;
}
// q 采样器：返回 q(x) 向量
function qUniform(N) { const q = new Array(N + 1).fill(0); for (let n = 1; n <= N; n++) q[n] = 1 / N; return q; }
// q 加权：对号码 n 权重 w[n]，则 q(n) ≈ w[n]/Σw （不放回抽样的一阶近似）
function qWeighted(N, w) { const q = new Array(N + 1).fill(0); let s = 0; for (let n = 1; n <= N; n++) s += w[n]; for (let n = 1; n <= N; n++) q[n] = w[n] / s; return q; }
// q 区间塑形：模拟 band 条件下的经验分布（采样 M 次求频率）
function qShaped(N, k, bandFn, M = 200000) {
  const cnt = new Array(N + 1).fill(0); let tot = 0;
  const nums = Array.from({ length: N }, (_, i) => i + 1);
  for (let t = 0; t < M; t++) {
    const pick = fisherYates(nums, k).sort((a, b) => a - b);
    if (bandFn(pick)) { for (const v of pick) { cnt[v]++; tot++; } }
  }
  const q = new Array(N + 1).fill(0);
  for (let n = 1; n <= N; n++) q[n] = cnt[n] / (tot || 1);
  return q;
}

function analyzeSSQ() {
  const data = loadRaw('ssq'), N = 33, k = 6;
  console.log('\n════════ SSQ 双色球 (1200期, 33选6) ════════');
  const m = marginal(data, N, k);
  console.log('【π(x) 均匀性】χ²=' + m.chi2.toFixed(1) + ' (df=' + m.df + ')  标准化 z=' + m.chi2z.toFixed(2) + '   ' + (Math.abs(m.chi2z) < 2 ? '→ 与均匀不可区分 ✅' : '→ 偏离均匀 ⚠️'));
  const zs = m.obs.map(o => o.z).sort((a, b) => b - a);
  console.log('  单号码最大 |z|: +' + zs[0].toFixed(2) + ' / -' + Math.abs(zs[zs.length - 1]).toFixed(2) + '   (33个号码多重检验下 |z|>3 属正常极值)');
  console.log('  最高π号码: ' + m.obs.slice().sort((a, b) => b.rate - a.rate).slice(0, 5).map(o => o.n + '(' + (o.rate * 100).toFixed(1) + '%)').join(' '));
  console.log('  最低π号码: ' + m.obs.slice().sort((a, b) => a.rate - b.rate).slice(0, 5).map(o => o.n + '(' + (o.rate * 100).toFixed(1) + '%)').join(' '));

  // 理论期望命中
  const pi = m.p;
  const E_unif = evalQ(qUniform(N), pi, N);
  // 结构塑形（按实测 P2~P98 和值带 + 奇偶 2~4 + AC 5~9 + ≥3区）
  const sums = [], odds = [], acs = [];
  for (const row of data) { const r = row[1]; sums.push(r.reduce((a, b) => a + b, 0)); odds.push(r.filter(x => x % 2 === 1).length); acs.push(calcAC(r)); }
  const pctl = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * q)))]; };
  const sLo = pctl(sums, 0.02), sHi = pctl(sums, 0.98), oLo = pctl(odds, 0.02), oHi = pctl(odds, 0.98), aLo = pctl(acs, 0.02), aHi = pctl(acs, 0.98);
  console.log('  实测结构窗口 P2~P98: 和值[' + sLo + ',' + sHi + '] 奇偶[' + oLo + ',' + oHi + '] AC[' + aLo + ',' + aHi + ']');
  const zone = n => n <= 11 ? 0 : n <= 22 ? 1 : 2;
  const bandFn = (pick) => {
    const s = pick.reduce((a, b) => a + b, 0), o = pick.filter(x => x % 2 === 1).length, ac = calcAC(pick);
    return s >= sLo && s <= sHi && o >= oLo && o <= oHi && ac >= aLo && ac <= aHi && new Set(pick.map(zone)).size >= 2;
  };
  const qShape = qShaped(N, k, bandFn);
  const qFreq = qWeighted(N, (() => { const w = new Array(N + 1).fill(0); for (let n = 1; n <= N; n++) w[n] = 1 + pi[n] * 600; return w; })());
  const qOverdue = qWeighted(N, (() => {
    const w = new Array(N + 1).fill(1);
    for (let n = 1; n <= N; n++) { let m2 = 0; for (const row of data) { if (row[1].includes(n)) break; m2++; } if (m2 >= 10) w[n] += 2; }
    return w;
  })());
  console.log('\n【理论期望命中 E=Σπ(x)·q(x)】（用全历史实测π）');
  console.log('  均匀基线(随机等价)      E=' + E_unif.toFixed(5));
  console.log('  结构塑形(P2-P98带)      E=' + evalQ(qShape, pi, N).toFixed(5) + '   Δ=' + (evalQ(qShape, pi, N) - E_unif).toFixed(5));
  console.log('  频率加权(∝π)            E=' + evalQ(qFreq, pi, N).toFixed(5) + '   Δ=' + (evalQ(qFreq, pi, N) - E_unif).toFixed(5));
  console.log('  遗漏回补加权            E=' + evalQ(qOverdue, pi, N).toFixed(5) + '   Δ=' + (evalQ(qOverdue, pi, N) - E_unif).toFixed(5));
  console.log('  理论上限(q=π)           E=' + evalQ(qWeighted(N, pi.map((v, i) => i === 0 ? 0 : v)), pi, N).toFixed(5) + '   Δ=' + (evalQ(qWeighted(N, pi.map((v, i) => i === 0 ? 0 : v)), pi, N) - E_unif).toFixed(5));
  return { data, N, k };
}

// ── 3. 样本外验证：π 的持久性（前半段估π → 后半段评测）──
function outOfSample(data, N, k) {
  const half = Math.floor(data.length / 2);
  const est = (rows) => { const c = new Array(N + 1).fill(0); for (const r of rows) for (const v of r[1]) c[v]++; return c.map(x => x / rows.length); };
  const piTrain = est(data.slice(0, half));        // 近端（最新一半）
  const piTest = est(data.slice(half));            // 远端（更早一半）
  const piAll = est(data);
  const q = (pi) => { const qv = new Array(N + 1).fill(0); let s = 0; for (let n = 1; n <= N; n++) s += pi[n]; for (let n = 1; n <= N; n++) qv[n] = pi[n] / s; return qv; };
  const E_train_on_test = evalQ(q(piTrain), piTest, N);
  const E_unif_on_test = evalQ(qUniform(N), piTest, N);
  const E_all_on_test = evalQ(q(piAll), piTest, N);
  console.log('  样本外：用近端半数估的π 去预测远端半数  E=' + E_train_on_test.toFixed(5) + '  (均匀基线 ' + E_unif_on_test.toFixed(5) + ', Δ=' + (E_train_on_test - E_unif_on_test).toFixed(5) + ')');
  console.log('  样本内(全量π预测自身)                E=' + E_all_on_test.toFixed(5) + '  Δ=' + (E_all_on_test - E_unif_on_test).toFixed(5) + '  ← 样本内外差距=过拟合幅度');
}

const { data, N, k } = analyzeSSQ();
outOfSample(data, N, k);

// DLT / QXC 同样处理
for (const [nm, NN, KK, maxd] of [['dlt', 35, 5, null], ['qxc', 10, 6, null]]) {
  const d = loadRaw(nm);
  console.log('\n════════ ' + nm.toUpperCase() + ' (' + d.length + '期) ════════');
  if (nm === 'qxc') {
    // QXC 逐位边际
    const posRate = [];
    for (let pos = 0; pos < 7; pos++) {
      const maxD = pos === 6 ? 14 : 9;
      const c = new Array(maxD + 1).fill(0);
      for (const row of d) c[row[1][pos]]++;
      const p = c.map(x => x / d.length);
      const expect = 1 / (maxD + 1);
      let chi2 = 0; for (const v of p) chi2 += (v - expect) ** 2 / (expect * (1 - expect) / d.length);
      const z = (chi2 - maxD) / Math.sqrt(2 * maxD);
      console.log('  位' + (pos + 1) + ' χ²z=' + z.toFixed(2) + '  最高频数字=' + p.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0] + '(' + (x[1] * 100).toFixed(1) + '%)').join(' '));
    }
  } else {
    const m = marginal(d, NN, KK);
    console.log('【π(x) 均匀性】χ²=' + m.chi2.toFixed(1) + ' (df=' + m.df + ')  z=' + m.chi2z.toFixed(2) + '   ' + (Math.abs(m.chi2z) < 2 ? '→ 与均匀不可区分 ✅' : '→ 偏离均匀 ⚠️'));
    const E = evalQ(qUniform(NN), m.p, NN);
    const qF = qWeighted(NN, m.p.map((v, i) => i === 0 ? 0 : v));
    console.log('  均匀基线 E=' + E.toFixed(5) + '   频率∝π E=' + evalQ(qF, m.p, NN).toFixed(5) + '   Δ=' + (evalQ(qF, m.p, NN) - E).toFixed(5));
    outOfSample(d, NN, KK);
  }
}
