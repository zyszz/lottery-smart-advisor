// tests/randomness_suite.js —— 开奖序列随机性检验套件（借鉴 NIST SP 800-22 Rev1a）
//
// 本项目此前只用 χ² 检验号码边际分布，无法回答「期与期之间是否存在可预测结构」。
// 借鉴 GitHub 上 dj-on-github/sp800_22_tests 与 stevenang/randomness_testsuite 的实现，
// 选取不依赖超长比特流的 5 项检验：monobit / runs / block-frequency / cumulative-sums / serial。
//
// 位流构造的关键：33 个红球的奇偶天然是 17:16，直接做二值检验会得到「有偏」的假警报。
// 因此选用天然对半分的字段：
//   QXC 前 6 位 0~9      -> bit = (d >= 5)     5:5
//   SSQ 蓝球 1~16        -> bit = (blue >= 9)  8:8
//   DLT 后区 1~12        -> bit = (x >= 7)     6:6
//
// 借鉴 NIST README 的灵敏度验证做法：除了「真实数据」与「同构合成均匀对照」，
// 额外喂入「已知偏倚」与「已知序列相关」两组缺陷数据，确认检验套件确实能检出问题，
// 避免「检验太弱所以全部通过」的假阴性。
//
// 判定沿用 NIST 的 p >= 0.01；真实组另做 Bonferroni / BH-FDR 多重比较校正。
// 固定种子 20261116，结果可复现，CI 不会随机变红。
//
// 用法：node tests/randomness_suite.js
const fs = require('fs');
const { rawPath } = require('./_env');

const ALPHA = 0.01;              // NIST STS 判定阈值
const SEED = 20261116;

// ---------- 可复现 PRNG ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RND = mulberry32(SEED);
const rf = () => RND();
const ri = (n) => Math.floor(rf() * n);

// ---------- 特殊函数（避免引入 scipy / 第三方依赖） ----------
function erfPos(x) { // Abramowitz-Stegun 7.1.26，仅 x>=0
  const t = 1 / (1 + 0.3275911 * x);
  const poly = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t;
  return 1 - poly * Math.exp(-x * x);
}
const erfSigned = (x) => x < 0 ? -erfPos(-x) : erfPos(x);
const erfc = (x) => 1 - erfSigned(x);
const normCdf = (z) => 0.5 * erfc(-z / Math.SQRT2);

function gammaln(xx) { // Lanczos
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
               -1.231739572450155, 0.001208650973866179, -5.395239384953e-6];
  const x = xx, y0 = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015, y = y0;
  for (let j = 0; j < 6; j++) { y += 1; ser += cof[j] / y; }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function gser(a, x) { // 下不完全 gamma 的级数展开 P(a,x)
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 1; n <= 300; n++) {
    ap += 1; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
}
function gcf(a, x) { // 上不完全 gamma 的连分式 Q(a,x)
  const FPMIN = 1e-300, EPS = 1e-14;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}
const gammq = (a, x) => { // Q(a,x) = 1 - P(a,x)
  if (x <= 0) return 1;
  const v = x < a + 1 ? 1 - gser(a, x) : gcf(a, x);
  return Math.max(0, Math.min(1, v));
};
const clamp = (p) => Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));

