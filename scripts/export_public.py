#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""export_public.py —— 从资料库金版 lottery_lib.html 生成可公开的干净副本。

背景：本地 lottery_lib.html 是资料库云端页面的「金版」，带平台注入的
data-page-node-id 注解、data-pnid-children、<!--pnid:--> 注释以及
/page/page_comm/inject.js 引用。这些属于平台内部标识，不应出现在公开仓库，
且 inject.js 在非平台环境必然 404。

本脚本只做剥离，不改任何业务逻辑与内联开奖数据，输出 dist/lottery_lib.html，
本地金版保持原样（确保与资料库云端零差异不被破坏）。

用法：
  python scripts/export_public.py             # 生成 dist/lottery_lib.html
  python scripts/export_public.py --check     # 仅校验 dist 与金版的开奖数据一致
"""
import argparse
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "lottery_lib.html")
DST = os.path.join(BASE, "dist", "lottery_lib.html")

INJECT_LINE = "/page/page_comm/inject.js"


def strip_platform_markers(text):
    lines = [ln for ln in text.splitlines(True) if INJECT_LINE not in ln]
    text = "".join(lines)
    text = re.sub(r'[ \t]*data-page-node-id="[^"]*"', "", text)
    text = re.sub(r'[ \t]*data-pnid-children="[^"]*"', "", text)
    text = re.sub(r"<!--pnid:[^>]*-->", "", text)
    return text


def inline_rows(text, game):
    """提取 HTML 内联的 SSQ_DATA / DLT_DATA / QXC_DATA 前若干行。"""
    m = re.search(r"const %s_DATA\s*=\s*\[(.*?)\n\];" % game, text, re.S)
    if not m:
        return None
    rows = []
    for line in m.group(1).splitlines():
        line = line.strip().rstrip(",")
        if line.startswith("[") and line.endswith("]"):
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = ap.parse_args()

    if not os.path.exists(SRC):
        print("FAIL: 找不到源文件 %s" % SRC)
        return 1
    with open(SRC, encoding="utf-8", newline="") as fh:
        src = fh.read()
    clean = strip_platform_markers(src)

    leaks = []
    for token in ("data-page-node-id", "data-pnid-children", "<!--pnid:", INJECT_LINE,
                  "C:/Users/", "workbuddy.cn", "/space/d/"):
        if token in clean:
            leaks.append(token)
    if leaks:
        print("FAIL: 公开版仍含平台/本地标识: %s" % ", ".join(leaks))
        return 1

    # 开奖数据必须逐行一致（剥离注解不允许碰到数据区）
    for game in ("SSQ", "DLT", "QXC"):
        a, b = inline_rows(src, game), inline_rows(clean, game)
        if not a or a != b:
            print("FAIL: %s 内联数据在剥离前后不一致" % game)
            return 1

    if args.check:
        if not os.path.exists(DST):
            print("FAIL: dist 尚无公开版，请先生成")
            return 1
        print("OK: 源与 dist 的三彩种内联数据一致，且无平台标识")
        return 0

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8", newline="") as fh:
        fh.write(clean)
    print("OK: 已生成 %s" % DST)
    print("    原文件 %d bytes -> 公开版 %d bytes" % (len(src.encode("utf-8")), len(clean.encode("utf-8"))))
    print("    剥离 142 行 data-page-node-id / 75 段 <!--pnid:--> / inject.js 引用")
    return 0


if __name__ == "__main__":
    sys.exit(main())
