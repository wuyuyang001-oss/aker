import { runAgent } from './adapters.mjs';
import { summarizeTrace } from './trace.mjs';
import { getRunner, listRunners } from './runners.mjs';

let counter = 1;
const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;
const clean = (value = '') => String(value).replace(/\s+/g, ' ').trim();

export const DEFAULT_RUBRIC = [
  { id: 'instruction', label: '任务遵循度', weight: 20 },
  { id: 'coverage', label: '完整性', weight: 25 },
  { id: 'evidence', label: '证据质量', weight: 30 },
  { id: 'consistency', label: '事实一致性', weight: 15 },
  { id: 'unique', label: '独有贡献', weight: 10 },
];

export function classifyTask(message) {
  const text = clean(message);
  const research = /调研|研究|竞品|市场|行业|趋势|现状|比较|对比|查找|搜索|资料|research|competitor|market|survey/i.test(text);
  const freshness = /最新|目前|当前|今天|近期|近[一二三四五六七八九十\d]+|202[4-9]|latest|current|today|recent/i.test(text);
  return { research, freshness, evidencePolicy: research || freshness ? 'required' : 'preferred' };
}

export function deriveTaskBrief(message, previous = {}) {
  const objective = clean(message);
  const classification = classifyTask(objective);
  return {
    objective: previous.objective || objective,
    deliverable: previous.deliverable || (classification.research ? '一份覆盖主要发现、分歧、证据缺口与完整来源的研究报告。' : '一份直接回答任务、解释依据并说明局限的完整结果。'),
    scope: previous.scope || '围绕用户给出的任务边界展开；不擅自执行外部写入操作。',
    constraints: previous.constraints || '允许联网搜索、网页读取、本地只读访问和隔离计算；禁止提交、发送、修改或写入真实外部系统。',
    freshness: previous.freshness || (classification.freshness ? '需要核验当前信息和日期。' : '若使用可能变化的事实，应说明信息日期。'),
    evidencePolicy: previous.evidencePolicy || classification.evidencePolicy,
  };
}

function recommendedSelection(mode) {
  const runners = listRunners();
  const candidates = runners.filter((runner) => runner.runnable && (mode === 'sim' ? runner.type === 'sim' : runner.type !== 'sim'));
  const answerers = candidates.filter((runner) => runner.id !== 'sim-judge').slice(0, 3);
  const judge = candidates.find((runner) => !answerers.some((item) => item.id === runner.id) && runner.capabilities.judge)
    || candidates.find((runner) => runner.capabilities.judge)
    || null;
  return { selectedRunnerIds: answerers.slice(0, 2).map((runner) => runner.id), judgeRunnerId: judge?.id || null };
}

export function createTask({ message, mode = 'live', selectedRunnerIds, judgeRunnerId, rubric, evidencePolicy }) {
  const now = new Date().toISOString();
  const recommended = recommendedSelection(mode);
  const brief = deriveTaskBrief(message);
  if (evidencePolicy) brief.evidencePolicy = evidencePolicy;
  return {
    id: id('task'),
    title: clean(message).slice(0, 64),
    kind: 'agent-comparison',
    status: 'ready',
    mode,
    createdAt: now,
    updatedAt: now,
    brief,
    selectedRunnerIds: selectedRunnerIds?.length ? selectedRunnerIds.slice(0, 4) : recommended.selectedRunnerIds,
    judgeRunnerId: judgeRunnerId || recommended.judgeRunnerId,
    rubric: Array.isArray(rubric) && rubric.length ? rubric : DEFAULT_RUBRIC.map((item) => ({ ...item })),
    runs: [],
    scorecards: [],
    finalAnswer: '',
    evaluation: null,
    messages: [
      { id: id('msg'), role: 'user', content: clean(message), createdAt: now },
      { id: id('msg'), role: 'assistant', content: `已生成任务简报。证据策略：${brief.evidencePolicy === 'required' ? '必须检索并引用来源' : '优先使用证据'}。请选择 Agent 与独立 Judge 后开始对比。`, createdAt: now },
    ],
  };
}

export function patchTask(task, update) {
  if (update.brief && typeof update.brief === 'object') task.brief = { ...task.brief, ...update.brief };
  if (Array.isArray(update.selectedRunnerIds)) task.selectedRunnerIds = [...new Set(update.selectedRunnerIds)].slice(0, 4);
  if (typeof update.judgeRunnerId === 'string') task.judgeRunnerId = update.judgeRunnerId || null;
  if (Array.isArray(update.rubric) && update.rubric.length) task.rubric = update.rubric;
  if (update.mode === 'live' || update.mode === 'sim') task.mode = update.mode;
  if (clean(update.title)) task.title = clean(update.title).slice(0, 80);
  task.updatedAt = new Date().toISOString();
  return task;
}