// ---------- 5 项 NIST 检验 ----------
function monobit(bits) {
  const n = bits.length;
  let S = 0;
  for (const b of bits) S += 2 * b - 1;
  return { name: 'monobit 单比特频率', p: clamp(erfc(Math.abs(S) / Math.sqrt(2 * n))),
           stat: '|S|=' + Math.abs(S) };
}
function runs(bits) {
  const n = bits.length;
  const ones = bits.reduce((s, b) => s + b, 0);
  const prop = ones / n, tau = 2 / Math.sqrt(n);
  if (Math.abs(prop - 0.5) >= tau) {
    return { name: 'runs 游程', p: 0, stat: '前置频率检验失败 π=' + prop.toFixed(4) };
  }
  let V = 1;
  for (let i = 0; i < n - 1; i++) if (bits[i] !== bits[i + 1]) V += 1;
  const denom = 2 * Math.sqrt(2 * n) * prop * (1 - prop);
  return { name: 'runs 游程', p: clamp(erfc(Math.abs(V - 2 * n * prop * (1 - prop)) / denom)),
           stat: 'V=' + V };
}
function blockFrequency(bits) {
  const n = bits.length;
  let M = 20, N = Math.floor(n / M);
  if (N > 99) { N = 99; M = Math.floor(n / N); }
  if (N < 1 || M < 1) return { name: 'block-frequency 块内频率', p: 1, stat: '样本不足' };
  let chisq = 0;
  for (let i = 0; i < N; i++) {
    let ones = 0;
    for (let j = 0; j < M; j++) ones += bits[i * M + j];
    const pi = ones / M;
    chisq += 4 * M * (pi - 0.5) ** 2;
  }
  return { name: 'block-frequency 块内频率', p: clamp(gammq(N / 2, chisq / 2)),
           stat: 'χ²=' + chisq.toFixed(2) + ' (M=' + M + ',N=' + N + ')' };
}
function cumulativeSums(bits) {
  const n = bits.length;
  const pValue = (z0) => {
    const z = Math.max(1, z0);
    let sumA = 0, sumB = 0;
    const sa = Math.floor((-n / z + 1) / 4), ea = Math.floor((n / z - 1) / 4);
    for (let k = sa; k <= ea; k++) {
      sumA += normCdf(((4 * k + 1) * z) / Math.sqrt(n)) - normCdf(((4 * k - 1) * z) / Math.sqrt(n));
    }
    const sb = Math.floor((-n / z - 3) / 4), eb = Math.floor((n / z - 1) / 4);
    for (let k = sb; k <= eb; k++) {
      sumB += normCdf(((4 * k + 3) * z) / Math.sqrt(n)) - normCdf(((4 * k + 1) * z) / Math.sqrt(n));
    }
    return clamp(1 - sumA + sumB);
  };
  let pos = 0, fwd = 0;
  for (const b of bits) { pos += 2 * b - 1; fwd = Math.max(fwd, Math.abs(pos)); }
  pos = 0; let bwd = 0;
  for (let i = n - 1; i >= 0; i--) { pos += 2 * bits[i] - 1; bwd = Math.max(bwd, Math.abs(pos)); }
  return { name: 'cumulative-sums 累计和', p: Math.min(pValue(fwd), pValue(bwd)),
           stat: 'max|S|=' + Math.max(fwd, bwd) };
}
function serial(bits) {
  const n = bits.length, m = 3;
  const padded = bits.concat(bits.slice(0, m - 1));
  const psi = (mm) => {
    const counts = new Array(2 ** mm).fill(0);
    for (let i = 0; i < n; i++) {
      let idx = 0;
      for (let j = 0; j < mm; j++) idx = (idx << 1) | padded[i + j];
      counts[idx] += 1;
    }
    let s = 0;
    for (const c of counts) s += c * c;
    return s * (2 ** mm) / n - n;
  };
  const p3 = psi(m), p2 = psi(m - 1), p1 = psi(m - 2);
  const d1 = p3 - p2, d2 = p3 - 2 * p2 + p1;
  return { name: 'serial 序列模式(m=3)', p: Math.min(clamp(gammq(2 ** (m - 2), Math.max(0, d1) / 2)),
                                                    clamp(gammq(2 ** (m - 3), Math.max(0, d2) / 2))),
           stat: '∇ψ²=' + d1.toFixed(2) + '/' + d2.toFixed(2) };
}
const TESTS = [monobit, runs, blockFrequency, cumulativeSums, serial];

// ---------- 多重比较校正 ----------
function bonferroni(ps, alpha) {
  const thr = alpha / ps.length;
  return { threshold: thr, significant: ps.filter(p => p <= thr).length };
}
function bhFdr(ps, alpha) {
  const m = ps.length;
  const sorted = ps.slice().sort((a, b) => a - b);
  let k = 0;
  for (let j = 0; j < m; j++) if (sorted[j] <= (j + 1) / m * alpha) k = j + 1;
  return { k, cutoff: k ? sorted[k - 1] : 0, significant: k };
}

// ---------- 位流构造 ----------
const load = (g) => JSON.parse(fs.readFileSync(rawPath(g), 'utf8'));
const qxc = load('qxc').slice().reverse();   // 转为时间正序
const ssq = load('ssq').slice().reverse();
const dlt = load('dlt').slice().reverse();

const realBits = [];
for (const row of qxc) for (let i = 0; i < 6; i++) realBits.push(row[1][i] >= 5 ? 1 : 0);

const L = realBits.length;
const synthBits = [];               // 同构合成均匀对照
for (let i = 0; i < L; i++) synthBits.push(ri(10) >= 5 ? 1 : 0);
const biasedBits = [];              // 已知偏倚：P(1)=0.60
for (let i = 0; i < L; i++) biasedBits.push(rf() < 0.60 ? 1 : 0);
const correlatedBits = [];          // 已知序列相关：70% 概率沿用上一位
let prev = ri(2);
for (let i = 0; i < L; i++) { prev = rf() < 0.70 ? prev : 1 - prev; correlatedBits.push(prev); }

