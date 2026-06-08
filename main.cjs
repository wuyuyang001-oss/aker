// main.cjs — Electron 主进程：启动内置 Aker 服务器，再加载窗口
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const PREFERRED_PORT = Number(process.env.AKER_PORT || 7421);

function findAvailablePort(start, attempts = 20) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, left) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && left > 1) tryPort(port + 1, left - 1);
        else reject(e);
      });
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(port)));
    };
    tryPort(start, attempts);
  });
}

// 轮询 health，确认服务器就绪再加载窗口
function waitForServer(port, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(); else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error('server timeout')) : setTimeout(tick, 150));
    tick();
  });
}

async function startServer(port) {
  // 打包后 app 目录只读 → 数据写到系统 userData
  process.env.AKER_DATA_DIR = app.getPath('userData');
  process.env.PORT = String(port);
  await import(path.join(__dirname, 'server.mjs')); // ESM 服务器（导入即监听）
  await waitForServer(port);
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 940, minHeight: 640,
    titleBarStyle: 'hiddenInset',           // mac 原生红绿灯 + 无标题栏
    trafficLightPosition: { x: 14, y: 18 },
    backgroundColor: '#f4f2ec',
    title: 'Aker',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.once('ready-to-show', () => win.show());
  // 站内 /api 之外的链接走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

app.whenReady().then(async () => {
  let port = PREFERRED_PORT;
  try {
    port = await findAvailablePort(PREFERRED_PORT);
    await startServer(port);
  }
  catch (e) { console.error('[Aker] server 启动失败：', e); }
  createWindow(port);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(port); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
