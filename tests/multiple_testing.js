// tests/multiple_testing.js —— 多重比较校正（Bonferroni / Benjamini-Hochberg FDR）
//
// 为什么需要：本项目历次回测用 |z|<2 判定「与随机不可区分」，但一次实验里会同时检验
// 多个策略 × 多个变体，m 次检验下出现假阳性的概率约为 1-(1-0.05)^m。
// 单次偶发 |z|>2 若不校正，很容易被误读成「发现信号」。
//
// 本脚本用固定种子的 PRNG 重跑一轮轻量逐期配对实验，得到每个变体的 z 与双侧 p，
// 再做 Bonferroni 与 BH-FDR 校正，验证「校正后无任何显著项」与理论 E 恒等式一致。
// 固定种子使 CI 结果可复现，不会因抽样噪声随机变红。
//
// 用法：node tests/multiple_testing.js
const fs = require('fs');
const { rawPath } = require('./_env');

// ---- 可复现 PRNG ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let RND = mulberry32(20261113);
const rf = () => RND();
const ri = (n) => Math.floor(rf() * n);

// ---- 统计工具 ----
function erf(x) { // Abramowitz-Stegun 7.1.26，x>=0
  const t = 1 / (1 + 0.3275911 * x);
  const poly = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t;
  return 1 - poly * Math.exp(-x * x);
}
const twoSidedP = (z) => Math.max(0, 1 - erf(Math.abs(z) / Math.SQRT2));
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const pctl = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * q)))]; };

function bonferroni(ps, alpha) {
  const thr = alpha / ps.length;
  return { threshold: thr, significant: ps.filter(p => p <= thr).length };
}
function bhFdr(ps, alpha) {
  const m = ps.length;
  const sorted = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let k = 0;
  for (let j = 0; j < m; j++) if (sorted[j].p <= (j + 1) / m * alpha) k = j + 1;
  const cutoff = k ? sorted[k - 1].p : 0;
  return { k, cutoff, significant: k };
}

// ---- 号码工具 ----
const NUMS = Array.from({ length: 33 }, (_, i) => i + 1);
function fisherYates(arr, k) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a.slice(0, k);
}
function weighted(nums, w, k) { // 无放回加权抽样
  const pool = nums.map((n, i) => ({ n, w: Math.max(0, w[i] || 0) }));
  const out = [];
  for (let t = 0; t < k && pool.length; t++) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let idx = ri(pool.length);
    if (total > 0) {
      let r = rf() * total, acc = 0;
      idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) { acc += pool[i].w; if (r <= acc) { idx = i; break; } }
    }
    out.push(pool.splice(idx, 1)[0].n);
  }
  return out;
}
const calcAC = (p) => {
  const s = new Set(p), seen = new Set(); let c = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const d = Math.abs(p[i] - p[j]);
    if (d && !s.has(d) && !seen.has(d)) { c++; seen.add(d); }
  }
  return c;
};
const zone = (n) => n <= 11 ? 0 : n <= 22 ? 1 : 2;

// ---- 实验 ----
const ALL = JSON.parse(fs.readFileSync(rawPath('ssq'), 'utf8'));
const EVAL_N = 120, REPS = 6, GROUPS = 8, RETRY = 40;
const evalRows = ALL.slice(0, EVAL_N).map(r => r[1]);
const train = ALL.slice(EVAL_N);

