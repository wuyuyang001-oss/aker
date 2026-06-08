// orchestrator.mjs — 多 agent 并行编排
import { runAgent } from './adapters.mjs';
import { agentLabel } from './trace.mjs';

let counter = 1;
function newId(prefix) { return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`; }

// 并行跑所有 agent；任一失败不拖累其他（Promise.allSettled）
export async function runParallel({ task, agents, mode = 'sim' }) {
  const runId = newId('run');
  const specs = agents.map((a, i) => ({
    agentId: a.agentId || `${a.framework}#${i + 1}`,
    framework: a.framework,
    model: a.model,
  }));

  const settled = await Promise.allSettled(
    specs.map((s) => runAgent({ ...s, task, mode }))
  );

  const resultAgents = specs.map((s, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      return { ...s, label: agentLabel(s), ...r.value };
    }
    return { ...s, label: agentLabel(s), status: 'error', output: '', error: String(r.reason?.message || r.reason), trace: { steps: [] } };
  });

  return {
    id: runId,
    task,
    mode,
    createdAt: new Date().toISOString(),
    agents: resultAgents,
  };
}
