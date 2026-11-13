// 数据 × 策略专项回测：①自标定窗口随数据滚动更新 ②严格样本外 walk-forward
// 用法：node tests/data_policy_probe.js
// 说明：B 中频率策略只用每期之前的历史估 π，data 的结构窗口也只用前期数据标定，
//       属于严格样本外检验；与 strategy_final_verify.js 的合成均匀对照互为佐证。
const fs = require('fs');

const raw = g => JSON.parse(fs.readFileSync(require('./_env').rawPath(g), 'utf8'));
const pctl = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * q)))]; };
const AC = p => { const s = new Set(p); let c = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) { const d = Math.abs(p[i] - p[j]); if (d && !s.has(d)) { c++; s.add(d); } } return c; };
const fy = (a, k) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; } return b.slice(0, k); };
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const se = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2)) / (a.length || 1)); };
function wSample(nums, w, k) {
  const pool = nums.map((n, i) => ({ n, w: Math.max(0, w[i] || 0) })), out = [];
  for (let t = 0; t < k && pool.length; t++) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let idx;
    if (total <= 0) idx = Math.floor(Math.random() * pool.length);
    else { let r = Math.random() * total, acc = 0; idx = pool.length - 1; for (let i = 0; i < pool.length; i++) { acc += pool[i].w; if (r <= acc) { idx = i; break; } } }
    out.push(pool.splice(idx, 1)[0].n);
  }
  return out;
}
const shape = (rows, zone) => {
  const st = rows.map(r => { const n = r[1]; return { sum: n.reduce((a, b) => a + b, 0), odd: n.filter(x => x % 2).length, ac: AC(zone ? n : n.slice(0, 6)), zones: zone ? new Set(n.map(zone)).size : null }; });
  return { W: { sum: [pctl(st.map(x => x.sum), .02), pctl(st.map(x => x.sum), .98)], odd: [pctl(st.map(x => x.odd), .02), pctl(st.map(x => x.odd), .98)], ac: [pctl(st.map(x => x.ac), .02), pctl(st.map(x => x.ac), .98)] }, st };
};
const okShape = (W, x, zoneLo) => x.sum >= W.sum[0] && x.sum <= W.sum[1] && x.odd >= W.odd[0] && x.odd <= W.odd[1] && x.ac >= W.ac[0] && x.ac <= W.ac[1] && (zoneLo == null || x.zones >= zoneLo);
const specs = [
  { g: 'ssq', N: 33, k: 6, zone: n => n <= 11 ? 0 : n <= 22 ? 1 : 2 },
  { g: 'dlt', N: 35, k: 5, zone: n => n <= 7 ? 0 : n <= 14 ? 1 : n <= 21 ? 2 : n <= 28 ? 3 : 4 },
  { g: 'qxc', N: 10, k: 7, zone: null }
];

console.log('═══ A. 策略自标定窗口是否随最新数据滚动更新（近50期 P2~P98） ═══');
for (const s of specs) {
  const rows = raw(s.g).slice(0, 50);
  const { W, st } = shape(rows, s.zone);
  const lo = s.zone == null ? null : 2;
  const cov = st.slice(0, 30).filter(x => okShape(W, x, lo)).length / 30;
  const a = st[0], ok = okShape(W, a, lo);
  console.log(`【${s.g.toUpperCase()}】${rows[0][0]} 号码 ${JSON.stringify(rows[0][1])}`);
  console.log(`  窗口 和值[${W.sum}] 奇偶[${W.odd}] AC[${W.ac}]；本期 和值=${a.sum} 奇数=${a.odd} AC=${a.ac}${a.zones != null ? ' 分区=' + a.zones : ''}`);
  console.log(`  ${ok ? '✅' : '❌'} 最新期落在结构带内   近30期结构覆盖率 ${(cov * 100).toFixed(1)}%`);
}
console.log('\n═══ B. 严格样本外 walk-forward（前期估π → 最近120期评测，逐期配对） ═══');
for (const s of specs.filter(x => x.zone)) {
  const data = raw(s.g), nums = Array.from({ length: s.N }, (_, i) => i + 1), PER = 120, GRP = 20, TRAIN = 400;
  const dData = [], dFreq = [], hitU = [];
  for (let t = 0; t < PER; t++) {
    const actual = new Set(data[t][1]);
    const train = data.slice(t + 1, t + 1 + TRAIN);
    const cnt = Array(s.N + 1).fill(0);
    train.forEach(r => r[1].forEach(n => cnt[n]++));
    const w = Array.from({ length: s.N }, (_, i) => cnt[i + 1] + 1);
    const { W } = shape(train.slice(0, 50), s.zone);
    const shaped = () => {
      for (let allow = 0; allow <= 3; allow++) for (let q = 0; q < 40; q++) {
        const p = fy(nums, s.k).sort((a, b) => a - b);
        const x = { sum: p.reduce((a, b) => a + b, 0), odd: p.filter(n => n % 2).length, ac: AC(p), zones: new Set(p.map(s.zone)).size };
        let v = 0;
        if (x.sum < W.sum[0] || x.sum > W.sum[1]) v++;
        if (x.odd < W.odd[0] || x.odd > W.odd[1]) v++;
        if (x.ac < W.ac[0] || x.ac > W.ac[1]) v++;
        if (x.zones < 2) v++;
        if (v <= allow) return p;
      }
      return fy(nums, s.k);
    };
    let sd = 0, sf = 0, su = 0;
    for (let j = 0; j < GRP; j++) {
      const hit = x => x.filter(n => actual.has(n)).length;
      const u = fy(nums, s.k), f = wSample(nums, w, s.k), d = shaped();
      su += hit(u); sd += hit(d) - hit(u); sf += hit(f) - hit(u);
    }
    hitU.push(su / GRP); dData.push(sd / GRP); dFreq.push(sf / GRP);
  }
  const z = a => (mean(a) / se(a)).toFixed(2);
  console.log(`【${s.g.toUpperCase()}】均匀基线命中 ${mean(hitU).toFixed(4)}  (${PER}期 × ${GRP}组/期，训练窗 ${TRAIN} 期)`);
  console.log(`  data 均匀+结构     Δ=${mean(dData) >= 0 ? '+' : ''}${mean(dData).toFixed(4)} ±${se(dData).toFixed(4)}  z=${z(dData)}  ${Math.abs(z(dData)) < 2 ? '✅ 与随机不可区分' : '⚠️ 越界'}`);
  console.log(`  频率加权(∝π样本外) Δ=${mean(dFreq) >= 0 ? '+' : ''}${mean(dFreq).toFixed(4)} ±${se(dFreq).toFixed(4)}  z=${z(dFreq)}  ${Math.abs(z(dFreq)) < 2 ? '✅ 无样本外增益' : '⚠️ 越界'}`);
}
console.log('\n注：单次越界须独立复跑 3 次确认噪声；判定以理论 E 恒等式与多轮符号/幅度趋势为准。');