// 训练窗：频率 π、遗漏值、结构 P2~P98 带，全部只用评测期之前的数据（严格样本外）
const freq = new Array(33).fill(0);
for (const r of train) for (const n of r[1]) freq[n - 1]++;
const overdue = new Array(33).fill(0);
for (let i = train.length - 1, age = 0; i >= 0 && age < 200; i--, age++) {
  for (let n = 1; n <= 33; n++) if (!train[i][1].includes(n)) overdue[n - 1]++;
}
const stats = train.slice(0, 400).map(r => {
  const n = r[1];
  return { sum: n.reduce((a, b) => a + b, 0), odd: n.filter(x => x % 2).length,
           ac: calcAC(n), zones: new Set(n.map(zone)).size };
});
const W = {
  sum: [pctl(stats.map(x => x.sum), .02), pctl(stats.map(x => x.sum), .98)],
  odd: [pctl(stats.map(x => x.odd), .02), pctl(stats.map(x => x.odd), .98)],
  ac:  [pctl(stats.map(x => x.ac), .02), pctl(stats.map(x => x.ac), .98)],
};
const violations = (pick) => {
  let v = 0;
  const sum = pick.reduce((a, b) => a + b, 0), odd = pick.filter(x => x % 2).length, ac = calcAC(pick);
  if (sum < W.sum[0] || sum > W.sum[1]) v++;
  if (odd < W.odd[0] || odd > W.odd[1]) v++;
  if (ac < W.ac[0] || ac > W.ac[1]) v++;
  if (new Set(pick.map(zone)).size < 2) v++;
  return v;
};
const shaped = (sampler) => {
  let best = null, bestV = Infinity;
  for (let t = 0; t < RETRY; t++) {
    const p = sampler(), v = violations(p);
    if (v < bestV) { best = p; bestV = v; }
    if (v === 0) break;
  }
  return best;
};
const VARIANTS = [
  { name: 'uniform 严格均匀', gen: () => fisherYates(NUMS, 6) },
  { name: 'shape 结构塑形', gen: () => shaped(() => fisherYates(NUMS, 6)) },
  { name: 'shape_freq 频率加权', gen: () => shaped(() => weighted(NUMS, freq, 6)) },
  { name: 'shape_overdue 遗漏回补', gen: () => shaped(() => weighted(NUMS, overdue, 6)) },
];

const diffs = VARIANTS.map(() => []);
for (let rep = 0; rep < REPS; rep++) {
  for (const truth of evalRows) {
    const t = new Set(truth);
    for (let g = 0; g < GROUPS; g++) {
      const base = new Set(fisherYates(NUMS, 6));
      const baseHit = [...base].filter(n => t.has(n)).length;
      VARIANTS.forEach((v, i) => {
        const hit = [...new Set(v.gen())].filter(n => t.has(n)).length;
        diffs[i].push(hit - baseHit);
      });
    }
  }
}

const results = VARIANTS.map((v, i) => {
  const d = diffs[i], m = mean(d), se = sd(d) / Math.sqrt(d.length);
  const z = se ? m / se : 0;
  return { name: v.name, delta: m, z, p: twoSidedP(z) };
});

const ALPHA = 0.05;
const rawSig = results.filter(r => r.p <= ALPHA).length;
const bon = bonferroni(results.map(r => r.p), ALPHA);
const bh = bhFdr(results.map(r => r.p), ALPHA);
const zCrit = Math.abs(zFromP(bon.threshold));
function zFromP(p) { // 二分反解双侧正态 p -> |z|
  let lo = 0, hi = 10;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (twoSidedP(mid) > p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

console.log('═══ 多重比较校正（SSQ，严格样本外，seed=20261113 可复现） ═══');
console.log('实验规模：%d 期 × %d 组 × %d 轮 = %d 个逐期配对/变体，m=%d 次检验',
  EVAL_N, GROUPS, REPS, EVAL_N * GROUPS * REPS, results.length);
console.log('结构标定窗：评测期之前 %d 期，P2~P98 和值[%d,%d] 奇数[%d,%d] AC[%d,%d]',
  Math.min(train.length, 400), W.sum[0], W.sum[1], W.odd[0], W.odd[1], W.ac[0], W.ac[1]);
console.log('\n变体                         Δ命中       z       p');
for (const r of results) {
  const d = (r.delta >= 0 ? '+' : '') + r.delta.toFixed(5);
  const z = (r.z >= 0 ? '+' : '') + r.z.toFixed(3);
  console.log(`  ${r.name.padEnd(26)} ${d}  ${z}  ${r.p.toFixed(4)}`);
}
console.log(`\n未校正  |z|>${zFromP(ALPHA).toFixed(3)} (p<=${ALPHA.toFixed(2)}) 显著数: ${rawSig}`);
console.log(`Bonferroni 阈值 p<=${bon.threshold.toFixed(5)} (|z|>=${zCrit.toFixed(3)})，显著数: ${bon.significant}`);
console.log(`BH-FDR    显著数: ${bh.significant} (cutoff p=${bh.cutoff.toFixed(5)})`);

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '  ✅ ' : '  ❌ ') + name); cond ? pass++ : fail++; };
console.log('\n──────── 断言 ────────');
check('Bonferroni 阈值严格严于未校正阈值', bon.threshold < ALPHA);
check('校正后显著数不超过未校正显著数', bon.significant <= rawSig && bh.significant <= rawSig);
check('多重比较校正后无任何策略显著（与 E≡k²/N 一致）', bon.significant === 0 && bh.significant === 0);
console.log('──────────────────────\n  通过 %d 项，失败 %d 项', pass, fail);
process.exit(fail ? 1 : 0);
