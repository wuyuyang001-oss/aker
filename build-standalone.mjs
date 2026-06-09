// build-standalone.mjs — 把 aker 编译成单文件 aker.html（零依赖、离线可跑）
// harness engineer 原则：每步打印做了什么、断言关键不变量，失败即定位。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R = (p) => readFileSync(join(__dirname, p), 'utf8');
const step = (n, msg) => console.log(`  [${n}] ${msg}`);

// —— 只剥离“文件头部”的真 import（放过模板字符串里的示例代码）——
function stripHeaderImports(src) {
  const lines = src.split('\n');
  const out = [];
  let inHeader = true;
  for (const ln of lines) {
    if (inHeader) {
      const t = ln.trim();
      if (t === '' || t.startsWith('//')) { out.push(ln); continue; }
      if (/^import\s.*from\s.*;?\s*$/.test(t)) { continue; }   // drop real import
      inHeader = false;                                         // 遇到第一行真代码，头部结束
    }
    out.push(ln);
  }
  return out.join('\n');
}
// —— 去掉行首 export（代码示例里没有 col0 的 JS export，已核对）——
function stripExports(src) { return src.replace(/^export\s+/gm, ''); }

function prep(name, { envSafe = false } = {}) {
  let s = R(`src/${name}`);
  s = stripHeaderImports(s);
  s = stripExports(s);
  if (envSafe) {
    s = s.replace(/process\.env/g, '__ENV');   // 浏览器安全
    // S1：浏览器版禁止直连模型 API（否则 key 会进前端 + CORS 死代码）。把两个 Live 调用函数体换成抛错存根。
    const stub = (name) => `async function ${name}() { throw new Error('Live 模式不支持浏览器内直连（避免 API key 泄露），请改用本地 server.mjs 后端代理'); }\n`;
    s = s.replace(/async function callAnthropic\([\s\S]*?\n}\n/, stub('callAnthropic'));
    s = s.replace(/async function callOpenAI\([\s\S]*?\n}\n/, stub('callOpenAI'));
    if (/api\.anthropic\.com|api\.openai\.com/.test(s)) throw new Error('S1: 浏览器版仍残留模型 API 直连');
  }
  // 断言：剥离后不应残留 src 相对 import / 真 export
  if (/^\s*import\s.*from\s+['"]\.\//m.test(s)) throw new Error(`${name}: 仍残留相对 import`);
  if (/^export\s/m.test(s)) throw new Error(`${name}: 仍残留 export`);
  step('strip', `${name} ok (${s.length}b)`);
  return s;
}

console.log('▶ building aker.html');

// 1) 模块（按依赖顺序拼接，单作用域、函数声明可提升）
const modules = [
  prep('frameworks.mjs'),
  prep('trace.mjs'),
  prep('committee.mjs'),
  prep('adapters.mjs', { envSafe: true }),
  prep('orchestrator.mjs'),
  prep('projects.mjs'),
].join('\n\n');

// 2) 浏览器 store（localStorage）+ 路由 + fetch 拦截
const runtime = `
// ── 浏览器 store（localStorage 持久化）──
const __KEY = 'aker.projects.v2';
function __load() { try { const db = JSON.parse(localStorage.getItem(__KEY)) || {}; db.runs ||= []; db.projects ||= []; return db; } catch { return { runs: [], projects: [] }; } }
function __save(db) { localStorage.setItem(__KEY, JSON.stringify(db)); }
function saveRun(run) { const db = __load(); const i = db.runs.findIndex(r => r.id === run.id); if (i >= 0) db.runs[i] = run; else db.runs.unshift(run); __save(db); return run; }
function getRun(id) { return __load().runs.find(r => r.id === id) || null; }
function listRuns() { return __load().runs.map(({ id, task, createdAt, mode, agents }) => ({ id, task, createdAt, mode, agentCount: agents.length })); }
function saveProject(project) { const db = __load(); const i = db.projects.findIndex(p => p.id === project.id); if (i >= 0) db.projects[i] = project; else db.projects.unshift(project); __save(db); return project; }
function getProject(id) { return __load().projects.find(p => p.id === id) || null; }
function listProjects() { return __load().projects.map(({ id, title, status, mode, createdAt, updatedAt, parentId }) => ({ id, title, status, mode, createdAt, updatedAt, parentId })); }

// ── 首次访问灌入 Sim 示例 run（模板数据，仅用于演示流程）──
let __seeded = false;
async function ensureSeeded() {
  if (__seeded) return;
  __seeded = true;
  if (__load().runs.length) return;
  const run = await runParallel({ task: '实现一个带缓存的并发安全计数器', mode: 'sim', agents: [
    { role: 'strategist', framework: 'claude-code', model: 'claude-opus-4-8' },
    { role: 'critic', framework: 'codex-cli', model: 'gpt-x' },
    { role: 'operator', framework: 'langgraph', model: 'o-series' },
    { role: 'researcher', framework: 'hermes', model: 'hermes-3' },
  ]});
  run.id = 'run_demo'; run.createdAt = '2026-06-08T00:00:00.000Z';
  saveRun(run);
}

// ── 路由：复刻原 server.mjs 的 API（纯前端执行）──
async function __handle(method, urlStr, body) {
  const url = new URL(urlStr, location.origin);
  const p = url.pathname;
  await ensureSeeded();
  if (p === '/api/health') return { status: 200, body: { ok: true, ...capabilities() } };
  if (p === '/api/connections') return { status: 200, body: listConnections() };
  if (p === '/api/frameworks') return { status: 200, body: { frameworks: FRAMEWORKS, matrixColumns: MATRIX_COLUMNS, traceabilityMeta: TRACEABILITY_META } };
  if (p === '/api/runs' && method === 'GET') return { status: 200, body: { runs: listRuns() } };
  if (p === '/api/projects' && method === 'GET') return { status: 200, body: { projects: listProjects() } };
  if (p === '/api/projects' && method === 'POST') {
    const project = createProject({ message: body.message, mode: 'sim' }); saveProject(project); return { status: 201, body: { project } };
  }
  const projectMatch = p.match(/^\\/api\\/projects\\/([^/]+)$/);
  if (projectMatch && method === 'GET') { const project = getProject(decodeURIComponent(projectMatch[1])); return project ? { status: 200, body: { project } } : { status: 404, body: { error: 'project 不存在' } }; }
  if (projectMatch && method === 'PATCH') { const project = getProject(decodeURIComponent(projectMatch[1])); if (!project) return { status: 404, body: { error: 'project 不存在' } }; if (body.brief) project.brief = { ...project.brief, ...body.brief }; project.mode = 'sim'; saveProject(project); return { status: 200, body: { project } }; }
  const messageMatch = p.match(/^\\/api\\/projects\\/([^/]+)\\/messages$/);
  if (messageMatch && method === 'POST') { const project = getProject(decodeURIComponent(messageMatch[1])); appendProjectMessage(project, body.message); saveProject(project); return { status: 200, body: { project } }; }
  const branchMatch = p.match(/^\\/api\\/projects\\/([^/]+)\\/branches$/);
  if (branchMatch && method === 'POST') { const parent = getProject(decodeURIComponent(branchMatch[1])); const project = createProject({ message: body.prompt || ('请验证：' + body.claim), mode: 'sim', parentId: parent.id, branchFrom: body.claim }); saveProject(project); return { status: 201, body: { project } }; }
  const exploreMatch = p.match(/^\\/api\\/projects\\/([^/]+)\\/explore$/);
  if (exploreMatch && method === 'POST') {
    const project = getProject(decodeURIComponent(exploreMatch[1])); const stream = [];
    const result = await exploreProject(project, capabilities(), { onEvent: async event => { saveProject(project); stream.push({ type: 'event', event }); } });
    saveRun(result.run); saveProject(result.project); stream.push({ type: 'complete', project: result.project, run: result.run, review: result.review });
    return { status: 200, stream };
  }
  if (p === '/api/run' && method === 'POST') {
    const { task, agents, mode } = body || {};
    if (!task || !Array.isArray(agents) || !agents.length) return { status: 400, body: { error: 'task 与 agents 必填' } };
    const run = await runParallel({ task, agents, mode: mode || 'sim' });
    saveRun(run);
    return { status: 200, body: { run } };
  }
  if (p.startsWith('/api/runs/') && method === 'GET') {
    const run = getRun(decodeURIComponent(p.split('/').pop()));
    return run ? { status: 200, body: { run } } : { status: 404, body: { error: 'run 不存在' } };
  }
  if (p === '/api/review' && method === 'POST') {
    const run = getRun(body.runId);
    if (!run) return { status: 404, body: { error: 'run 不存在' } };
    return { status: 200, body: { review: review(run, body.mode || 'intersection') } };
  }
  if (p === '/api/trace/diff' && method === 'GET') {
    const run = getRun(url.searchParams.get('runId'));
    if (!run) return { status: 404, body: { error: 'run 不存在' } };
    const a = run.agents.find(x => x.agentId === url.searchParams.get('a'));
    const b = run.agents.find(x => x.agentId === url.searchParams.get('b'));
    if (!a || !b) return { status: 400, body: { error: 'a/b agent 不存在' } };
    return { status: 200, body: { diff: diffTraces(a, b) } };
  }
  return { status: 404, body: { error: 'unknown api' } };
}

// ── 拦截 fetch：/api/* 走本地路由，其余放行 ──
const __origFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const urlStr = typeof input === 'string' ? input : input.url;
  if (urlStr && urlStr.includes('/api/')) {
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    let r;
    try { r = await __handle(method, urlStr, body); }
    catch (e) { r = { status: 500, body: { error: String(e && e.message || e) } }; }
    if (r.stream) return new Response(r.stream.map(x => JSON.stringify(x)).join('\\n') + '\\n', { status: r.status, headers: { 'content-type': 'application/x-ndjson' } });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }
  return __origFetch(input, init);
};
`;

// 3) 浏览器安全的 __ENV：standalone 恒为 Sim。不从 window 注入 key（移除 S1 的 key 泄露/注入向量）；
//    真 Live 必须经本地 server.mjs 后端代理，浏览器单文件版永不直连模型 API。
const envShim = `const __ENV = {};
function getApiKey() { return null; }
function getApiModel(provider) { return provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4.1-mini'; }
function listConnections() { return { cli: [], api: [{ id: 'openai', type: 'api', label: 'OpenAI API', configured: false, runnable: false, model: 'gpt-4.1-mini', note: 'Web 演示不支持配置 API' }, { id: 'anthropic', type: 'api', label: 'Anthropic API', configured: false, runnable: false, model: 'claude-sonnet-4-6', note: 'Web 演示不支持配置 API' }], keychain: false }; }`;

const app = R('web/app.js');
const styles = R('web/styles.css');
step('read', `app.js (${app.length}b) + styles.css (${styles.length}b)`);

// 4) 取 index.html 的 <body> 结构，替换 link/script 为内联
// 组装 JS bundle
const bundle = `${envShim}\n${modules}\n${runtime}\n${app}`;

// 自检①：单作用域里重名的顶层声明会互相覆盖（曾导致 app.js 的 runParallel 覆盖 orchestrator）
{
  const names = {};
  const add = (re, kind) => { let m; while ((m = re.exec(bundle))) (names[m[1]] ||= []).push(kind); };
  add(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, 'function');
  add(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm, 'binding');
  const dups = Object.entries(names).filter(([, v]) => v.length > 1);
  if (dups.length) throw new Error(`顶层重名声明（会互相覆盖）：${dups.map(([n, v]) => `${n}×${v.length}`).join(', ')}`);
  step('check', `无顶层重名（${Object.keys(names).length} 个顶层声明）`);
}

// 自检②：语法（new Function 只解析不执行 → 能抓语法错，不受 window 缺失影响）
try { new Function(bundle); step('check', 'bundle 语法 OK'); }
catch (e) { throw new Error(`bundle 语法错误：${e.message}`); }

let html = R('web/index.html');
// 用替换“函数”而非字符串：字符串替换会把内容里的 $$ / $1 / $& 当成特殊模式（曾导致 const $$ → const $）。
html = html.replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${styles}\n</style>`);
html = html.replace('<script src="app.js"></script>', () => `<script>\n${bundle}\n</script>`);

// 5) 输出
mkdirSync(join(__dirname, 'dist'), { recursive: true });
const distPath = join(__dirname, 'dist', 'aker.html');
writeFileSync(distPath, html);
copyFileSync(distPath, join(__dirname, 'web', 'aker.html'));   // 供 QA 静态访问
copyFileSync(distPath, join(__dirname, 'docs', 'index.html'));  // GitHub Pages
step('write', `dist/aker.html (${html.length}b) + web/aker.html + docs/index.html`);

// 6) 自检：不应再有 http://localhost 依赖、相对 import 残留
if (/from\s+['"]\.\/src/.test(html)) throw new Error('产物仍引用 ./src 模块');
console.log(`✔ done → ${distPath}`);
