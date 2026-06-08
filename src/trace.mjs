// trace.mjs — 统一的 trace 模型 + 效果评审用的 trace 指标/对比
// 不同框架的原始 trace 形态各异（jsonl / OTel spans / cli json / 自包），
// adapter 负责把它们归一成下面这套 step 结构，aker 再统一分析。

// step.type: 'think' | 'tool' | 'observe' | 'message' | 'handoff' | 'error'
export function makeStep(i, type, label, extra = {}) {
  return {
    i,
    type,
    label,
    detail: extra.detail || '',
    toolName: extra.toolName || null,
    tokens: extra.tokens || 0,
    ms: extra.ms || 0,
  };
}

export function summarizeTrace(steps = []) {
  const totals = {
    steps: steps.length,
    tokens: steps.reduce((a, s) => a + (s.tokens || 0), 0),
    toolCalls: steps.filter((s) => s.type === 'tool').length,
    wallMs: steps.reduce((a, s) => a + (s.ms || 0), 0),
    errors: steps.filter((s) => s.type === 'error').length,
    tools: [...new Set(steps.filter((s) => s.toolName).map((s) => s.toolName))],
  };
  return totals;
}

// 效果评审：对比两个 agent 的执行过程（不是结果），给出过程层面的差异
export function diffTraces(a, b) {
  const ta = summarizeTrace(a.trace?.steps || []);
  const tb = summarizeTrace(b.trace?.steps || []);
  const onlyA = ta.tools.filter((t) => !tb.tools.includes(t));
  const onlyB = tb.tools.filter((t) => !ta.tools.includes(t));
  const shared = ta.tools.filter((t) => tb.tools.includes(t));
  return {
    a: { id: a.agentId, label: agentLabel(a), totals: ta },
    b: { id: b.agentId, label: agentLabel(b), totals: tb },
    deltas: {
      steps: ta.steps - tb.steps,
      tokens: ta.tokens - tb.tokens,
      toolCalls: ta.toolCalls - tb.toolCalls,
      wallMs: ta.wallMs - tb.wallMs,
    },
    tools: { onlyA, onlyB, shared },
  };
}

export function agentLabel(a) {
  return `${a.framework} · ${a.model}`;
}
