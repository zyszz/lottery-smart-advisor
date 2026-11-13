// 信号探针：判定"开奖是否均匀 + 频率/遗漏是否含可利用信号"
// 关键对照：在同构合成均匀数据上跑同一套测量，若合成数据也给不出偏差，
// 说明真实数据的偏差来自真实结构；若合成数据与真实数据表现一致，说明是harness问题。
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./_env');

const loadRaw = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'raw_' + n + '.json'), 'utf8'));

// ---------- 通用工具 ----------
function fisherYates(arr, k) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a.slice(0, k);
}
// 加权无放回抽样（与页面 _weightedSampleDistinct 逻辑一致）
function weightedSampleDistinct(nums, weights, k) {
  const pool = nums.map((n, i) => ({ n, w: Math.max(0, weights[i] || 0) }));
  const picked = [];
  for (let t = 0; t < k && pool.length; t++) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let idx;
    if (total <= 0) idx = Math.floor(Math.random() * pool.length);
    else { const r = Math.random() * total; let acc = 0; idx = pool.length - 1; for (let i = 0; i < pool.length; i++) { acc += pool[i].w; if (r <= acc) { idx = i; break; } } }
    picked.push(pool.splice(idx, 1)[0].n);
  }
  return picked;
}

// ---------- 真实数据 vs 合成均匀数据 ----------
function synthSSQ(nPeriods, N = 33, k = 6) {
  const out = [];
  for (let i = 0; i < nPeriods; i++) {
    const reds = fisherYates(Array.from({ length: N }, (_, j) => j + 1), k).sort((a, b) => a - b);
    out.push(['S' + i, reds, 1 + Math.floor(Math.random() * 16)]);
  }
  return out;
}

// 对一个数据集做 walk-forward 命中实验
// strat: 'random' | 'uniformW'(等权加权抽样) | 'overdue'(遗漏加权) | 'freq'(频率加权)
function hitExperiment(data, N, k, strat, nPeriods, minHist) {
  const nums = Array.from({ length: N }, (_, i) => i + 1);
  let hits = 0, sets = 0;
  for (let i = Math.min(nPeriods, data.length - 1); i >= 0; i--) {
    const hist = data.slice(i + 1);
    if (hist.length < minHist) continue;
    const actual = data[i][1];
    // 统计历史频率与遗漏
    const cnt = new Array(N + 1).fill(0), miss = new Array(N + 1).fill(0);
    for (const row of hist) for (const v of row[1]) cnt[v]++;
    for (let n = 1; n <= N; n++) {
      let m = 0; for (let h = 0; h < hist.length; h++) { if (hist[h][1].includes(n)) break; m++; }
      miss[n] = m;
    }
    let w;
    if (strat === 'uniformW') w = nums.map(() => 1);
    else if (strat === 'overdue') w = nums.map(n => (miss[n] >= 10 ? 3 : 1));
    else if (strat === 'freq') w = nums.map(n => 1 + cnt[n]);
    for (let s = 0; s < 20; s++) {
      let pick;
      if (strat === 'random') pick = fisherYates(nums, k);
      else pick = weightedSampleDistinct(nums, w, k);
      hits += pick.filter(x => actual.includes(x)).length;
      sets++;
    }
  }
  return hits / (sets || 1);
}

// 频率分桶的真实命中强度（找信号）
function bucketProbe(data, N, k, nPeriods, minHist) {
  const nums = Array.from({ length: N }, (_, i) => i + 1);
  const q = 5, bucketDraw = new Array(q).fill(0), bucketTotal = new Array(q).fill(0);
  let drawnTotal = 0;
  for (let i = Math.min(nPeriods, data.length - 1); i >= 0; i--) {
    const hist = data.slice(i + 1);
    if (hist.length < minHist) continue;
    const actual = data[i][1];
    const cnt = new Array(N + 1).fill(0);
    for (const row of hist) for (const v of row[1]) cnt[v]++;
    const sorted = nums.slice().sort((a, b) => cnt[a] - cnt[b]);
    const size = Math.floor(N / q);
    const bucketOf = new Map();
    sorted.forEach((n, idx) => bucketOf.set(n, Math.min(q - 1, Math.floor(idx / size))));
    for (const v of actual) { bucketDraw[bucketOf.get(v)]++; drawnTotal++; }
    for (const n of nums) bucketTotal[bucketOf.get(n)]++;
  }
  // 期望：均匀时每桶抽中率 = 6/N
  return Array.from({ length: q }, (_, b) => ({
    bucket: b + 1,
    drawRate: bucketDraw[b] / (drawnTotal || 1),
    expectRate: k / N,
    z: (bucketDraw[b] / (drawnTotal || 1) - k / N) / Math.sqrt((k / N) * (1 - k / N) / (drawnTotal || 1))
  }));
}

