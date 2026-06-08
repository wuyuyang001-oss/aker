// adapters.mjs — 可插拔 runner：每个框架一个 adapter
// 双模式：
//   Sim  —— 零 key 可跑，产出“可信的”差异化输出 + 归一化 trace（用于演示与离线评审）
//   Live —— 检测到 key/CLI 时切真实调用（Anthropic/OpenAI HTTP、claude/codex CLI）
// 设计要点：Sim 的多 agent 输出之间“有共识也有分歧”，这样评审会才有真东西可分析。

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { makeStep, summarizeTrace } from './trace.mjs';
import { getFramework, TRACEABILITY_META } from './frameworks.mjs';

export const REVIEW_ROLES = [
  { id: 'strategist', label: '策略评审', brief: '从目标、取舍和长期影响出发，给出方向性判断。' },
  { id: 'critic', label: '反方评审', brief: '主动寻找失败模式、反例、风险和被忽略的约束。' },
  { id: 'operator', label: '执行评审', brief: '把建议落到可操作步骤、验证方式和完成标准。' },
  { id: 'researcher', label: '证据评审', brief: '区分事实、假设与未知项，指出需要补充的证据。' },
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

// 模型“人格”：影响风格与一条独有取向
const MODEL_PERSONA = {
  default:               { style: '均衡', bias: '在可读性与性能间折中' },
  'claude-opus-4-8':     { style: '严谨细致', bias: '强调边界条件与可维护性，倾向多写测试' },
  'claude-sonnet-4-6':   { style: '简洁高效', bias: '优先最小可行改动，控制复杂度' },
  'gpt-x':               { style: '直接果断', bias: '倾向引入成熟库而非自造轮子' },
  'o-series':            { style: '深推理', bias: '会显式列出多个候选方案再择优' },
  'hermes-3':            { style: '开放直白', bias: '给出可私有化/本地化的实现路径' },
  'gemini-x':            { style: '结构化', bias: '强调与现有平台/生态集成' },
};

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
function composeOutput(task, framework, model) {
  const persona = MODEL_PERSONA[model] || MODEL_PERSONA.default;
  const fw = getFramework(framework);
  const tools = FRAMEWORK_TOOLKIT[framework] || [];

  // 三条“共识要点”——所有 agent 都会给（关键词一致，便于聚类成共识）
  const shared = [
    `先明确「${task}」的输入输出与边界条件，再动手实现。`,
    `把核心逻辑与 I/O 解耦，便于测试与替换。`,
    `补充针对「${task}」的单元测试，覆盖正常与异常路径。`,
  ];

  // 模型相关的独有取向
  const modelUnique = `${persona.bias}（${model} 的取向）。`;

  // 框架相关的独有做法（与其工具/范式挂钩）
  const fwUnique = tools.length
    ? `用 ${fw?.name || framework} 时，可借助 [${tools.join('、')}] 在过程中验证假设，降低返工。`
    : `${fw?.name || framework} 无内置工具，建议外包一层执行环境来验证中间结果。`;

  const body = [
    `针对「${task}」的方案（by ${fw?.name || framework} · ${model}，风格：${persona.style}）：`,
    '',
    ...shared.map((s, i) => `${i + 1}. ${s}`),
    `4. ${modelUnique}`,
    `5. ${fwUnique}`,
  ].join('\n');
  return body;
}

// —— 生成归一化 trace（形态贴合该框架的 traceability）—— //
function composeTrace(task, framework, model, seed) {
  const r = rng(seed);
  const tools = FRAMEWORK_TOOLKIT[framework] || [];
  const steps = [];
  let i = 0;
  steps.push(makeStep(i++, 'think', '解析任务与约束', { detail: `拆解「${task}」`, tokens: 120 + Math.floor(r() * 200), ms: 300 + Math.floor(r() * 400) }));
  // 工具调用：每个工具 1-2 次
  for (const t of tools) {
    const times = 1 + Math.floor(r() * 2);
    for (let k = 0; k < times; k++) {
      steps.push(makeStep(i++, 'tool', `调用 ${t}`, { toolName: t, detail: `${t} 第${k + 1}次`, tokens: 40 + Math.floor(r() * 120), ms: 200 + Math.floor(r() * 900) }));
      steps.push(makeStep(i++, 'observe', `${t} 结果`, { detail: '读取/执行结果并更新假设', tokens: 60 + Math.floor(r() * 150), ms: 100 + Math.floor(r() * 200) }));
    }
  }
  // 深推理模型多走一步自审
  if (model === 'o-series' || model === 'claude-opus-4-8') {
    steps.push(makeStep(i++, 'think', '自我验证 / 反思', { detail: '检查边界与潜在错误', tokens: 200 + Math.floor(r() * 200), ms: 500 + Math.floor(r() * 500) }));
  }
  steps.push(makeStep(i++, 'message', '产出最终方案', { tokens: 300 + Math.floor(r() * 300), ms: 400 + Math.floor(r() * 400) }));
  return steps;
}

// —— Sim adapter —— //
async function runSim(framework, model, task, agentId, role) {
  const seed = `${task}::${agentId}::${role || ''}`;
  const steps = composeTrace(task, framework, model, seed);
  // 模拟时延（短，便于演示并行）
  await new Promise((res) => setTimeout(res, 200 + Math.floor(rng(seed)() * 600)));
  return {
    status: 'done',
    mode: 'sim',
    output: composeOutput(task, framework, model),
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
function findExecutable(name) {
  if (typeof process === 'undefined') return null;
  const paths = (process.env.PATH || '').split(delimiter).filter(Boolean).map((dir) => join(dir, name));
  if (name === 'codex') paths.push(
    '/Applications/Codex.app/Contents/Resources/codex',
    join(homedir(), '.local', 'bin', 'codex'),
  );
  for (const path of paths) if (existsSync(path)) return path;
  return null;
}

function configuredModels() {
  return {
    anthropic: process.env.AKER_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    openai: process.env.AKER_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  };
}

function liveCapabilities() {
  const node = typeof process !== 'undefined' && !!process.versions?.node;
  return {
    anthropicKey: node && !!process.env.ANTHROPIC_API_KEY,
    openaiKey: node && !!process.env.OPENAI_API_KEY,
    codexPath: node ? findExecutable('codex') : null,
  };
}

function reviewerPrompt({ task, framework, model, role }) {
  const lens = reviewRole(role);
  return [
    '你是 Aker 评审团中的一名独立评审。请直接分析用户任务，不要修改文件、调用工具或执行外部操作。',
    `你的角色：${lens.label}。${lens.brief}`,
    `运行通道标识：${framework} · ${model}`,
    '',
    '请输出一份可被其他评审合并的独立意见，使用以下结构：',
    '## 结论',
    '用 2-4 句给出明确判断。',
    '## 关键建议',
    '- 3-6 条具体建议，每条只表达一个主张。',
    '## 风险与未知项',
    '- 列出重要风险、假设或需要验证的事项。',
    '## 下一步',
    '- 给出最值得立刻执行的 1-3 步。',
    '',
    `用户任务：\n${task}`,
  ].join('\n');
}

async function runLive(framework, model, task, agentId, role) {
  const caps = liveCapabilities();
  const fw = getFramework(framework);
  const prompt = reviewerPrompt({ task, framework, model, role });
  // 选择真实通道
  if (framework === 'codex-cli' && caps.codexPath) {
    return await callCodexCli(caps.codexPath, model, prompt);
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
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
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
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: task }] }),
  });
  const j = await resp.json();
  // C3：同 Anthropic——非 2xx 必须抛错，不能把 error JSON 当成空输出标成功。
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = j.choices?.[0]?.message?.content || '';
  const steps = [makeStep(0, 'message', 'OpenAI 响应', { tokens: j.usage?.completion_tokens || 0, ms: Date.now() - t0 })];
  return { status: 'done', mode: 'live', output: text, trace: { steps, totals: summarizeTrace(steps), source: { traceability: 'native', how: 'API usage' } } };
}

