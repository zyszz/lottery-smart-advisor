#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_lottery.py —— 抓取三种彩票最新开奖数据，生成 lottery_data.js（v5.0）

用法：
  python fetch_lottery.py                 # 抓取并写入 lottery_data.js
  python fetch_lottery.py --sync-html     # 同时把最新 50 期同步进 lottery_lib.html 内联数组
  python fetch_lottery.py --limit 300     # 抓取期数（默认 1200）

数据源：
  双色球 SSQ : 中国福利彩票 cwl.gov.cn
  大乐透 DLT : 中国体育彩票 webapi.sporttery.cn  gameNo=85
  七星彩 QXC : 中国体育彩票 webapi.sporttery.cn  gameNo=04

产物：
  lottery_data.js        window.LOTTERY_DATA = {version, updated, ssq, dlt, qxc}
  data/raw_ssq.json ...  抓取原始数据（回测 / 完整性校验用）
  （--sync-html）lottery_lib.html 内联 SSQ_DATA/DLT_DATA/QXC_DATA 同步刷新
"""
import argparse
import json
import os
import re
import ssl
import sys
import time
from datetime import datetime

import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "data")
DATA_JS = os.path.join(BASE, "lottery_data.js")
HTML = os.path.join(BASE, "lottery_lib.html")
KEEP = 50
VERSION = "5.0"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 默认启用 SSL 证书验证；仅在 CI / 内网自签名场景设置 LOTTERY_SSL_INSECURE=1
if os.environ.get("LOTTERY_SSL_INSECURE") == "1":
    CTX = ssl.create_default_context()
    CTX.check_hostname = False
    CTX.verify_mode = ssl.CERT_NONE
else:
    CTX = ssl.create_default_context()


# =========================================================
# 网络抓取（沿用 v4.9 已验证逻辑）
# =========================================================
def http_get(url, referer=None, retry=3, timeout=25):
    headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    if referer:
        headers["Referer"] = referer
    last = None
    for i in range(retry):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
                return resp.read().decode("utf-8", "ignore")
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.2 * (i + 1))
    # env 代理方式失败后，尝试直连（绕过可能失效/不可用的 HTTP(S)_PROXY）
    # 兼容两种网络环境：需要代理的走系统代理，直连可通的走直连
    try:
        direct = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPSHandler(context=CTX),
        )
        req = urllib.request.Request(url, headers=headers)
        with direct.open(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "ignore")
    except Exception:  # noqa: BLE001
        pass
    raise RuntimeError("GET failed: %s (%s)" % (url, last))


def fetch_ssq(limit=300):
    url = ("https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
           "?name=ssq&issueCount=%d" % limit)
    raw = http_get(url, referer="https://www.cwl.gov.cn/")
    obj = json.loads(raw)
    rows = []
    for it in obj.get("result", []):
        code = str(it.get("code", "")).strip()
        red = [int(x) for x in re.findall(r"\d+", it.get("red", ""))]
        blue = [int(x) for x in re.findall(r"\d+", it.get("blue", "") or "")]
        if not code or len(red) != 6 or len(blue) != 1:
            continue
        red = sorted(red)
        if len(set(red)) != 6 or min(red) < 1 or max(red) > 33 or not (1 <= blue[0] <= 16):
            continue
        rows.append([code, red, blue])
    rows.sort(key=lambda r: r[0], reverse=True)
    return rows


def fetch_sporttery(game_no, limit=300, kind="dlt"):
    """体彩历史接口，分页抓取；kind=dlt 前区5+后区2，kind=qxc 7位（第7位为特别号0~14）"""
    out = []
    page = 1
    page_size = 100
    while len(out) < limit:
        url = ("https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry"
               "?gameNo=%s&provinceId=0&pageSize=%d&isVerify=1&pageNo=%d"
               % (game_no, page_size, page))
        obj = json.loads(http_get(url, referer="https://www.sporttery.cn/"))
        val = (obj or {}).get("value") or {}
        lst = val.get("list") or []
        if not lst:
            break
        for it in lst:
            num = str(it.get("lotteryDrawNum", "")).strip()
            res = str(it.get("lotteryDrawResult", "")).strip()
            digits = [int(x) for x in re.findall(r"\d+", res)]
            if kind == "dlt":
                if len(digits) != 7 or not num:
                    continue
                front = sorted(digits[:5])
                back = sorted(digits[5:7])
                if len(set(front)) != 5 or min(front) < 1 or max(front) > 35:
                    continue
                if len(set(back)) != 2 or min(back) < 1 or max(back) > 12:
                    continue
                out.append([num, front, back])
            else:  # qxc
                if len(digits) != 7 or not num:
                    continue
                head, sp = digits[:6], digits[6]
                if any(d < 0 or d > 9 for d in head) or not (0 <= sp <= 14):
                    continue
                out.append([num, head + [sp]])
        total = val.get("total")
        if total and len(out) >= int(total):
            break
        page += 1
        time.sleep(0.4)

    # 期号统一：体彩为 26xxxx（2位年+3位序号），补齐为 2026xxxx
    norm = []
    for r in out:
        code = r[0]
        if len(code) == 5:
            code = "20" + code
        norm.append([code] + r[1:])
    norm.sort(key=lambda r: r[0], reverse=True)
    seen, uniq = set(), []
    for r in norm:
        if r[0] in seen:
            continue
        seen.add(r[0])
        uniq.append(r)
    return uniq[:limit]


def trim_qxc_rule(rows):
    """七星彩 2020 规则变更：第 7 位特别号由 0~9 扩为 0~14；只保留变更之后的期号。"""
    cut = None
    for i, r in enumerate(rows):  # 新 -> 旧
        if r[1][6] > 9:
            cut = i
    if cut is None:
        return rows, None
    return rows[:cut + 1], rows[cut][0]


# =========================================================
# 数据组装 / 落盘
# =========================================================
def fetch_all(limit=1200):
    ssq = fetch_ssq(limit)
    dlt = fetch_sporttery("85", limit, "dlt")
    qxc = fetch_sporttery("04", limit, "qxc")
    qxc, _ = trim_qxc_rule(qxc)
    return {"ssq": ssq, "dlt": dlt, "qxc": qxc}


def build_payload(rows, keep=KEEP):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return {
        "version": VERSION,
        "updated": now,
        "ssq": rows["ssq"][:keep],
        "dlt": rows["dlt"][:keep],
        "qxc": rows["qxc"][:keep],
    }


def write_lottery_data_js(payload, path=DATA_JS):
    js = (
        "// 彩票最新开奖数据 - 由 fetch_lottery.py (v%s) 自动生成\n"
        "// 更新时间: %s\n"
        "// SSQ:%d条 | DLT:%d条 | QXC:%d条\n"
        "// 数据源: 福彩 cwl.gov.cn / 体彩 sporttery.cn\n"
        "// 重新生成: python fetch_lottery.py [--sync-html]\n"
        "window.LOTTERY_DATA = %s;\n"
    ) % (VERSION, payload["updated"], len(payload["ssq"]), len(payload["dlt"]),
         len(payload["qxc"]),
         json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(js)
    return path


# =========================================================
# 可选：同步进 lottery_lib.html 内联数组
# =========================================================
SPEC = {
    "SSQ_DATA": ("ssq", 6, 1),
    "DLT_DATA": ("dlt", 5, 2),
    "QXC_DATA": ("qxc", 7, 0),
}


def extract_inline(html, name):
    m = re.search(r"const\s+%s\s*=\s*\[" % name, html)
    if not m:
        raise RuntimeError("未找到 %s 定义" % name)
    start = html.index("[", m.start())
    depth, i = 0, start
    while i < len(html):
        if html[i] == "[":
            depth += 1
        elif html[i] == "]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return html[start:i + 1], start, i + 1


def fmt_rows(rows, indent="  "):
    lines = []
    for r in rows:
        lines.append("%s%s," % (indent, json.dumps(r, separators=(",", ","), ensure_ascii=False)))
    return "\n".join(lines)


def sync_html(payload, html_path=HTML):
    with open(html_path, encoding="utf-8") as fh:
        html = fh.read()
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    new_html = html
    for name, (key, _, _) in SPEC.items():
        _, s, e = extract_inline(new_html, name)
        comment = "// ---- 最新真实数据 (%s fetch_lottery.py v%s 更新) ----" % (stamp, VERSION)
        body = "[\n  %s\n%s\n]" % (comment, fmt_rows(payload[key]))
        new_html = new_html[:s] + body + new_html[e:]
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(new_html)
    return html_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sync-html", action="store_true", help="同时刷新 lottery_lib.html 内联数组")
    ap.add_argument("--limit", type=int, default=1200)
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    rows = fetch_all(args.limit)
    for k in ("ssq", "dlt", "qxc"):
        with open(os.path.join(OUT_DIR, "raw_%s.json" % k), "w", encoding="utf-8") as fh:
            json.dump(rows[k], fh, ensure_ascii=False)
        print("%s: %d 条  最新 %s" % (k.upper(), len(rows[k]), rows[k][0][0] if rows[k] else "-"))

    payload = build_payload(rows)
    write_lottery_data_js(payload)
    print("✅ 已写入 lottery_data.js（最新 %s / %s / %s）"
          % (payload["ssq"][0][0], payload["dlt"][0][0], payload["qxc"][0][0]))

    if args.sync_html:
        sync_html(payload)
        print("✅ 已同步 lottery_lib.html 内联 SSQ_DATA / DLT_DATA / QXC_DATA（各 %d 期）" % KEEP)


if __name__ == "__main__":
    main()
