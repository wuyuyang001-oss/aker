// adapters.mjs — 可插拔 runner：每个框架一个 adapter
// 双模式：
//   Sim  —— 零 key 可跑，产出“可信的”差异化输出 + 归一化 trace（用于演示与离线评审）
//   Live —— 检测到 key/CLI 时切真实调用（Anthropic/OpenAI HTTP、claude/codex CLI）
// 设计要点：Sim 的多 agent 输出之间“有共识也有分歧”，这样评审会才有真东西可分析。

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStep, summarizeTrace } from './trace.mjs';
import { getFramework, TRACEABILITY_META } from './frameworks.mjs';
import { getApiKey, getApiModel, listConnections } from './connections.mjs';

export const REVIEW_ROLES = [
  { id: 'strategist', label: '策略视角', brief: '比较可选路径、机会成本、可逆性和长期影响，给出有条件的方向判断。' },
  { id: 'critic', label: '反方视角', brief: '构造最强反对意见和失败预演，主动寻找共同盲区与不可接受结果。' },
  { id: 'operator', label: '行动视角', brief: '把建议变成低成本验证、明确负责人、停止条件和下一步行动。' },
  { id: 'researcher', label: '证据视角', brief: '区分事实、假设与推断，检查证据质量；绝不虚构来源或把未知项写成事实。' },
];

function reviewRole(id) {
  return REVIEW_ROLES.find((r) => r.id === id) || REVIEW_ROLES[0];
}

// —— 确定性伪随机（同 task+agent 复现）——
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 框架决定 trace 里会出现哪些“工具”与步骤形态
const FRAMEWORK_TOOLKIT = {
  'claude-code':  ['Read', 'Edit', 'Bash'],
  'codex-cli':    ['shell', 'apply_patch'],
  'hermes':       [],
  'langgraph':    ['retriever', 'python_repl'],
  'crewai':       ['search', 'writer'],
  'autogen':      ['code_exec'],
  'openai-agents':['web_search', 'handoff'],
  'google-adk':   ['vertex_search'],
  'smolagents':   ['python_code'],
  'aider':        ['git', 'edit_block'],
};

