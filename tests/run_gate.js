// tests/run_gate.js —— 统一门禁入口：依次运行 7 个浏览器回归脚本并汇总退出码。
// 用法：node tests/run_gate.js  （npm run test:gate）
// 说明：http 类用例会调用 /api/refresh，可能刷新本地 lottery_data.js 的时间戳；
//       若在维护「本地 ↔ 资料库云端」一致性，跑完后请按 docs/data-sync.md 处理。
const { spawnSync } = require('child_process');
const path = require('path');

const GATE = [
  'strategy_v54_test.js',          // 20 项：v5.4 策略综合门禁
  'strategy_enter_test.js',        // 10 项：结构约束 / 回车路径
  'auto_update_v5_test.js',        // 11 项：file:// 自动更新
  'auto_update_http_test.js',      //  9 项：http:// 自动更新
  'refresh_button_file_test.js',   //  6 项：file:// 刷新按钮
  'refresh_button_http_test.js',   //  5 项：http:// 刷新按钮
  'online_update_test.js',         //  6 项：在线更新
];

let failed = [];
console.log('═══ 浏览器回归门禁（共 %d 个脚本） ═══', GATE.length);
for (const name of GATE) {
  console.log('\n▶ ' + name);
  const r = spawnSync(process.execPath, [path.join(__dirname, name)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(name + ' (exit=' + r.status + ')');
}
console.log('\n════════════════════════════════════════');
if (failed.length) {
  console.log('❌ 失败脚本：\n   ' + failed.join('\n   '));
  process.exit(1);
}
console.log('✅ 全部 %d 个门禁脚本通过', GATE.length);
console.log('提示：http 用例可能已刷新 lottery_data.js 时间戳，同步云端前请确认。');
