# 贡献指南

## 前提

请先读 [methodology.md](docs/methodology.md)。本项目最核心的结论是「开奖边际概率与均匀不可区分 ⇒ 任何策略的期望命中恒为 `k²/N`」。**不接受**以「提高中奖率」为目标的 PR（新增 LSTM、玄学权重、冷热号预测等），除非同时给出推翻该结论的、满足下述规范的证据。

## 本地环境

```bash
python scripts/validate_data.py                 # 无需依赖
npm install && npx playwright install chromium # 浏览器测试
npm run test:all                               # 数据 + 统计 + 浏览器全量
```

Windows / Linux / macOS 均可。路径一律通过 `tests/_env.js` 解析，不要在脚本里写死绝对路径；需要覆盖时用 `LOTTERY_ROOT` / `PYTHON` 环境变量。

## 提交前检查

- [ ] `npm run test:all` 通过（浏览器门禁 7 脚本 / 67 项）
- [ ] 新增的回测带**同构合成均匀对照组**，且使用**逐期配对**
- [ ] 随机基线是 Fisher-Yates 无放回
- [ ] 单次 `|z|>2` 已独立复跑 3 次确认是噪声
- [ ] 未提交本地绝对路径、宿主平台注解、`inject.js` 引用或任何内部标识
- [ ] 页面改动后重新运行 `python scripts/export_public.py` 生成干净公开版

## 数据更新

不要手工编辑 `data/raw_*.json` 和 `lottery_data.js`，一律通过 `python fetch_lottery.py --sync-html` 生成。每日自动更新由 `.github/workflows/update-data.yml` 负责；手动同步顺序见 [data-sync.md](docs/data-sync.md)。

## 代码风格

- Python 只用标准库；Node 侧只依赖 `playwright`。
- 单文件页面 `lottery_lib.html` 保持自包含，不引入 CDN 依赖（国内网络访问不稳定）。
- 注释说明「为什么这么做」，而不是复述代码。
