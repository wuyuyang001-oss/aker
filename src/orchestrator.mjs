// orchestrator.mjs — 多 agent 并行编排
import { runAgent } from './adapters.mjs';
import { agentLabel } from './trace.mjs';

let counter = 1;
function newId(prefix) { return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`; }

// 并行跑所有 agent；任一失败不拖累其他（Promise.allSettled）
export async function runParallel({ task, agents, mode = 'sim', onAgentStart, onAgentComplete }) {
  const runId = newId('run');
  const specs = agents.map((a, i) => ({
    agentId: a.agentId || `${a.framework}#${i + 1}`,
    framework: a.framework,
    model: a.model,
    role: a.role || 'strategist',
  }));

  const resultAgents = [];
  await Promise.all(specs.map(async (s) => {
    await onAgentStart?.(s);
    let agent;
    try {
      agent = { ...s, label: agentLabel(s), ...await runAgent({ ...s, task, mode }) };
    } catch (error) {
      agent = { ...s, label: agentLabel(s), status: 'error', output: '', error: String(error?.message || error), trace: { steps: [] } };
    }
    resultAgents.push(agent);
    await onAgentComplete?.(agent, resultAgents.slice());
  }));
  resultAgents.sort((a, b) => specs.findIndex((s) => s.agentId === a.agentId) - specs.findIndex((s) => s.agentId === b.agentId));

  return {
    id: runId,
    task,
    mode,
    createdAt: new Date().toISOString(),
    agents: resultAgents,
  };
}
