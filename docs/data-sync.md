# 数据同步策略

本项目的数据同时存在于三处，各有用途，不要混为一谈。

| 位置 | 角色 | 页面版本 | 数据更新方式 |
| --- | --- | --- | --- |
| 本地工作区 | 开发主副本 | 带宿主平台注解的「金版」 | `python fetch_lottery.py --sync-html` |
| 资料库云端 | 面向读者的主发布渠道 | 与本地金版逐字节一致 | 每次改动后按 page-edit 协议上传 |
| GitHub 公开仓库 | 源码镜像 + CI / 每日自动抓数 | `export_public.py` 剥离注解后的干净版 | `update-data.yml` 每日自动提交 |

## 1. 两种页面版本

本地金版带有宿主平台的 `data-page-node-id`、`data-pnid-children`、`<!--pnid:-->` 注释与 `/page/page_comm/inject.js` 注入脚本。这些是平台内部标识，在 GitHub 上既无意义也不应公开。

`scripts/export_public.py` 负责剥离它们，输出 `dist/lottery_lib.html`（本地产物，已在 `.gitignore` 中）。脚本会自检：

- 输出中不含任何平台/本地标识；
- 剥离前后 `SSQ_DATA / DLT_DATA / QXC_DATA` 内联开奖数据逐行一致；
- 保留原始换行符，避免整文件假 diff。

**不要用无注解的公开副本直接覆盖本地金版**，否则会破坏与资料库云端的一致性。

## 2. 顺序：先跑测试，再同步云端

`auto_update_http_test.js` / `refresh_button_http_test.js` 会启动 `start.py` 并调用 `/api/refresh`，该接口会顺手把 `lottery_data.js` 落盘，导致 `updated` 时间戳被刷新（数据内容不变）。

因此：

1. 先跑完全部测试；
2. 用**测试之后**的最终本地文件去同步资料库云端；
3. 同步完成后不要再跑 http 类测试。

否则本地与云端会出现仅时间戳不同的假差异。CI 环境通过 `LOTTERY_OFFLINE=1` 让 `/api/refresh` 跳过联网与落盘，避免这个问题。

## 3. 三方数据可能短暂不同步

- 资料库云端是主发布渠道，跟随本地手动同步，版本推进由人工触发。
- GitHub 公开仓库由 `update-data.yml` 每日北京时间 09:30 自动抓取并提交。
- 两者可能有数小时到一天的期数差异，属正常现象。

**判定依据以 `lottery_data.js` 中的 `updated` 与各彩种最新期号为准**，不要用文件大小或 commit 时间比较。

## 4. 抓取失败的处理

境外 CI runner 访问国内彩票官网可能超时。`update-data.yml` 的处理是：

- 抓取失败 → `git checkout --` 恢复全部数据文件 → 标记 `changed=false` → 正常结束，不红灯、不提交坏数据；
- 抓取成功 → 跑 `scripts/validate_data.py` → 再做公开版脱敏自检 → 有 diff 才提交。

因此 CI 变绿不等于「今天一定抓到了新数据」；需要确认是否有新的 data commit，或直接看仓库里的最新期号。

## 5. 手动同步清单

```bash
python fetch_lottery.py --sync-html          # 1. 更新本地三源
python scripts/validate_data.py              # 2. 校验
python scripts/export_public.py              # 3. 重新生成公开版
npm run test:all                             # 4. 全量测试（注意会刷新时间戳）
python scripts/validate_data.py              # 5. 复验数据未被测试污染
# 6. 最后再同步资料库云端 / 推送 GitHub
```

第 4 步之后若 `lottery_data.js` 时间戳变了，要么按第 6 步用最终文件同步，要么从备份恢复时间戳后再同步——两者选一，不要混用。