export function taskPrompt(task) {
  const brief = task.brief;
  return [
    '你是 Aker 中独立执行任务的 Agent。请直接完成任务，而不是给用户布置下一步。',
    '允许使用联网搜索、网页读取、本地只读访问和隔离计算。禁止修改文件，禁止向任何真实外部系统提交、发送、创建或写入数据。',
    brief.evidencePolicy === 'required'
      ? '这是证据必需任务：必须实际搜索或读取来源；重要事实附可核验 URL。若无法检索，请明确说明，不要凭记忆冒充已调研。'
      : '优先提供可核验依据；不要虚构来源。',
    '输出应覆盖主要发现、关键分歧、局限和来源。不要写决策建议，除非用户任务明确要求。',
    '',
    `## 任务目标\n${brief.objective}`,
    `## 期望交付物\n${brief.deliverable}`,
    `## 范围\n${brief.scope}`,
    `## 约束\n${brief.constraints}`,
    `## 时效性\n${brief.freshness}`,
    `## 证据策略\n${brief.evidencePolicy}`,
  ].join('\n\n');
}

export function researchCompletion(run, task) {
  const totals = summarizeTrace(run.trace?.steps || []);
  const hasEvidence = totals.searches > 0 || totals.fetches > 0 || totals.sources > 0;
  const required = task.brief.evidencePolicy === 'required';
  return {
    required,
    hasEvidence,
    complete: run.status === 'done' && (!required || hasEvidence) && !run.simulated,
    reason: required && !hasEvidence ? '未完成调研：没有搜索、网页读取或来源 Trace' : run.simulated ? 'Sim 输出不进入事实融合' : '',
  };
}

export async function runTask(task, { onEvent } = {}) {
  if (!task.selectedRunnerIds?.length) throw new Error('至少选择 1 个 Agent');
  task.status = 'running';
  task.runs = [];
  task.finalAnswer = '';
  task.scorecards = [];
  const prompt = taskPrompt(task);
  const emit = async (event) => onEvent?.({ at: new Date().toISOString(), ...event }, task);

  await Promise.all(task.selectedRunnerIds.map(async (runnerId, index) => {
    const runner = getRunner(runnerId);
    const runId = id('agentRun');
    const base = {
      id: runId,
      agentId: `${runnerId}#${index + 1}`,
      runnerId,
      label: runner?.label || runnerId,
      framework: runner?.framework || runnerId,
      model: runner?.model || 'unknown',
      capability: runner?.capabilities || {},
      status: 'running',
      startedAt: new Date().toISOString(),
      trace: { steps: [] },
    };
    task.runs.push(base);
    await emit({ type: 'agent_start', runnerId, runId, run: base });
    if (!runner?.runnable) {
      Object.assign(base, { status: 'error', error: 'Runner 当前不可运行', completedAt: new Date().toISOString() });
      await emit({ type: 'agent_error', runnerId, runId, run: base });
      return;
    }
    if (task.brief.evidencePolicy === 'required' && !runner.capabilities.search && runner.type === 'api') {
      Object.assign(base, { status: 'capability-limited', error: '该 Direct API Runner 没有搜索能力，不能参与证据必需任务', completedAt: new Date().toISOString() });
      await emit({ type: 'agent_error', runnerId, runId, run: base });
      return;
    }
    try {
      const result = await runAgent({
        runner,
        framework: runner.framework,
        model: runner.model,
        task: prompt,
        agentId: base.agentId,
        mode: runner.type === 'sim' ? 'sim' : 'live',
        evidencePolicy: task.brief.evidencePolicy,
        onStep: async (step) => {
          base.trace.steps.push(step);
          await emit({ type: 'agent_trace', runnerId, runId, step });
        },
      });
      const steps = base.trace.steps.length ? base.trace.steps : result.trace?.steps || [];
      Object.assign(base, result, {
        trace: { ...(result.trace || {}), steps, totals: summarizeTrace(steps) },
        completedAt: new Date().toISOString(),
        simulated: runner.type === 'sim',
      });
      base.research = researchCompletion(base, task);
      await emit({ type: 'agent_done', runnerId, runId, run: base });
    } catch (error) {
      base.trace.totals = summarizeTrace(base.trace.steps);
      Object.assign(base, { status: 'error', error: String(error?.message || error), completedAt: new Date().toISOString() });
      base.research = researchCompletion(base, task);
      await emit({ type: 'agent_error', runnerId, runId, run: base });
    }
  }));
  task.runs.sort((a, b) => task.selectedRunnerIds.indexOf(a.runnerId) - task.selectedRunnerIds.indexOf(b.runnerId));
  task.status = 'awaiting-evaluation';
  task.updatedAt = new Date().toISOString();
  await emit({ type: 'run_complete', runs: task.runs });
  return task;
}