// 边际持久性：前半段高出现的号码，后半段是否仍高出现（真实偏差 vs 噪声）
function persistenceProbe(data, N, k) {
  const half = Math.floor(data.length / 2);
  const rate = (rows) => { const c = new Array(N + 1).fill(0); for (const r of rows) for (const v of r[1]) c[v]++; return c.map(x => x / rows.length); };
  const a = rate(data.slice(0, half));      // 近端
  const b = rate(data.slice(half));         // 远端
  const ma = a.reduce((s, x) => s + x, 0) / N, mb = b.reduce((s, x) => s + x, 0) / N;
  let sxy = 0, saa = 0, sbb = 0;
  for (let n = 1; n <= N; n++) { const da = a[n] - ma, db = b[n] - mb; sxy += da * db; saa += da * da; sbb += db * db; }
  const r = sxy / Math.sqrt(saa * sbb);
  const z = r * Math.sqrt(N - 2);
  return { corr: r, z, meanRate: mb };
}

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const se = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2)) / (a.length || 1)); };

function pairedDelta(realData, synthData, N, k, nPeriods, minHist, reps) {
  const R = { random: [], uniformW: [], overdue: [], freq: [] };
  const S = { random: [], uniformW: [], overdue: [], freq: [] };
  for (let r = 0; r < reps; r++) {
    for (const s of Object.keys(R)) { R[s].push(hitExperiment(realData, N, k, s, nPeriods, minHist)); S[s].push(hitExperiment(synthData, N, k, s, nPeriods, minHist)); }
  }
  const line = (name, obj, base) => {
    const d = obj.map((v, i) => v - base[i]);
    const dm = mean(d), ds = se(d);
    return { name, hit: mean(obj), dm, ds, z: ds > 0 ? dm / ds : 0 };
  };
  const fmt = (label, obj) => {
    const base = obj.random;
    console.log(`  ${label}`);
    for (const s of ['random', 'uniformW', 'overdue', 'freq']) {
      const r = line(s, obj[s], base);
      console.log('    ' + s.padEnd(10) + (r.hit.toFixed(4)).padStart(9) + '   Δ=' + (s === 'random' ? '—' : (r.dm >= 0 ? '+' : '') + r.dm.toFixed(4) + '±' + r.ds.toFixed(4)) + '   z=' + (s === 'random' ? '—' : r.z.toFixed(2)));
    }
  };
  console.log('\n【命中实验：真实数据 vs 合成均匀数据】(k=' + k + ', N=' + N + ', ' + reps + '轮)');
  fmt('真实开奖数据:', R);
  fmt('合成均匀数据(对照):', S);
}

console.log('══════ 信号探针 ══════');
const realSSQ = loadRaw('ssq');
const synth = synthSSQ(1200);
pairedDelta(realSSQ, synth, 33, 6, 120, 200, 6);

console.log('\n【频率分桶真实抽中率】(真实SSQ, 近120期×全历史窗口)');
const bp = bucketProbe(realSSQ, 33, 6, 120, 200);
for (const b of bp) console.log('  第' + b.bucket + '桶(频次由低到高)  实际抽中率=' + b.drawRate.toFixed(4) + '  均匀期望=' + b.expectRate.toFixed(4) + '  z=' + b.z.toFixed(2));

console.log('\n【边际持久性】(近/远半段频率相关性)');
const pp = persistenceProbe(realSSQ, 33, 6);
console.log('  近端 vs 远端 相关系数 r=' + pp.corr.toFixed(4) + '   z=' + pp.z.toFixed(2) + '   (|z|<2 表示无持久偏差→与均匀不可区分)');
const ppS = persistenceProbe(synth, 33, 6);
console.log('  [合成对照] r=' + ppS.corr.toFixed(4) + '   z=' + ppS.z.toFixed(2));
