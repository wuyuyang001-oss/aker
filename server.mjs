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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }

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
    json(res, 500, { error: String(e?.message || e) });
  }
});

// 启动时若库为空，灌入 fixture（一个真实跑出来的示例 run），保证打开即有内容
const fixtures = await buildFixtures();
seedIfEmpty(fixtures);

server.listen(PORT, () => {
  console.log(`\n  aker ▸ http://localhost:${PORT}`);
  console.log(`  ${capabilities().note}\n`);
});
