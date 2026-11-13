# 更新日志

## v5.4.0 — 2026-11-13

- 数据更新至 SSQ `2026130` / DLT `2026129` / QXC `2026129`，全历史 1200 / 1200 / 916 期。
- 新增「数据 × 策略」专项回测：自标定窗口随新数据滚动、严格样本外 walk-forward（前期估 π → 最近 120 期逐期配对）。
- 新增多重比较校正（Bonferroni / Benjamini-Hochberg FDR），固定随机种子保证 CI 可复现；校正后显著项为 0。
- 新增数据完整性校验 `scripts/validate_data.py` 与公开版脱敏导出 `scripts/export_public.py`。
- 测试脚本全面可移植化：`tests/_env.js` 统一解析根目录、Python 解释器与 `file://` URL，移除 16 个脚本里的硬编码 Windows 路径。
- 新增 `tests/run_gate.js` 统一门禁入口、`package.json` 脚本、`.gitignore`、README 与 docs。
- `start.py` 增加 `LOTTERY_OFFLINE=1`，让 CI / 离线演示的 `/api/refresh` 跳过联网。
- 接入 GitHub：`ci.yml`（数据完整性矩阵 / 统计检验矩阵 / 浏览器门禁 / 深度验证）与 `update-data.yml`（每日自动抓数提交）。

## v5.4 — 2026-11-05

- 7 个策略精简为 2 个（`data` 主推 + `smart` 对照），删除同质与已证伪的 `contrast` / `mandel` / `missile` / `acspan` / `repeat`。
- 抽取共用助手 `_shapeViolations`，消除 SSQ/DLT 重复违规闭包。
- 旧策略名统一回退到 `smart`，保留 `else` 兜底分支避免空池。

## v5.1 → v5.4

- 移除频率加权、遗漏回补、重号/邻号权重：全历史与样本外验证均无增益或方向为负。
- 保留自标定 `P2~P98` 结构软约束：理论中性、实测与随机不可区分，仅用于让形态贴近真实开奖。
- 随机基线改为 Fisher-Yates 无放回，回测改为逐期配对 + 合成均匀对照组。