export function parseCodexEvents(stdout, elapsedMs = 0) {
  const events = String(stdout).split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const steps = [];
  let output = '';
  let usage = {};
  let i = 0;
  for (const event of events) {
    if (event.type === 'item.completed') {
      const item = event.item || {};
      if (item.type === 'agent_message') {
        output = item.text || output;
        steps.push(makeStep(i++, 'message', 'Codex 最终回答', { detail: 'agent_message' }));
      } else if (item.type === 'command_execution') {
        steps.push(makeStep(i++, item.exit_code === 0 ? 'tool' : 'error', 'Codex 命令执行', {
          toolName: 'shell',
          detail: String(item.command || '').slice(0, 240),
        }));
      } else if (item.type === 'file_change') {
        steps.push(makeStep(i++, 'tool', 'Codex 文件变更', { toolName: 'apply_patch' }));
      } else if (item.type === 'reasoning') {
        steps.push(makeStep(i++, 'think', 'Codex 推理阶段'));
      } else if (item.type) {
        steps.push(makeStep(i++, 'observe', `Codex 事件：${item.type}`));
      }
    } else if (event.type === 'error') {
      steps.push(makeStep(i++, 'error', 'Codex 执行错误', { detail: String(event.message || '').slice(0, 240) }));
    } else if (event.type === 'turn.completed') {
      usage = event.usage || {};
    }
  }
  if (!steps.length) steps.push(makeStep(0, 'message', 'Codex CLI 响应'));
  const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const last = steps.at(-1);
  last.tokens = tokens;
  last.ms = elapsedMs;
  return { output, steps, usage };
}

