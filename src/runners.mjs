import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listConnections, testConnection } from './connections.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.AKER_DATA_DIR || join(__dirname, '..', 'data');
const FILE = join(DATA_DIR, 'runners.json');

const SIM_RUNNERS = [
  { id: 'sim-research-a', label: 'Sim Research A', type: 'sim', framework: 'sim-research', model: 'sim-a', runnable: true, simulated: true },
  { id: 'sim-research-b', label: 'Sim Research B', type: 'sim', framework: 'sim-research', model: 'sim-b', runnable: true, simulated: true },
  { id: 'sim-judge', label: 'Sim Judge', type: 'sim', framework: 'sim-judge', model: 'sim-judge', runnable: true, simulated: true },
].map((runner) => ({
  ...runner,
  capabilities: { search: true, readOnlyTools: true, trace: true, sources: true, subagents: false, judge: true },
  permission: 'simulated-read-only',
}));

function loadImported() {
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(data.runners) ? data.runners : [];
  } catch {
    return [];
  }
}

function saveImported(runners) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ runners }, null, 2));
  renameSync(tmp, FILE);
}

function connectionRunner(item) {
  const isCodex = item.id === 'codex-cli';
  const isApi = item.type === 'api';
  return {
    id: item.id,
    label: item.label,
    type: item.type,
    framework: item.id === 'openai' ? 'openai-agents' : item.id === 'anthropic' ? 'claude-code' : item.id,
    model: item.model || `${item.id.replace('-cli', '')}-default`,
    runnable: !!item.runnable,
    detected: !!item.detected || !!item.configured,
    version: item.version || null,
    note: item.note,
    permission: isCodex ? 'read-only+web-search' : isApi ? 'no-tools' : 'read-only',
    capabilities: {
      search: isCodex,
      readOnlyTools: isCodex,
      trace: isCodex,
      sources: isCodex,
      subagents: false,
      judge: !!item.runnable,
    },
  };
}

function normalizeImported(manifest, githubUrl) {
  const transport = manifest.transport || {};
  const capabilities = manifest.capabilities || {};
  return {
    id: String(manifest.id || '').trim(),
    label: String(manifest.name || manifest.label || manifest.id || '').trim(),
    version: String(manifest.version || 'unknown'),
    type: 'github',
    framework: String(manifest.framework || manifest.id || '').trim(),
    model: String(manifest.model || 'configured-by-agent'),
    githubUrl,
    transport,
    endpoint: String(manifest.endpoint || transport.endpoint || '').replace(/\/$/, ''),
    commands: manifest.commands || {},
    requiredEnv: Array.isArray(manifest.requiredEnv) ? manifest.requiredEnv : [],
    capabilities: {
      search: !!capabilities.search,
      readOnlyTools: !!capabilities.readOnlyTools,
      trace: !!capabilities.trace,
      sources: !!capabilities.sources,
      subagents: !!capabilities.subagents,
      judge: capabilities.judge !== false,
    },
    permission: 'manifest-declared-read-only',
    runnable: !!(manifest.endpoint || transport.endpoint),
    importedAt: new Date().toISOString(),
  };
}

export function deerFlowManifest(endpoint = '') {
  return {
    id: 'deerflow-2',
    name: 'DeerFlow 2.0',
    version: '2.x',
    framework: 'deerflow',
    model: 'configured-by-deerflow',
    endpoint,
    transport: { type: 'langgraph-sse', endpoint },
    capabilities: { search: true, readOnlyTools: true, trace: true, sources: true, subagents: true, judge: true },
    requiredEnv: [],
    commands: {
      install: ['git clone https://github.com/bytedance/deer-flow.git', 'cd deer-flow && make install'],
      start: ['cd deer-flow && make dev'],
      health: ['GET http://localhost:8001/info'],
    },
  };
}

export function validateAgentManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('aker-agent.json 必须是 JSON 对象');
  if (!String(manifest.id || '').trim()) throw new Error('aker-agent.json 缺少 id');
  const type = manifest.transport?.type;
  if (!['http', 'sse', 'langgraph-sse'].includes(type)) throw new Error('transport.type 必须是 http、sse 或 langgraph-sse');
  if (!manifest.capabilities || typeof manifest.capabilities !== 'object') throw new Error('aker-agent.json 缺少 capabilities');
  return manifest;
}

export function listRunners({ includeSim = true } = {}) {
  const connections = listConnections();
  const local = [...connections.cli, ...connections.api]
    .filter((item) => item.id !== 'aider')
    .map(connectionRunner);
  const imported = loadImported().map((runner) => ({
    ...runner,
    runnable: !!runner.endpoint,
    note: runner.endpoint ? `连接 ${runner.endpoint}` : '已导入；配置 Gateway 地址后可运行',
  }));
  return [...local, ...imported, ...(includeSim ? SIM_RUNNERS : [])];
}

export function getRunner(id) {
  return listRunners().find((runner) => runner.id === id) || null;
}

export async function importGithubRunner({ url, endpoint = '' }) {
  const githubUrl = String(url || '').trim().replace(/\/$/, '');
  const match = githubUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error('请输入形如 https://github.com/owner/repo 的仓库地址');
  const [, owner, rawRepo] = match;
  const repo = rawRepo.replace(/\.git$/, '');
  let manifest;
  if (owner.toLowerCase() === 'bytedance' && repo.toLowerCase() === 'deer-flow') {
    manifest = deerFlowManifest(endpoint);
  } else {
    const candidates = ['main', 'master'];
    for (const branch of candidates) {
      const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/aker-agent.json`, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) { manifest = await response.json(); break; }
    }
    if (!manifest) throw new Error('仓库根目录未找到可读取的 aker-agent.json');
    if (endpoint) manifest.endpoint = endpoint;
  }
  validateAgentManifest(manifest);
  const runner = normalizeImported(manifest, githubUrl);
  const runners = loadImported().filter((item) => item.id !== runner.id);
  runners.push(runner);
  saveImported(runners);
  return {
    runner,
    confirmationRequired: !!Object.keys(runner.commands || {}).length,
    commandPreview: runner.commands || {},
    message: '已导入适配器清单。Aker 未执行任何安装或启动命令。',
  };
}

export async function testRunner(id) {
  const runner = getRunner(id);
  if (!runner) throw new Error('Runner 不存在');
  if (runner.type === 'cli' || runner.type === 'api') return testConnection(id);
  if (runner.type === 'sim') return { ok: true, id, message: 'Sim Runner 可用于演示；不会产生真实研究证据' };
  if (!runner.endpoint) return { ok: false, id, message: '请先配置已运行的 Gateway 地址' };
  const paths = runner.transport?.type === 'langgraph-sse' ? ['/info', '/ok', '/health'] : ['/health', '/'];
  for (const path of paths) {
    try {
      const response = await fetch(`${runner.endpoint}${path}`, { signal: AbortSignal.timeout(8_000) });
      if (response.ok) return { ok: true, id, message: `${runner.label} Gateway 可访问（${path}）` };
    } catch {}
  }
  return { ok: false, id, message: `${runner.label} Gateway 不可访问：${runner.endpoint}` };
}