// —— 生成差异化但有共识的输出 —— //
function composeOutput(task, framework, model, role) {
  const suppliedSources = [...String(task).matchAll(/^### \[(S\d+)\]/gm)].map((match) => match[1]);
  const roleSpecific = {
    strategist: {
      claim: '[推断] 当前机会的可逆性高于一次性全面投入，先试点能保留后续选择权。',
      objection: '如果窗口期很短，过度验证可能让团队错过先发优势。',
      validation: '比较“小规模试点”和“立即全面投入”的机会成本，并明确决策截止时间。',
    },
    critic: {
      claim: '[假设] 最大风险不是实现失败，而是在缺乏真实需求时投入并形成维护负担。',
      objection: '过度强调风险可能让团队持续延后，错失本可快速验证的机会。',
      validation: '做一次失败预演，写出三个不可接受结果及其最早预警信号。',
    },
    operator: {
      claim: '[推断] 只有把成功标准、负责人和停止条件写清，验证结果才会真正改变决策。',
      objection: '如果验证周期和正式实施成本接近，小试点可能只是额外工作。',
      validation: '把一个关键未知项转成 1-7 天可完成的实验，预先约定通过与停止阈值。',
    },
    researcher: {
      claim: suppliedSources.length
        ? `[事实] 用户提供了 ${suppliedSources.length} 个可审查来源（${suppliedSources.map((id) => `[${id}]`).join('、')}）；来源内容仍需与具体主张逐条对应，不能仅凭存在来源就确认结论。`
        : '[未知] 当前简报没有提供足够的外部证据，不能把需求强度和预期收益视为事实。',
      objection: '等待完美证据既不现实，也可能比小规模行动更昂贵。',
      validation: '列出会改变结论的三项证据，优先获取成本最低且影响最大的那一项。',
    },
  }[role] || {
    claim: '[推断] 当前最稳妥的路径是先验证关键未知项。',
    objection: '验证本身也有成本，不能无限延后决定。',
    validation: '选择影响最大且最容易验证的未知项先行动。',
  };

  const body = [
    `## 模拟研究结果`,
    '> 这是 Sim Runner 生成的流程演示，不是真实调研结论，也不会进入事实融合。',
    '',
    '## 主要发现',
    '- [未知] 当前没有真实联网检索结果，无法确认可能变化的外部事实。',
    `- ${roleSpecific.claim}`,
    '',
    '## 可能的分歧',
    `- ${roleSpecific.objection}`,
    '',
    '## 证据缺口',
    '- 真实用户行为、执行成本或不可接受风险与当前假设明显不符。',
    '',
    '## 来源',
    '- Sim 模式没有真实来源。',
  ].join('\n');
  return body;
}

// —— 生成归一化 trace（形态贴合该框架的 traceability）—— //
function composeTrace(task, framework, model, seed) {
  const r = rng(seed);
  const tools = FRAMEWORK_TOOLKIT[framework] || [];
  const steps = [];
  let i = 0;
  steps.push(makeStep(i++, 'plan', '模拟拆解任务与约束', { detail: `拆解「${task}」`, tokens: 120 + Math.floor(r() * 200), ms: 300 + Math.floor(r() * 400) }));
  // 工具调用：每个工具 1-2 次
  for (const t of tools) {
    const times = 1 + Math.floor(r() * 2);
    for (let k = 0; k < times; k++) {
      steps.push(makeStep(i++, 'tool', `调用 ${t}`, { toolName: t, detail: `${t} 第${k + 1}次`, tokens: 40 + Math.floor(r() * 120), ms: 200 + Math.floor(r() * 900) }));
      steps.push(makeStep(i++, 'observation', `${t} 模拟结果`, { detail: '模拟读取结果', tokens: 60 + Math.floor(r() * 150), ms: 100 + Math.floor(r() * 200) }));
    }
  }
  // 深推理模型多走一步自审
  if (model === 'o-series' || model === 'claude-opus-4-8') {
    steps.push(makeStep(i++, 'plan', '模拟复核计划', { detail: '检查边界与潜在错误', tokens: 200 + Math.floor(r() * 200), ms: 500 + Math.floor(r() * 500) }));
  }
  steps.push(makeStep(i++, 'message', '产出最终方案', { tokens: 300 + Math.floor(r() * 300), ms: 400 + Math.floor(r() * 400) }));
  return steps;
}

// —— Sim adapter —— //
async function runSim(framework, model, task, agentId, role, onStep) {
  const seed = `${task}::${agentId}::${role || ''}`;
  const steps = composeTrace(task, framework, model, seed);
  // 模拟时延（短，便于演示并行）
  await new Promise((res) => setTimeout(res, 200 + Math.floor(rng(seed)() * 600)));
  for (const step of steps) await onStep?.(step);
  return {
    status: 'done',
    mode: 'sim',
    output: composeOutput(task, framework, model, role),
    // 诚实性（H2）：Sim 模式没有真实采集任何 trace——没有 jsonl/transcript/OTel span，
    // step 全是 composeTrace 用模板拼出来的。因此这里固定标 'sim'，**不**复用框架图鉴里
    // 该框架在真实环境下能达到的 traceability 等级（native/otel/cli-log），避免在 UI 上
    // 冒充「本次实际拿到的 trace 等级」。框架自身的可得性分级只在「框架图鉴」里展示。
    trace: { steps, totals: summarizeTrace(steps), source: simTraceSource() },
  };
}

// Sim 模式固定的 trace 来源标记：与框架真实 traceability 解耦。
function simTraceSource() {
  return {
    traceability: 'sim',
    how: TRACEABILITY_META.sim.hint,
    simulated: true,
  };
}

// —— Live adapter（检测到能力时启用；不可用时明确失败，不静默降级）—— //
function configuredModels() {
  return {
    anthropic: process.env.AKER_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || getApiModel('anthropic'),
    openai: process.env.AKER_OPENAI_MODEL || process.env.OPENAI_MODEL || getApiModel('openai'),
  };
}

function liveCapabilities() {
  const node = typeof process !== 'undefined' && !!process.versions?.node;
  const cli = node ? listConnections().cli : [];
  return {
    anthropicKey: node && !!getApiKey('anthropic'),
    openaiKey: node && !!getApiKey('openai'),
    codexPath: cli.find((item) => item.id === 'codex-cli' && item.runnable)?.path || null,
    claudePath: cli.find((item) => item.id === 'claude-cli' && item.runnable)?.path || null,
    geminiPath: cli.find((item) => item.id === 'gemini-cli' && item.runnable)?.path || null,
  };
}

function reviewerPrompt({ task, framework, model }) {
  return [
    '你是 Aker 中独立执行开放任务的 Agent。你看不到其他 Agent 的答案，请直接完成任务。',
    '允许联网搜索、网页读取、本地只读访问和隔离计算。禁止修改文件，禁止向真实外部系统提交、发送、创建或写入数据。',
    '若任务要求调研或时效性信息，必须实际搜索并引用可核验 URL；绝不虚构事实、数据或来源。',
    `运行通道标识：${framework} · ${model}`,
    '',
    `用户任务：\n${task}`,
  ].join('\n');
}

async function runLive(framework, model, task, agentId, role, runner, onStep) {
  const caps = liveCapabilities();
  const fw = getFramework(framework);
  const prompt = reviewerPrompt({ task, framework, model });
  if (runner?.transport?.type === 'langgraph-sse' && runner.endpoint) {
    return await callDeerFlow(runner, prompt, onStep);
  }
  // 选择真实通道
  if (framework === 'codex-cli' && caps.codexPath) {
    return await callCodexCli(caps.codexPath, model, prompt, onStep);
  }
  if (framework === 'claude-cli' && caps.claudePath) {
    return await callClaudeCli(caps.claudePath, model, prompt);
  }
  if (framework === 'gemini-cli' && caps.geminiPath) {
    return await callGeminiCli(caps.geminiPath, model, prompt);
  }
  if ((fw?.vendor === 'Anthropic' || model.startsWith('claude')) && caps.anthropicKey) {
    return await callAnthropic(model, prompt);
  }
  if ((fw?.vendor === 'OpenAI' || model.startsWith('gpt') || model.startsWith('o-')) && caps.openaiKey) {
    return await callOpenAI(model, prompt);
  }
  throw new Error(`live-unavailable:${framework}/${model}`);
}

async function callAnthropic(model, task) {
  const t0 = Date.now();
  const key = getApiKey('anthropic');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: task }] }),
  });
  const j = await resp.json();
  // C3：401/429/5xx 不能当成功——否则会 return 一个空 output 但标 status:done/mode:live，
  // 把空串塞进评审聚类污染结果。这里如实抛错，由编排器标成失败。
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = (j.content || []).map((b) => b.text).join('\n');
  const steps = [makeStep(0, 'message', 'Anthropic 响应', { tokens: j.usage?.output_tokens || 0, ms: Date.now() - t0 })];
  return { status: 'done', mode: 'live', output: text, trace: { steps, totals: summarizeTrace(steps), source: { traceability: 'native', how: 'API usage + (可升级为 Agent SDK transcript)' } } };
}

