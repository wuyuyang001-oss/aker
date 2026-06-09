import { runAgent } from './adapters.mjs';
import { getRunner } from './runners.mjs';
import { researchCompletion } from './tasks.mjs';
import { summarizeTrace } from './trace.mjs';

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const unique = (items) => [...new Set(items.filter(Boolean))];

function sourcesFrom(run) {
  return unique((run.trace?.steps || []).filter((step) => step.type === 'source' && step.url).map((step) => step.url));
}

function scoreRun(run, task) {
  const totals = summarizeTrace(run.trace?.steps || []);
  const research = researchCompletion(run, task);
  const outputLength = String(run.output || '').length;
  const scores = {
    instruction: clamp(run.status === 'done' ? 75 + Math.min(25, outputLength / 300) : 0),
    coverage: clamp(Math.min(100, outputLength / 35)),
    evidence: clamp(research.hasEvidence ? 55 + totals.sources * 8 + totals.searches * 5 + totals.fetches * 3 : 0),
    consistency: clamp(run.status === 'done' ? 70 : 0),
    unique: clamp(run.status === 'done' ? 65 : 0),
  };
  const totalWeight = task.rubric.reduce((sum, item) => sum + Number(item.weight || 0), 0) || 1;
  const total = clamp(task.rubric.reduce((sum, item) => sum + (scores[item.id] || 0) * Number(item.weight || 0), 0) / totalWeight);
  return {
    runnerId: run.runnerId,
    label: run.label,
    eligibleForFusion: research.complete,
    incompleteReason: research.reason,
    scores,
    total,
    sources: sourcesFrom(run),
    uniqueContribution: outputLength ? '该 Agent 的完整回答保留在下方，可与其他回答逐项比对。' : '没有可评审输出。',
    omissions: research.reason ? [research.reason] : [],
  };
}

function fallbackFusion(task, eligible, scorecards) {
  const sources = unique(eligible.flatMap(sourcesFrom));
  const lines = [
    '## 证据加权融合答案',
    '',
    eligible.length
      ? '以下融合保留了可进入事实融合的 Agent 输出。由于无 GT 场景不能宣称绝对正确，建议优先核验冲突主张与证据缺口。'
      : '当前没有 Agent 满足事实融合条件。证据必需任务需要真实搜索、网页读取或来源 Trace；Sim 输出和无检索回答不会冒充研究结论。',
    '',
  ];
  for (const run of eligible) {
    lines.push(`### ${run.label}`);
    lines.push(String(run.output || '').slice(0, 6000));
    lines.push('');
  }
  lines.push('## Agent 评分榜', '');
  scorecards.slice().sort((a, b) => b.total - a.total).forEach((card, index) => {
    lines.push(`${index + 1}. ${card.label}：${card.total}/100${card.eligibleForFusion ? '' : `（不进入事实融合：${card.incompleteReason}）`}`);
  });
  lines.push('', '## 每个 Agent 的独有贡献与遗漏', '');
  scorecards.forEach((card) => lines.push(`- ${card.label}：${card.uniqueContribution}${card.omissions.length ? ` 遗漏：${card.omissions.join('；')}` : ''}`));
  lines.push('', '## 冲突主张及其来源', '', '- 规则评审无法可靠判断语义冲突；请使用独立 Judge 对具体主张和来源进行复核。');
  lines.push('', '## 未解决问题和证据缺口', '', eligible.length ? '- 对各来源的独立性、发布日期和关键数字仍需逐项核验。' : '- 缺少可进入事实融合的真实研究输出。');
  lines.push('', '## 完整来源列表', '');
  if (sources.length) sources.forEach((url) => lines.push(`- ${url}`));
  else lines.push('- 暂无真实来源。');
  return lines.join('\n');
}

function judgePrompt(task, eligible, scorecards) {
  return [
    '你是 Aker 的独立 Judge。请评审多个 Agent 对同一开放任务的回答，并生成证据加权的融合答案。',
    '不要把多数意见当成事实，不要宣称无 GT 条件下获得绝对真相。重要主张必须能追溯到 Agent 输出或来源 URL。',
    '输出 Markdown，必须包含：',
    '## 证据加权融合答案',
    '## Agent 评分榜',
    '## 每个 Agent 的独有贡献与遗漏',
    '## 冲突主张及其来源',
    '## 未解决问题和证据缺口',
    '## 完整来源列表',
    '',
    `任务：${task.brief.objective}`,
    `交付物：${task.brief.deliverable}`,
    `评分表：${JSON.stringify(task.rubric)}`,
    `基础评分：${JSON.stringify(scorecards)}`,
    '',
    eligible.map((run) => `### ${run.label}\n来源：${sourcesFrom(run).join(', ') || '未提取'}\n${String(run.output || '').slice(0, 10000)}`).join('\n\n'),
  ].join('\n');
}

export async function evaluateTask(task, { onEvent } = {}) {
  const scorecards = task.runs.map((run) => scoreRun(run, task)).sort((a, b) => b.total - a.total);
  const eligible = task.runs.filter((run) => scorecards.find((card) => card.runnerId === run.runnerId)?.eligibleForFusion);
  const judge = getRunner(task.judgeRunnerId);
  const warnings = [];
  if (!judge) warnings.push('未选择可用 Judge，使用规则式融合。');
  if (task.selectedRunnerIds.includes(task.judgeRunnerId)) warnings.push('Judge 同时参与了作答，存在自评偏差。');
  const channels = task.runs.filter((run) => run.status === 'done').map((run) => `${run.framework}:${run.model}`);
  if (new Set(channels).size < channels.length && channels.length > 1) warnings.push('多个回答使用相同框架与模型，存在相关性偏差。');
  const sourceOwners = new Map();
  for (const run of task.runs) for (const source of sourcesFrom(run)) sourceOwners.set(source, (sourceOwners.get(source) || 0) + 1);
  if ([...sourceOwners.values()].some((count) => count > 1)) warnings.push('多个回答依赖相同来源；来源重合不等于独立验证。');
  let finalAnswer = fallbackFusion(task, eligible, scorecards);
  let judgeRun = null;
  if (judge?.runnable && judge.type !== 'sim' && eligible.length) {
    try {
      await onEvent?.({ type: 'judge_start', runnerId: judge.id, at: new Date().toISOString() });
      judgeRun = await runAgent({
        runner: judge,
        framework: judge.framework,
        model: judge.model,
        task: judgePrompt(task, eligible, scorecards),
        agentId: `judge:${judge.id}`,
        mode: 'live',
        evidencePolicy: 'preferred',
        onStep: async (step) => onEvent?.({ type: 'judge_trace', runnerId: judge.id, step, at: new Date().toISOString() }),
      });
      if (judgeRun.output) finalAnswer = judgeRun.output;
    } catch (error) {
      warnings.push(`独立 Judge 失败，已保留规则式融合：${String(error?.message || error)}`);
    }
  } else if (judge?.type === 'sim') {
    warnings.push('当前使用 Sim Judge；结果只用于演示评审结构。');
  }
  task.scorecards = scorecards;
  task.finalAnswer = finalAnswer;
  task.evaluation = {
    judgeRunnerId: task.judgeRunnerId,
    judgeRun,
    warnings,
    eligibleRunnerIds: eligible.map((run) => run.runnerId),
    sources: unique(eligible.flatMap(sourcesFrom)),
    evaluatedAt: new Date().toISOString(),
  };
  task.status = 'complete';
  task.updatedAt = new Date().toISOString();
  await onEvent?.({ type: 'evaluation_complete', task, at: new Date().toISOString() });
  return task;
}
