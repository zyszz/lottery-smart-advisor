#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
start.py —— 本地 HTTP 服务 + /api/refresh 自动刷新接口（v5.0）

启动：
  python start.py             # 默认端口 8000
  python start.py --port 8080
  python start.py --host 127.0.0.1

页面经 http://localhost:8000/lottery_lib.html 打开后：
  - 自动（init）调用 autoRefreshOnOpen()  → fetch('/api/refresh')
  - 点「刷新数据」按钮           → refreshData()    → fetch('/api/refresh')
/api/refresh 返回：
  {"success": true, "data": {version, updated, ssq, dlt, qxc}, "source": "fresh|cache"}
其中 data 与 lottery_data.js 的 window.LOTTERY_DATA 结构完全一致。
"""
import argparse
import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

DATA_JS = os.path.join(BASE, "lottery_data.js")

# /api/refresh 只需“最新若干期”即可（payload 也只保留 50 期），
# 抓 1200 期每次要 ~20s；取 80 期足够覆盖一个月内的新增，~2-4s 返回。
REFRESH_LIMIT = 80


def load_data():
    """优先实时抓取；失败则回退到本地 lottery_data.js。

    设置环境变量 LOTTERY_OFFLINE=1 时跳过联网，直接读本地缓存。
    用于 CI / 离线演示：保证 /api/refresh 秒回且不依赖彩票官网可达性。
    """
    if os.environ.get("LOTTERY_OFFLINE") == "1":
        if os.path.exists(DATA_JS):
            txt = open(DATA_JS, encoding="utf-8").read()
            return json.loads(txt.split("=", 1)[1].rstrip().rstrip(";")), "cache(lottery_data.js, offline)"
        raise RuntimeError("LOTTERY_OFFLINE=1 但找不到本地 lottery_data.js")
    try:
        import fetch_lottery
        rows = fetch_lottery.fetch_all(limit=REFRESH_LIMIT)
        payload = fetch_lottery.build_payload(rows, keep=50)
        # 顺手把最新数据落盘，供后续 file:// 打开也能用
        fetch_lottery.write_lottery_data_js(payload, DATA_JS)
        return payload, "fresh"
    except Exception as exc:  # noqa: BLE001
        if os.path.exists(DATA_JS):
            try:
                txt = open(DATA_JS, encoding="utf-8").read()
                obj = json.loads(txt.split("=", 1)[1].rstrip().rstrip(";"))
                return obj, "cache(lottery_data.js)"
            except Exception:
                pass
        raise RuntimeError("无法获取开奖数据: %s" % exc)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/refresh":
            try:
                payload, src = load_data()
                self._send(200, {"success": True, "data": payload, "source": src})
            except Exception as exc:  # noqa: BLE001
                self._send(200, {"success": False, "error": str(exc)})
            return

        # --- 静态文件 ---
        if path in ("", "/"):
            path = "/lottery_lib.html"
        fp = os.path.normpath(os.path.join(BASE, path.lstrip("/")))
        if not fp.startswith(BASE):
            self._send(403, "forbidden", "text/plain; charset=utf-8")
            return
        if os.path.isfile(fp):
            if fp.endswith(".html"):
                ctype = "text/html; charset=utf-8"
            elif fp.endswith(".js"):
                ctype = "application/javascript; charset=utf-8"
            else:
                ctype = "text/plain; charset=utf-8"
            self._send(200, open(fp, "rb").read(), ctype)
        else:
            self._send(404, "not found: " + path, "text/plain; charset=utf-8")

    def log_message(self, *args):  # 静默默认访问日志
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    url = "http://localhost:%d/lottery_lib.html" % args.port
    print("本地服务已启动：%s" % url)
    print("自动刷新接口：  http://localhost:%d/api/refresh" % args.port)
    print("按 Ctrl+C 停止。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
        srv.shutdown()


if __name__ == "__main__":
    main()