async function callOpenAI(model, task) {
  const t0 = Date.now();
  const key = getApiKey('openai');
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: task }] }),
  });
  const j = await resp.json();
  // C3：同 Anthropic——非 2xx 必须抛错，不能把 error JSON 当成空输出标成功。
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = j.choices?.[0]?.message?.content || '';
  const steps = [makeStep(0, 'message', 'OpenAI 响应', { tokens: j.usage?.completion_tokens || 0, ms: Date.now() - t0 })];
  return { status: 'done', mode: 'live', output: text, trace: { steps, totals: summarizeTrace(steps), source: { traceability: 'native', how: 'API usage' } } };
}

export function normalizeCodexEvent(event, i = 0) {
  if (event.type === 'item.started' || event.type === 'item.completed' || event.type === 'item.updated') {
    const item = event.item || {};
    const text = String(item.text || item.content || item.query || item.url || '');
    if (item.type === 'agent_message') return makeStep(i, 'message', 'Codex 回答', { detail: text.slice(0, 240) });
    if (item.type === 'command_execution') return makeStep(i, item.exit_code === 0 || item.exit_code == null ? 'tool' : 'error', 'Codex 命令执行', { toolName: 'shell', detail: String(item.command || '').slice(0, 240) });
    if (item.type === 'file_change') return makeStep(i, 'error', 'Codex 尝试文件变更（已被只读沙箱阻止）', { toolName: 'apply_patch' });
    if (/web_search|search_query|search/i.test(item.type || '')) return makeStep(i, 'search', 'Codex 搜索', { query: text.slice(0, 240), detail: text.slice(0, 240) });
    if (/fetch|webpage|page|browser/i.test(item.type || '')) return makeStep(i, 'fetch', 'Codex 读取网页', { url: item.url || null, detail: text.slice(0, 240) });
    if (/source|citation/i.test(item.type || '')) return makeStep(i, 'source', 'Codex 发现来源', { url: item.url || null, detail: text.slice(0, 240) });
    if (/reasoning|plan/i.test(item.type || '')) return makeStep(i, 'plan', 'Codex 更新执行计划');
    if (item.type) return makeStep(i, 'observation', `Codex 事件：${item.type}`, { detail: text.slice(0, 240) });
  }
  if (event.type === 'error') return makeStep(i, 'error', 'Codex 执行错误', { detail: String(event.message || '').slice(0, 240) });
  if (event.type === 'turn.failed') return makeStep(i, 'error', 'Codex 回合失败', { detail: String(event.error?.message || 'Codex turn failed').slice(0, 240) });
  return null;
}

