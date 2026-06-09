// server.mjs — aker 后端（零依赖，Node 内置 http）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

import { FRAMEWORKS, MATRIX_COLUMNS, TRACEABILITY_META } from './src/frameworks.mjs';
import { runParallel } from './src/orchestrator.mjs';
import { review } from './src/committee.mjs';
import { diffTraces } from './src/trace.mjs';
import { capabilities, synthesizeReview } from './src/adapters.mjs';
import { appendProjectMessage, createProject, exploreProject } from './src/projects.mjs';
import { enrichProjectSources } from './src/sources.mjs';
import { configureApi, listConnections, removeApi, testConnection } from './src/connections.mjs';
import { createTask, patchTask, runTask } from './src/tasks.mjs';
import { evaluateTask } from './src/evaluator.mjs';
import { importGithubRunner, listRunners, testRunner } from './src/runners.mjs';
import { saveRun, getRun, listRuns, saveProject, getProject, listProjects, saveTask, getTask, listTasks, legacyProjectAsTask, seedIfEmpty } from './src/store.mjs';
import { buildFixtures } from './fixtures/seed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, 'web');
const PORT = process.env.PORT || 5178;
// S2：默认只绑回环地址（与 Electron 本机模型一致），不暴露到同网段。
// 需对外监听时显式设 HOST=0.0.0.0。
const HOST = process.env.HOST || '127.0.0.1';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function ndjson(res, obj) { res.write(`${JSON.stringify(obj)}\n`); }
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
    if (p === '/api/runners' && req.method === 'GET') return json(res, 200, { runners: listRunners() });
    if (p === '/api/runners/import-github' && req.method === 'POST') return json(res, 201, await importGithubRunner(await body(req)));
    const runnerTestMatch = p.match(/^\/api\/runners\/([^/]+)\/test$/);
    if (runnerTestMatch && req.method === 'POST') return json(res, 200, await testRunner(decodeURIComponent(runnerTestMatch[1])));

    if (p === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: listTasks() });
    if (p === '/api/tasks' && req.method === 'POST') {
      const input = await body(req);
      if (!String(input.message || '').trim()) return json(res, 400, { error: 'message 必填' });
      const task = createTask(input);
      saveTask(task);
      return json(res, 201, { task });
    }
    const taskMatch = p.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'GET') {
      const taskId = decodeURIComponent(taskMatch[1]);
      const task = getTask(taskId) || legacyProjectAsTask(getProject(taskId));
      return task ? json(res, 200, { task }) : json(res, 404, { error: 'task 不存在' });
    }
    if (taskMatch && req.method === 'PATCH') {
      const task = getTask(decodeURIComponent(taskMatch[1]));
      if (!task) return json(res, 404, { error: 'task 不存在或为只读历史项目' });
      patchTask(task, await body(req));
      saveTask(task);
      return json(res, 200, { task });
    }
    const taskRunMatch = p.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (taskRunMatch && req.method === 'POST') {
      const task = getTask(decodeURIComponent(taskRunMatch[1]));
      if (!task) return json(res, 404, { error: 'task 不存在' });
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
      try {
        await runTask(task, {
          onEvent: async (event, updated) => {
            saveTask(updated);
            ndjson(res, event);
          },
        });
        saveTask(task);
        ndjson(res, { type: 'complete', task });
      } catch (error) {
        task.status = 'failed';
        saveTask(task);
        ndjson(res, { type: 'error', error: String(error?.message || error), task });
      }
      return res.end();
    }
    const taskEvalMatch = p.match(/^\/api\/tasks\/([^/]+)\/evaluate$/);
    if (taskEvalMatch && req.method === 'POST') {
      const task = getTask(decodeURIComponent(taskEvalMatch[1]));
      if (!task) return json(res, 404, { error: 'task 不存在' });
      const result = await evaluateTask(task);
      saveTask(result);
      return json(res, 200, { task: result });
    }
    if (p === '/api/connections' && req.method === 'GET') return json(res, 200, listConnections());
    if (p === '/api/connections/api' && req.method === 'POST') {
      const config = await body(req);
      return json(res, 200, configureApi(config));
    }
    if (p === '/api/connections/api' && req.method === 'DELETE') {
      const { provider } = await body(req);
      return json(res, 200, removeApi(provider));
    }
    if (p === '/api/connections/test' && req.method === 'POST') {
      const { id } = await body(req);
      return json(res, 200, await testConnection(id));
    }

    if (p === '/api/frameworks') return json(res, 200, { frameworks: FRAMEWORKS, matrixColumns: MATRIX_COLUMNS, traceabilityMeta: TRACEABILITY_META });

    if (p === '/api/runs' && req.method === 'GET') return json(res, 200, { runs: listRuns() });
    if (p === '/api/projects' && req.method === 'GET') return json(res, 200, { projects: listProjects() });

    if (p === '/api/projects' && req.method === 'POST') {
      const { message, mode } = await body(req);
      if (!String(message || '').trim()) return json(res, 400, { error: 'message 必填' });
      const project = createProject({ message, mode: mode || 'sim' });
      await enrichProjectSources(project);
      saveProject(project);
      return json(res, 201, { project });
    }

    const projectMatch = p.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && req.method === 'GET') {
      const project = getProject(decodeURIComponent(projectMatch[1]));
      return project ? json(res, 200, { project }) : json(res, 404, { error: 'project 不存在' });
    }
    if (projectMatch && req.method === 'PATCH') {
      const project = getProject(decodeURIComponent(projectMatch[1]));
      if (!project) return json(res, 404, { error: 'project 不存在' });
      const update = await body(req);
      if (update.brief && typeof update.brief === 'object') project.brief = { ...project.brief, ...update.brief };
      if (update.mode === 'live' || update.mode === 'sim') project.mode = update.mode;
      if (String(update.title || '').trim()) project.title = String(update.title).trim().slice(0, 80);
      project.updatedAt = new Date().toISOString();
      saveProject(project);
      return json(res, 200, { project });
    }

    const messageMatch = p.match(/^\/api\/projects\/([^/]+)\/messages$/);
    if (messageMatch && req.method === 'POST') {
      const project = getProject(decodeURIComponent(messageMatch[1]));
      if (!project) return json(res, 404, { error: 'project 不存在' });
      const { message } = await body(req);
      if (!String(message || '').trim()) return json(res, 400, { error: 'message 必填' });
      appendProjectMessage(project, message);
      await enrichProjectSources(project);
      saveProject(project);
      return json(res, 200, { project });
    }

    const branchMatch = p.match(/^\/api\/projects\/([^/]+)\/branches$/);
    if (branchMatch && req.method === 'POST') {
      const parent = getProject(decodeURIComponent(branchMatch[1]));
      if (!parent) return json(res, 404, { error: 'project 不存在' });
      const { prompt, claim } = await body(req);
      const message = String(prompt || '').trim() || `请进一步验证以下主张：${String(claim || '').trim()}`;
      if (!message.trim()) return json(res, 400, { error: 'prompt 或 claim 必填' });
      const project = createProject({ message, mode: parent.mode, parentId: parent.id, branchFrom: claim || null });
      project.brief.context = `这是从决策项目「${parent.title}」创建的分支。原始决策：${parent.brief.decision}`;
      saveProject(project);
      return json(res, 201, { project });
    }

    const exploreMatch = p.match(/^\/api\/projects\/([^/]+)\/explore$/);
    if (exploreMatch && req.method === 'POST') {
      const project = getProject(decodeURIComponent(exploreMatch[1]));
      if (!project) return json(res, 404, { error: 'project 不存在' });
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      try {
        const result = await exploreProject(project, capabilities(), {
          synthesize: synthesizeReview,
          onEvent: async (event, updated) => {
            saveProject(updated);
            ndjson(res, { type: 'event', event });
          },
        });
        saveRun(result.run);
        saveProject(result.project);
        ndjson(res, { type: 'complete', project: result.project, run: result.run, review: result.review });
      } catch (error) {
        project.status = 'failed';
        saveProject(project);
        ndjson(res, { type: 'error', error: String(error?.message || error), project });
      }
      return res.end();
    }

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
      const result = review(run, mode || 'intersection');
      const completed = run.agents.filter((a) => a.status === 'done' && a.mode === 'live' && a.output);
      if (completed.length >= 2) {
        if (!run.synthesis) {
          try {
            run.synthesis = await synthesizeReview({ task: run.task, agents: completed, evidence: result });
            saveRun(run);
          } catch (e) {
            run.synthesis = { error: String(e?.message || e) };
          }
        }
        if (run.synthesis.markdown) {
          result.betterSolution = {
            ...result.betterSolution,
            ruleMarkdown: result.betterSolution.markdown,
            markdown: run.synthesis.markdown,
            synthesis: { mode: 'live', channel: run.synthesis.channel },
          };
        } else if (run.synthesis.error) {
          result.betterSolution.synthesis = { mode: 'error', error: run.synthesis.error };
        }
      }
      return json(res, 200, { review: result });
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
