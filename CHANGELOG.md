# 更新日志

## v5.5.0 — 2026-11-16（GitHub 资料检索与能力合并）

- 新增 `tests/randomness_suite.js`：借鉴 NIST SP 800-22 Rev1a 的 monobit / runs / block-frequency / cumulative-sums / serial 五项检验，适配彩票天然对半分字段（QXC 前 6 位、SSQ 蓝球）。
- 借鉴 NIST README 的**灵敏度验证**做法：除真实开奖与同构合成均匀对照外，额外喂入已知偏倚（`P(1)=0.60`）与已知序列相关（70% 沿用上一位）两组缺陷数据，确认检验套件确实能检出问题，排除「检验太弱所以全部通过」的假阴性。实测真实组校正后 0/5 显著，偏倚组 5/5、相关组 3/5 被检出。
- 发现并修正一个假阳性来源：`data/raw_dlt.json` 的后区号码 1200/1200 期按升序存放，直接拼接位流会产生 `(0,1)` 667 次 / `(1,0)` 0 次的伪序列相关。改为不依赖顺序的「无序两号组合 χ² 均匀性检验」（66 种，df=65）并配同构合成对照。
- 新增 `docs/odds-and-responsible-play.md`：精确头奖概率（SSQ 1/17,721,088、DLT 1/21,425,712、QXC 1/15,000,000）、期望值、每期独立性、六类认知偏差与理性购彩提示。借鉴 `dungnotnull/lottery-statistics-responsible-play-advisor-agent-skill` 的零预测框架。
- `docs/methodology.md` 新增第 8~10 节（检验套件、展示顺序陷阱、赔率文档入口）；README / package.json / CI 同步接入。
- **未采用**：需 10⁶ 量级比特的 DFT / 矩阵秩 / 线性复杂度 / Maurer universal / random excursion 检验，以及任何 LSTM / 深度学习预测方案。
- 页面与开奖数据未改动，资料库云端金版保持一致。

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