export function parseCodexEvents(stdout, elapsedMs = 0) {
  const events = String(stdout).split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const steps = [];
  let output = '';
  let usage = {};
  const errors = [];
  let i = 0;
  for (const event of events) {
    const step = normalizeCodexEvent(event, i);
    if (step) { steps.push(step); i++; }
    if (event.type === 'item.completed') {
      const item = event.item || {};
      if (item.type === 'agent_message') {
        output = item.text || output;
      }
    } else if (event.type === 'error') {
      const message = String(event.message || '');
      errors.push(message);
    } else if (event.type === 'turn.failed') {
      const message = String(event.error?.message || 'Codex turn failed');
      errors.push(message);
    } else if (event.type === 'turn.completed') {
      usage = event.usage || {};
    }
  }
  if (!steps.length) steps.push(makeStep(0, 'message', 'Codex CLI 响应'));
  const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const last = steps.at(-1);
  last.tokens = tokens;
  last.ms = elapsedMs;
  return { output, steps, usage, errors };
}

export function codexExecArgs(model, workdir) {
  const args = [
    '--search', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--ephemeral', '--ignore-rules', '--ignore-user-config', '-C', workdir,
  ];
  if (model && model !== 'codex-default') args.push('--model', model);
  args.push('-');
  return args;
}

