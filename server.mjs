// server.mjs — aker 后端（零依赖，Node 内置 http）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

import { FRAMEWORKS, MATRIX_COLUMNS, TRACEABILITY_META } from './src/frameworks.mjs';
import { runParallel } from './src/orchestrator.mjs';
import { review } from './src/committee.mjs';
import { diffTraces } from './src/trace.mjs';
import { capabilities } from './src/adapters.mjs';
import { saveRun, getRun, listRuns, seedIfEmpty } from './src/store.mjs';
import { buildFixtures } from './fixtures/seed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, 'web');
const PORT = process.env.PORT || 5178;
// S2：默认只绑回环地址（与 Electron 本机模型一致），不暴露到同网段。
// 需对外监听时显式设 HOST=0.0.0.0。
const HOST = process.env.HOST || '127.0.0.1';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
// S2：请求体读全进内存前先卡 1MB 上限，超限即停止累积并抛 413，防内存型 DoS。
const MAX_BODY = 1e6; // 1MB
async function body(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    // 超限：立刻抛出（带 statusCode=413），不再 push——内存不会继续增长。
    // 注意不在这里 req.destroy()：那样会先于 413 响应撕掉 socket，客户端只看到连接被重置。
    // 由上层 catch 先回 413、再 req.destroy() 截断剩余上传。
    if (total > MAX_BODY) { const e = new Error('payload too large (>1MB)'); e.statusCode = 413; throw e; }
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const fp = normalize(join(WEB, rel));
  if (!fp.startsWith(WEB)) { json(res, 403, { error: 'forbidden' }); return; }
  try {
    const s = await stat(fp);
    if (s.isDirectory()) throw new Error('dir');
    const data = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found', pathname });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, ...capabilities() });

    if (p === '/api/frameworks') return json(res, 200, { frameworks: FRAMEWORKS, matrixColumns: MATRIX_COLUMNS, traceabilityMeta: TRACEABILITY_META });

    if (p === '/api/runs' && req.method === 'GET') return json(res, 200, { runs: listRuns() });

    if (p === '/api/run' && req.method === 'POST') {
      const { task, agents, mode } = await body(req);
      if (!task || !Array.isArray(agents) || !agents.length) return json(res, 400, { error: 'task 与 agents 必填' });
      const run = await runParallel({ task, agents, mode: mode || 'sim' });
      saveRun(run);
      return json(res, 200, { run });
    }

    if (p.startsWith('/api/runs/') && req.method === 'GET') {
      const id = decodeURIComponent(p.split('/').pop());
      const run = getRun(id);
      return run ? json(res, 200, { run }) : json(res, 404, { error: 'run 不存在' });
    }

    if (p === '/api/review' && req.method === 'POST') {
      const { runId, mode } = await body(req);
      const run = getRun(runId);
      if (!run) return json(res, 404, { error: 'run 不存在' });
      return json(res, 200, { review: review(run, mode || 'intersection') });
    }

    if (p === '/api/trace/diff' && req.method === 'GET') {
      const run = getRun(url.searchParams.get('runId'));
      if (!run) return json(res, 404, { error: 'run 不存在' });
      const a = run.agents.find((x) => x.agentId === url.searchParams.get('a'));
      const b = run.agents.find((x) => x.agentId === url.searchParams.get('b'));
      if (!a || !b) return json(res, 400, { error: 'a/b agent 不存在' });
      return json(res, 200, { diff: diffTraces(a, b) });
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'unknown api' });

    return serveStatic(req, res, p);
  } catch (e) {
    // S2：body() 超限抛出的错误带 statusCode=413，如实回 413 而非 500。
    const code = e?.statusCode || 500;
    if (!res.headersSent) json(res, code, { error: String(e?.message || e) });
    // 413：响应已发出后截断仍在上传的剩余字节，避免对端继续灌数据占内存。
    if (code === 413) req.destroy();
  }
});

// 启动时若库为空，灌入 fixture（一个真实跑出来的示例 run），保证打开即有内容
const fixtures = await buildFixtures();
seedIfEmpty(fixtures);

// S3：端口被占用等错误以前会抛未捕获异常直接退出，Electron 端只看到空白窗口、无从定位。
// 这里显式监听 error，对 EADDRINUSE 打印明确信息后以非 0 退出，便于上层（脚本/Electron）感知。
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✖ 端口 ${PORT} 已被占用（HOST=${HOST}）。请关闭占用进程，或用 PORT=<其它端口> 重启。\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  aker ▸ http://${HOST}:${PORT}`);
  console.log(`  ${capabilities().note}\n`);
});