const ssqBits = ssq.map(r => r[2][0] >= 9 ? 1 : 0);
// ★DLT 后区原始数据 1200/1200 期都按升序存放，直接拼接成位流会产生
//   (0,1) 667 次 / (1,0) 0 次的伪序列结构，runs 检验必然假警报。
//   因此改为「无序两号组合」的 χ² 均匀性检验（C(12,2)=66 种，df=65），不依赖展示顺序。
function dltCombinationChisq(rows) {
  const counts = new Map();
  for (const r of rows) {
    const a = Math.min(r[2][0], r[2][1]), b = Math.max(r[2][0], r[2][1]);
    const key = a * 13 + b;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let K = 0;
  for (let a = 1; a <= 12; a++) for (let b = a + 1; b <= 12; b++) K += 1;
  const expect = rows.length / K;
  let chi = 0;
  for (let a = 1; a <= 12; a++) for (let b = a + 1; b <= 12; b++) {
    const c = counts.get(a * 13 + b) || 0;
    chi += (c - expect) ** 2 / expect;
  }
  return { name: 'DLT 后区组合均匀性', p: clamp(gammq((K - 1) / 2, chi / 2)),
           stat: 'χ²=' + chi.toFixed(2) + ' df=' + (K - 1) };
}
function synthDltRows(n) { // 同构合成对照：每期从 1~12 无放回抽 2 个
  const out = [];
  const pool = Array.from({ length: 12 }, (_, i) => i + 1);
  for (let i = 0; i < n; i++) {
    const a = pool.slice();
    for (let j = a.length - 1; j > 0; j--) { const k = ri(j + 1); const t = a[j]; a[j] = a[k]; a[k] = t; }
    out.push([null, null, [Math.min(a[0], a[1]), Math.max(a[0], a[1])]]);
  }
  return out;
}

const GROUPS = [
  { label: '真实 QXC 开奖', bits: realBits },
  { label: '合成均匀对照', bits: synthBits },
  { label: '已知偏倚 0.60', bits: biasedBits },
  { label: '已知序列相关', bits: correlatedBits },
];

// ---------- 执行与汇总 ----------
console.log('═══ 开奖随机性检验套件（NIST SP 800-22 子集，seed=' + SEED + '） ═══');
console.log('位长：QXC %d bits（%d 期 × 6 位），SSQ 蓝球 %d bits，DLT 后区 %d 期组合',
  L, qxc.length, ssqBits.length, dlt.length);
console.log(`判定：沿用 NIST 的 p >= ${ALPHA.toFixed(2)}；真实组另做 Bonferroni / BH-FDR 校正\n`);

const results = GROUPS.map(g => ({ label: g.label, tests: TESTS.map(t => t(g.bits)) }));
console.log('数据集                 检验                            p 值     判定   统计量');
for (const r of results) {
  for (const t of r.tests) {
    const flag = t.p >= ALPHA ? 'PASS' : 'FAIL';
    console.log(`  ${r.label.padEnd(20)} ${t.name.padEnd(28)} ${t.p.toFixed(5)}  ${flag}   ${t.stat}`);
  }
  console.log('  ' + '─'.repeat(76));
}

const real = results[0].tests.map(t => t.p);
const synth = results[1].tests.map(t => t.p);
const biased = results[2].tests.map(t => t.p);
const correlated = results[3].tests.map(t => t.p);
const bon = bonferroni(real, ALPHA);
const bh = bhFdr(real, ALPHA);
const synthSig = synth.filter(p => p < ALPHA).length;
const biasedSig = biased.filter(p => p < ALPHA).length;
const corrSig = correlated.filter(p => p < ALPHA).length;

console.log('\n═══ 汇总（NIST 风格 SUMMARY） ═══');
console.log(`真实 QXC  未校正显著数 ${real.filter(p => p < ALPHA).length}/5，Bonferroni 阈值 p<=${bon.threshold.toFixed(5)} 显著数 ${bon.significant}，BH-FDR 显著数 ${bh.significant}`);
console.log('合成均匀  未校正显著数 %d/5（应为 0，用于检查检验框架本身）', synthSig);
console.log('已知偏倚  显著数 %d/5（应 >= 2，验证偏倚灵敏度）', biasedSig);
console.log('已知相关  显著数 %d/5（应 >= 1，验证序列相关灵敏度）', corrSig);

const cross = [];
for (const t of [monobit, runs]) {
  const r = t(ssqBits);
  cross.push({ label: 'SSQ 蓝球 / ' + t.name, p: r.p });
}
const dltReal = dltCombinationChisq(dlt);
const dltSynth = dltCombinationChisq(synthDltRows(dlt.length));
cross.push({ label: 'DLT 后区 / ' + dltReal.name, p: dltReal.p });
cross.push({ label: 'DLT 合成对照 / ' + dltSynth.name, p: dltSynth.p });
console.log('\n跨彩种复核：');
for (const c of cross) console.log(`  ${c.label.padEnd(34)} p=${c.p.toFixed(5)}  ${c.p >= ALPHA ? 'PASS' : 'FAIL'}`);

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? '  ✅ ' : '  ❌ ') + name); cond ? pass++ : fail++; };
console.log('\n──────── 断言 ────────');
check('真实开奖：Bonferroni 与 BH-FDR 校正后均无任何显著项', bon.significant === 0 && bh.significant === 0);
check('同构合成均匀对照同样无显著项（检验框架无偏）', synthSig === 0);
check('已知偏倚数据被检出（>=2 项），套件对偏倚有效', biasedSig >= 2);
check('已知序列相关数据被检出（>=1 项），套件对相关性有效', corrSig >= 1);
check('跨彩种复核（SSQ 蓝球 / DLT 后区组合及合成对照）全部通过', cross.every(c => c.p >= ALPHA));
console.log('──────────────────────\n  通过 %d 项，失败 %d 项', pass, fail);
process.exit(fail ? 1 : 0);