async function callCodexCli(codexPath, model, prompt, onStep) {
  const workdir = mkdtempSync(join(tmpdir(), 'aker-codex-'));
  const args = codexExecArgs(model, workdir);
  const t0 = Date.now();
  try {
    const { stdout, stderr, code } = await spawnCollect(codexPath, args, prompt, 180_000, undefined, (line) => {
      try {
        const event = JSON.parse(line);
        const step = normalizeCodexEvent(event);
        if (step) onStep?.(step);
      } catch {}
    });
    const parsed = parseCodexEvents(stdout, Date.now() - t0);
    if (code !== 0 || !parsed.output) {
      const eventError = parsed.errors.at(-1);
      throw new Error(`Codex CLI ${code || '无输出'}: ${eventError || stderr.slice(-400) || '未产生最终回答'}`);
    }
    return {
      status: 'done',
      mode: 'live',
      output: parsed.output,
      usage: parsed.usage,
      trace: {
        steps: parsed.steps,
        totals: summarizeTrace(parsed.steps),
        source: { traceability: 'cli-log', how: 'codex --search exec --json --sandbox read-only 真实事件流' },
      },
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

async function callClaudeCli(claudePath, model, prompt) {
  const workdir = mkdtempSync(join(tmpdir(), 'aker-claude-'));
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'plan', '--tools', '', '--no-session-persistence'];
  if (model && model !== 'claude-default') args.push('--model', model);
  const t0 = Date.now();
  try {
    const { stdout, stderr, code } = await spawnCollect(claudePath, args, prompt, 180_000, workdir);
    let payload;
    try { payload = JSON.parse(stdout); } catch {}
    const output = payload?.result || payload?.response || stdout.trim();
    if (code !== 0 || !output) throw new Error(`Claude Code ${code || '无输出'}: ${payload?.error || stderr.slice(-400) || '未产生最终回答'}`);
    const steps = [makeStep(0, 'message', 'Claude Code 最终回答', { tokens: payload?.usage?.output_tokens || 0, ms: Date.now() - t0 })];
    return {
      status: 'done',
      mode: 'live',
      output,
      usage: payload?.usage || {},
      trace: { steps, totals: summarizeTrace(steps), source: { traceability: 'native', how: 'claude -p JSON 响应' } },
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

async function callGeminiCli(geminiPath, model, prompt) {
  const workdir = mkdtempSync(join(tmpdir(), 'aker-gemini-'));
  const args = ['-p', prompt, '--output-format', 'json', '--approval-mode=plan'];
  if (model && model !== 'gemini-default') args.push('--model', model);
  const t0 = Date.now();
  try {
    const { stdout, stderr, code } = await spawnCollect(geminiPath, args, '', 180_000, workdir);
    let payload;
    try { payload = JSON.parse(stdout); } catch {}
    const output = payload?.response || payload?.result || stdout.trim();
    if (code !== 0 || !output) throw new Error(`Gemini CLI ${code || '无输出'}: ${payload?.error?.message || stderr.slice(-400) || '未产生最终回答'}`);
    const steps = [makeStep(0, 'message', 'Gemini CLI 最终回答', { tokens: payload?.stats?.models?.total?.tokens || 0, ms: Date.now() - t0 })];
    return {
      status: 'done',
      mode: 'live',
      output,
      usage: payload?.stats || {},
      trace: { steps, totals: summarizeTrace(steps), source: { traceability: 'native', how: 'gemini headless JSON 响应' } },
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function spawnCollect(command, args, input, timeoutMs, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const append = (current, chunk) => (current + chunk).slice(-2_000_000);
    let lineBuffer = '';
    child.stdout.on('data', (c) => {
      stdout = append(stdout, c);
      lineBuffer += c.toString();
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const line of lines.filter(Boolean)) onLine?.(line);
    });
    child.stderr.on('data', (c) => { stderr = append(stderr, c); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`runner timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export function normalizeDeerFlowEvent(event, data, i = 0) {
  const type = String(event || data?.event || data?.type || '');
  const text = String(data?.query || data?.url || data?.name || data?.content || data?.message || '');
  if (/search/i.test(type)) return makeStep(i, 'search', 'DeerFlow 搜索', { query: data?.query || text, detail: text.slice(0, 240) });
  if (/source|citation/i.test(type)) return makeStep(i, 'source', 'DeerFlow 来源', { url: data?.url || null, detail: text.slice(0, 240) });
  if (/fetch|browser|page/i.test(type)) return makeStep(i, 'fetch', 'DeerFlow 读取网页', { url: data?.url || null, detail: text.slice(0, 240) });
  if (/subagent|handoff/i.test(type)) return makeStep(i, 'subagent', 'DeerFlow 子 Agent', { detail: text.slice(0, 240) });
  if (/tool/i.test(type)) return makeStep(i, 'tool', 'DeerFlow 工具调用', { toolName: data?.name || data?.tool || 'tool', detail: text.slice(0, 240) });
  if (/error/i.test(type)) return makeStep(i, 'error', 'DeerFlow 错误', { detail: text.slice(0, 240) });
  if (/message|values|updates/i.test(type)) return makeStep(i, 'message', 'DeerFlow 消息', { detail: text.slice(0, 240) });
  return makeStep(i, 'observation', `DeerFlow 事件：${type || 'event'}`, { detail: text.slice(0, 240) });
}

function lastMessageText(data) {
  const messages = data?.messages || data?.values?.messages || [];
  const last = Array.isArray(messages) ? messages.at(-1) : null;
  if (typeof last?.content === 'string') return last.content;
  if (Array.isArray(last?.content)) return last.content.map((item) => item.text || item.content || '').join('\n');
  return typeof data?.content === 'string' ? data.content : '';
}

async function callDeerFlow(runner, prompt, onStep) {
  const endpoint = runner.endpoint.replace(/\/$/, '');
  const threadResponse = await fetch(`${endpoint}/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!threadResponse.ok) throw new Error(`DeerFlow 创建线程失败：HTTP ${threadResponse.status}`);
  const thread = await threadResponse.json();
  const threadId = thread.thread_id || thread.id;
  const response = await fetch(`${endpoint}/threads/${encodeURIComponent(threadId)}/runs/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      assistant_id: runner.transport?.assistantId || 'lead_agent',
      input: { messages: [{ role: 'user', content: prompt }] },
      stream_mode: ['updates', 'values', 'messages'],
    }),
  });
  if (!response.ok || !response.body) throw new Error(`DeerFlow 流式运行失败：HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const steps = [];
  let buffer = '', eventName = '', output = '', i = 0;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      let data = null;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) {
          try { data = JSON.parse(line.slice(5).trim()); } catch {}
        }
      }
      if (!data) continue;
      const step = normalizeDeerFlowEvent(eventName, data, i++);
      steps.push(step);
      await onStep?.(step);
      output = lastMessageText(data) || output;
    }
    if (done) break;
  }
  if (!output) throw new Error('DeerFlow 未返回最终回答');
  return {
    status: 'done',
    mode: 'live',
    output,
    trace: { steps, totals: summarizeTrace(steps), source: { traceability: 'native', how: 'DeerFlow Gateway / LangGraph SSE' } },
  };
}

export async function synthesizeReview({ task, agents, evidence }) {
  const caps = liveCapabilities();
  const models = configuredModels();
  const agentText = agents.filter((a) => a.status === 'done' && a.output).map((a, i) => (
    `### 评审 ${i + 1}：${a.label || `${a.framework} · ${a.model}`}\n${a.output.slice(0, 6000)}`
  )).join('\n\n');
  const prompt = [
    '你是 Aker 决策委员会主席。请把多名独立判断者的真实输出综合成一份可直接用于做决定的决策包。',
    '不要机械投票，也不要把共识当成事实。应评估主张依据、保留可能关键的少数意见、明确共同盲区，并指出当前信息是否足以做决定。',
    '不要虚构事实、证据、数据或来源。缺乏依据的主张必须明确标成假设、推断或未知。',
    '输出 Markdown，结构必须包含：',
    '`## 建议与置信度`：明确建议、置信度以及建议成立的条件；',
    '`## 为什么这样决定`：列出最关键依据，并标明事实/假设/推断；',
    '`## 最强反对意见`：呈现最可能推翻建议的观点，而不是弱化它；',
    '`## 未解决的不确定性`：说明哪些未知项仍然重要；',
    '`## 最低成本验证`：按优先级给出验证动作、观察指标和停止条件；',
    '`## 立即行动`：给出未来 1-7 天内可以执行的具体步骤。',
    '',
    `用户决策简报：\n${task.slice(0, 8000)}`,
    '',
    `规则聚类识别出的共同主张（只表示文字相近，不代表正确）：\n${evidence.consensus.map((x) => `- ${x.text}`).join('\n') || '- 无强共同主张'}`,
    '',
    agentText,
  ].join('\n');
  let result;
  let channel;
  if (caps.openaiKey) {
    channel = `OpenAI API · ${models.openai}`;
    result = await callOpenAI(models.openai, prompt);
  } else if (caps.anthropicKey) {
    channel = `Anthropic API · ${models.anthropic}`;
    result = await callAnthropic(models.anthropic, prompt);
  } else if (caps.codexPath) {
    channel = 'Codex CLI';
    result = await callCodexCli(caps.codexPath, 'codex-default', prompt);
  } else if (caps.claudePath) {
    channel = 'Claude Code';
    result = await callClaudeCli(caps.claudePath, 'claude-default', prompt);
  } else if (caps.geminiPath) {
    channel = 'Gemini CLI';
    result = await callGeminiCli(caps.geminiPath, 'gemini-default', prompt);
  } else {
    throw new Error('没有可用于真实综合的 Live 通道');
  }
  return { markdown: result.output, channel, trace: result.trace };
}

// —— 统一入口 —— //
export async function runAgent({ runner, framework, model, task, agentId, role, mode, onStep }) {
  if (mode === 'live') {
    return await runLive(framework, model, task, agentId, role, runner, onStep);
  }
  return await runSim(framework, model, task, agentId, role, onStep);
}

export function capabilities() {
  const caps = liveCapabilities();
  const models = configuredModels();
  const liveAgents = [];
  if (caps.codexPath) liveAgents.push({ framework: 'codex-cli', model: 'codex-default', label: 'Codex CLI · 当前登录' });
  if (caps.claudePath) liveAgents.push({ framework: 'claude-cli', model: 'claude-default', label: 'Claude Code · 当前登录' });
  if (caps.geminiPath) liveAgents.push({ framework: 'gemini-cli', model: 'gemini-default', label: 'Gemini CLI · 当前登录' });
  if (caps.openaiKey) liveAgents.push({ framework: 'openai-agents', model: models.openai, label: `OpenAI API · ${models.openai}` });
  if (caps.anthropicKey) liveAgents.push({ framework: 'claude-code', model: models.anthropic, label: `Anthropic API · ${models.anthropic}` });
  const channels = liveAgents.map((a) => a.label);
  return {
    live: liveAgents.length > 0,
    anthropic: caps.anthropicKey,
    openai: caps.openaiKey,
    codex: !!caps.codexPath,
    claudeCli: !!caps.claudePath,
    geminiCli: !!caps.geminiPath,
    liveAgents,
    reviewRoles: REVIEW_ROLES,
    note: channels.length
      ? `检测到真实通道：${channels.join('、')}。实际调用仍取决于登录状态、额度与网络`
      : '未检测到 Codex CLI 或 API key，只能使用 Sim 演示模式',
    connections: listConnections(),
  };
}
