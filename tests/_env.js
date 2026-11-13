// tests/_env.js —— 统一运行环境（跨平台、可移植）
//
// 之前每个测试脚本都写死了 Windows 绝对路径与受管 Python 解释器路径，
// 导致项目只能在某一台机器上跑，也无法进入 CI。这里统一收敛为：
//   LOTTERY_ROOT  项目根目录（默认 = 本文件上一级）
//   PYTHON        Python 解释器（默认 Windows=python / 其它=python3）
//   HTML / fileUrl 页面绝对路径与标准 file:// URL
//   shot(name)    截图输出路径
//   rawPath(game) 全历史数据路径
//
// 用法：const { ROOT, PY, HTML, fileUrl, shot, rawPath } = require('./_env');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.env.LOTTERY_ROOT
  ? path.resolve(process.env.LOTTERY_ROOT)
  : path.resolve(__dirname, '..');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const HTML = path.join(ROOT, 'lottery_lib.html');
const fileUrl = pathToFileURL(HTML).href;
const dataDir = path.join(ROOT, 'data');
const shot = (name) => path.join(dataDir, name);
const rawPath = (game) => path.join(dataDir, 'raw_' + game + '.json');

module.exports = { ROOT, PY, HTML, fileUrl, dataDir, shot, rawPath, pathToFileURL };
