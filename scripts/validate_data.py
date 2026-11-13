#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""validate_data.py —— 开奖数据完整性校验（CI 前置门禁，纯标准库）。

校验项：
  1) 号码范围 / 个数 / 主号码无重复（SSQ / DLT / QXC 各自规则）
  2) 期号唯一且严格递减（最新在前）
  3) lottery_data.js 的 updated 与头注释一致
  4) raw_*.json 前 50 期 === lottery_data.js === HTML 内联数组
  5) 公开版 dist/lottery_lib.html（若存在）不含平台标识

用法：python scripts/validate_data.py
退出码 0=通过，1=失败。被 CI 与 data-update workflow 共用。
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
DATA_JS = os.path.join(BASE, "lottery_data.js")
HTML = os.path.join(BASE, "lottery_lib.html")
PUBLIC_HTML = os.path.join(BASE, "dist", "lottery_lib.html")

RULES = {
    "ssq": {"main": 6, "main_lo": 1, "main_hi": 33, "extra": 1, "extra_lo": 1, "extra_hi": 16},
    "dlt": {"main": 5, "main_lo": 1, "main_hi": 35, "extra": 2, "extra_lo": 1, "extra_hi": 12},
    "qxc": {"main": 6, "main_lo": 0, "main_hi": 9, "extra": 1, "extra_lo": 0, "extra_hi": 14,
            "inline_seventh": True},
}

errors = []


def fail(msg):
    errors.append(msg)


def load_raw(game):
    p = os.path.join(DATA, "raw_%s.json" % game)
    if not os.path.exists(p):
        fail("%s: 缺少 %s" % (game, p))
        return []
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception as exc:
        fail("%s: JSON 解析失败 %s" % (game, exc))
        return []


def check_rows(game, rows):
    r = RULES[game]
    if not rows:
        return
    issues = []
    seen = set()
    prev = None
    for i, row in enumerate(rows):
        issue, nums = row[0], row[1]
        if not re.fullmatch(r"\d{7}", str(issue)):
            issues.append("第%d行期号异常 %r" % (i + 1, issue))
        if issue in seen:
            issues.append("第%d行期号重复 %s" % (i + 1, issue))
        seen.add(issue)
        if prev is not None and int(issue) >= prev:
            issues.append("第%d行期号未严格递减 (%s >= %s)" % (i + 1, issue, prev))
        prev = int(issue)

        main = list(nums[:r["main"]])
        expected_len = r["main"] + (1 if r.get("inline_seventh") else 0)
        if len(nums) != expected_len:
            issues.append("第%d行位数 %d 不符（应为 %d）" % (i + 1, len(nums), expected_len))
        if len(main) != r["main"]:
            issues.append("第%d行主号码个数不符" % (i + 1,))
        for n in main:
            if not isinstance(n, int) or not (r["main_lo"] <= n <= r["main_hi"]):
                issues.append("第%d行主号码越界 %r" % (i + 1, n))
        # 七星彩每位独立摇号，前 6 位允许重复；SSQ/DLT 为无放回，禁止重复
        if not r.get("inline_seventh") and len(set(main)) != len(main):
            issues.append("第%d行主号码重复" % (i + 1,))

        if r.get("inline_seventh"):
            seventh = nums[-1]
            if not isinstance(seventh, int) or not (r["extra_lo"] <= seventh <= r["extra_hi"]):
                issues.append("第%d行特别号越界 %r" % (i + 1, seventh))
        else:
            extra = list(row[2]) if len(row) > 2 else []
            if len(extra) != r["extra"]:
                issues.append("第%d行副号码个数不符" % (i + 1,))
            for n in extra:
                if not isinstance(n, int) or not (r["extra_lo"] <= n <= r["extra_hi"]):
                    issues.append("第%d行副号码越界 %r" % (i + 1, n))
            if len(set(extra)) != len(extra):
                issues.append("第%d行副号码重复" % (i + 1,))
    if issues:
        fail("%s: %d 处异常，前 5 条: %s" % (game, len(issues), " | ".join(issues[:5])))
    else:
        print("  ✅ %s: %d 期，号码/期号全部合法，最新 %s" % (game.upper(), len(rows), rows[0][0]))


def inline_rows(text, game):
    m = re.search(r"const %s_DATA\s*=\s*\[(.*?)\n\];" % game, text, re.S)
    if not m:
        return None
    out = []
    for line in m.group(1).splitlines():
        line = line.strip().rstrip(",")
        if line.startswith("[") and line.endswith("]"):
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def main():
    print("═══ 开奖数据完整性校验 ═══")
    raws = {}
    for game in RULES:
        raws[game] = load_raw(game)
        check_rows(game, raws[game])

    js_txt = open(DATA_JS, encoding="utf-8").read() if os.path.exists(DATA_JS) else ""
    if not js_txt:
        fail("缺少 lottery_data.js")
    else:
        m = re.search(r"window\.LOTTERY_DATA\s*=\s*(\{.*\})\s*;?\s*$", js_txt, re.S | re.M)
        if not m:
            fail("lottery_data.js 结构无法解析")
        else:
            payload = json.loads(m.group(1))
            comment = re.search(r"// 更新时间:\s*([^\r\n]+)", js_txt)
            if not comment or comment.group(1).strip() != payload.get("updated"):
                fail("lottery_data.js 头注释 updated 与 payload 不一致")
            else:
                print("  ✅ lottery_data.js updated=%s 与头注释一致" % payload["updated"])
            for game in RULES:
                a = raws[game][:50]
                b = payload.get(game, [])
                if a != b:
                    fail("%s: raw 前50期与 lottery_data.js 不一致" % game)
            print("  ✅ raw / lottery_data.js 三彩种前 50 期一致")

    html_txt = open(HTML, encoding="utf-8").read() if os.path.exists(HTML) else ""
    if html_txt:
        for game in RULES:
            rows = inline_rows(html_txt, game.upper())
            if rows is None:
                fail("HTML 缺少 %s_DATA 内联数组" % game.upper())
            elif rows[:50] != raws[game][:50]:
                fail("%s: HTML 内联前50期与 raw 不一致" % game)
        print("  ✅ HTML 内联三彩种前 50 期与 raw 一致")

    if os.path.exists(PUBLIC_HTML):
        pub = open(PUBLIC_HTML, encoding="utf-8").read()
        for token in ("data-page-node-id", "<!--pnid:", "/page/page_comm/inject.js",
                      "C:/Users/", "/space/d/"):
            if token in pub:
                fail("公开版 HTML 含内部标识 %s" % token)
        print("  ✅ 公开版 HTML 无平台/本地标识")

    if errors:
        print("\n❌ 校验失败：")
        for e in errors:
            print("   -", e)
        return 1
    print("\n✅ 全部校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