async function callCodexCli(codexPath, model, prompt) {
  const workdir = mkdtempSync(join(tmpdir(), 'aker-codex-'));
  const args = [
    'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--ephemeral', '--ignore-rules', '--ignore-user-config', '-C', workdir,
  ];
  if (model && model !== 'codex-default') args.push('--model', model);
  args.push('-');
  const t0 = Date.now();
  try {
    const { stdout, stderr, code } = await spawnCollect(codexPath, args, prompt, 180_000);
    const parsed = parseCodexEvents(stdout, Date.now() - t0);
    if (code !== 0 || !parsed.output) {
      throw new Error(`Codex CLI ${code || '无输出'}: ${stderr.slice(-400) || '未产生最终回答'}`);
    }
    return {
      status: 'done',
      mode: 'live',
      output: parsed.output,
      usage: parsed.usage,
      trace: {
        steps: parsed.steps,
        totals: summarizeTrace(parsed.steps),
        source: { traceability: 'cli-log', how: 'codex exec --json 真实事件流' },
      },
    };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function spawnCollect(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const append = (current, chunk) => (current + chunk).slice(-2_000_000);
    child.stdout.on('data', (c) => { stdout = append(stdout, c); });
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

export async function synthesizeReview({ task, agents, evidence }) {
  const caps = liveCapabilities();
  const models = configuredModels();
  const agentText = agents.filter((a) => a.status === 'done' && a.output).map((a, i) => (
    `### 评审 ${i + 1}：${a.label || `${a.framework} · ${a.model}`}\n${a.output.slice(0, 6000)}`
  )).join('\n\n');
  const prompt = [
    '你是 Aker 评审团主席。请综合多名独立评审的真实输出，给出一份可以直接执行的最终答复。',
    '不要机械投票；明确处理冲突，区分共识、少数重要意见、风险和未知项。',
    '输出 Markdown，结构必须包含：`## 最终判断`、`## 推荐方案`、`## 风险与验证`、`## 立即行动`。',
    '',
    `用户任务：\n${task.slice(0, 4000)}`,
    '',
    `规则聚类得到的共识：\n${evidence.consensus.map((x) => `- ${x.text}`).join('\n') || '- 无强共识'}`,
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
  } else {
    throw new Error('没有可用于真实综合的 Live 通道');
  }
  return { markdown: result.output, channel, trace: result.trace };
}

// —— 统一入口 —— //
export async function runAgent({ framework, model, task, agentId, role, mode }) {
  if (mode === 'live') {
    return await runLive(framework, model, task, agentId, role);
  }
  return await runSim(framework, model, task, agentId, role);
}

export function capabilities() {
  const caps = liveCapabilities();
  const models = configuredModels();
  const liveAgents = [];
  if (caps.codexPath) liveAgents.push({ framework: 'codex-cli', model: 'codex-default', label: 'Codex CLI · 当前登录' });
  if (caps.openaiKey) liveAgents.push({ framework: 'openai-agents', model: models.openai, label: `OpenAI API · ${models.openai}` });
  if (caps.anthropicKey) liveAgents.push({ framework: 'claude-code', model: models.anthropic, label: `Anthropic API · ${models.anthropic}` });
  const channels = liveAgents.map((a) => a.label);
  return {
    live: liveAgents.length > 0,
    anthropic: caps.anthropicKey,
    openai: caps.openaiKey,
    codex: !!caps.codexPath,
    liveAgents,
    reviewRoles: REVIEW_ROLES,
    note: channels.length ? `可用真实通道：${channels.join('、')}` : '未检测到 Codex CLI 或 API key，只能使用 Sim 演示模式',
  };
}
