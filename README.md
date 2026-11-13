# 彩票数据驱动选号与统计验证系统 v5.4

支持 **双色球（SSQ） / 大乐透（DLT） / 七星彩（QXC）** 的单文件网页应用，附带全历史回测、随机性检验与自动化数据更新。

> **先说结论**：开奖号码各位置出现概率与均匀分布不可区分。任何选号策略的期望命中数恒为 `k²/N`，既无法超越随机，也不会劣于随机。本项目的价值不在「预测中奖」，而在于用可复现的统计实验把这件事验证清楚，并提供一个形态贴近真实开奖、但不声称有预测能力的选号器。详见 [方法论](docs/methodology.md)。
>
> 本项目仅用于数据统计学习与娱乐，不构成任何投注建议。

## 功能

| 模块 | 说明 |
| --- | --- |
| `lottery_lib.html` | 单文件应用，三个彩种页签、两种策略、遗漏值/连号/AC/跨度等统计面板，支持 `file://` 离线直接打开 |
| `fetch_lottery.py` | 从福彩/体彩官网抓取最新开奖，生成 `lottery_data.js` 与 `data/raw_*.json` 全历史，可选同步 HTML 内联数组 |
| `start.py` | 本地 HTTP 服务 + `/api/refresh` 实时刷新接口；`file://` 无法直连官网时由它做同源代理 |
| `tests/` | 浏览器回归门禁（7 脚本 / 67 项）、纯 Node 统计回测、walk-forward 与多重比较校正 |
| `scripts/` | 数据完整性校验、公开版脱敏导出 |
| `.github/workflows/` | 每日自动抓数提交、push/PR 全量 CI |

**两种策略**（v5.4 已从 7 个精简到 2 个）：

- `📊 数据驱动`（默认）：Fisher-Yates 严格均匀抽样 + 按真实分布自标定的 `P2~P98` 和值/奇偶/AC/分区软约束。目标只是让形态贴近真实开奖，不引入任何频率或遗漏权重。
- `🧠 综合智能`：传统加权代表，保留作对照。已证伪，不推荐使用。

## 快速开始

```bash
# 1) 最简单：直接用浏览器打开 lottery_lib.html（离线可用，内联了最近 50 期）

# 2) 带实时刷新：启动本地服务后访问 http://localhost:8000/lottery_lib.html
python start.py                     # Windows / Linux 均可
python start.py --port 8080 --host 127.0.0.1

# 3) 更新开奖数据
python fetch_lottery.py --sync-html # 同时刷新 HTML 内联数组

# 4) 跑校验与测试
python scripts/validate_data.py
npm install && npx playwright install chromium
npm run test:stats                  # 边际概率 / walk-forward / 多重比较校正
npm run test:gate                   # 7 个浏览器门禁脚本
```

Python 侧只用标准库（`requirements.txt` 无第三方依赖）；Node 侧需要 `playwright`。CI 环境设 `LOTTERY_OFFLINE=1` 可让 `/api/refresh` 跳过联网、直接返回本地缓存。

## 目录结构

```
lottery_lib.html          单文件主应用（公开干净版）
lottery_data.js           window.LOTTERY_DATA，最近 50 期
start.py / fetch_lottery.py
data/raw_{ssq,dlt,qxc}.json   全历史（1200 / 1200 / 916 期，最新在前）
tests/                    门禁、回测、统计检验、统一入口 run_gate.js
scripts/                  validate_data.py / export_public.py
docs/                     methodology.md / data-sync.md
策略分析报告_v5.4.txt      最终分析报告
```

## 数据真实性

`scripts/validate_data.py` 会校验：号码范围与个数、主号码无重复（七星彩每位独立、允许重复）、期号唯一且严格递减、`lottery_data.js` 时间戳与头注释一致、以及 **raw / js / HTML 内联三源前 50 期完全一致**。CI 每次 push 都会在 4 个 Python 版本上跑一遍。

数据源：福彩 `cwl.gov.cn`、体彩 `webapi.sporttery.cn`。

## 自动化

- **`ci.yml`**：数据完整性矩阵 → 统计检验矩阵（Node 20/22）→ Playwright 浏览器门禁 → main 上额外跑 40 轮高功效配对验证。
- **`update-data.yml`**：每日北京时间 09:30 抓取并校验后自动提交；抓取失败（境外 runner 访问国内站点不可达属预期内）时恢复原文件、不写坏数据、不产生红灯。

参考并借鉴了 GitHub 上同类项目的工程实践：`UlionTse/lotterycn` 的仓库规范与 CI 离线测试分组、`gudaoxuri/lottery_history` 的定时抓数与自动提交流程。**未采用**任何 LSTM / 深度学习预测方案——它们与本项目的统计结论相悖。

## 统计结论摘要（2026-11-13 全历史复验）

| 检验 | 结果 |
| --- | --- |
| 边际概率均匀性 | SSQ `χ²z=+1.86` / DLT `z=+1.26` / QXC 各位置 `\|z\|<1.2` |
| 频率加权 | 样本内 `Δ=+0.00096` → 样本外 `+0.00015`（约 84% 过拟合） |
| 遗漏回补加权 | `Δ=-0.00073`，方向一致为负 |
| 结构塑形 | 理论期望 `Δ=+0.00004`，与随机不可区分，**保留** |
| 上期重号 | SSQ `-0.58σ` / DLT `+0.44σ` / QXC `-0.01σ`，无信号 |
| 多重比较校正 | Bonferroni 与 BH-FDR 校正后显著项均为 0 |

单次检验偶发 `|z|>2` 属抽样噪声，须独立复跑 3 次确认；越界符号会在复跑间随机翻转。详见 `tests/multiple_testing.js`。

## 关于页面版本

本地开发用的页面可能带宿主平台的 DOM 注解与注入脚本，那些是平台内部标识。公开仓库里的 `lottery_lib.html` 是经 `scripts/export_public.py` 剥离后的干净版，**业务逻辑与内联开奖数据完全一致**。若你在自己的托管环境里维护带注解版本，请用该脚本生成公开副本，不要直接覆盖。同步策略见 [data-sync.md](docs/data-sync.md)。

## 许可与免责

MIT License。彩票为独立随机事件，任何策略都无法提高期望收益；请理性对待，本项目不承担任何投注后果。
