// committee.mjs — 评审会引擎
// 输入：一个 run 的多个 agent 输出（+各自 trace）
// 输出：交集(共识) / 并集(全集) / 差异归因 / 更优解
// 关键：所有分析都是“真实计算”出来的，不依赖 LLM 也能跑（Sim 模式）。
// Live 模式下，synthesizeBetter() 会被替换成真实 LLM 综合（见 adapters.liveSynthesize）。

import { summarizeTrace } from './trace.mjs';

// —— 文本切片：把一段输出拆成“论点/要点”单元 ——
export function splitPoints(text = '') {
  return text
    .split(/\n+|(?<=[。！？.!?])\s+/g)
    .map((s) => s.replace(/^[\s\-*•\d.、)）]+/, '').trim())
    .filter((s) => s.length >= 4);
}

// —— 归一化分词：latin 单词 + CJK 字符，用于相似度 ——
function shingles(s) {
  const lower = s.toLowerCase();
  const words = lower.match(/[a-z0-9_]+/g) || [];
  const cjk = lower.match(/[一-鿿]/g) || [];
  const cjkBigrams = [];
  for (let i = 0; i < cjk.length - 1; i++) cjkBigrams.push(cjk[i] + cjk[i + 1]);
  return new Set([...words, ...cjk, ...cjkBigrams]);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const SIM_THRESHOLD = 0.34;

// 把所有 agent 的要点聚类：相似的归为同一个“主张簇”
function clusterPoints(agents) {
  const items = [];
  agents.forEach((ag, ai) => {
    for (const p of splitPoints(ag.output || '')) {
      items.push({ ai, agentId: ag.agentId, text: p, sh: shingles(p) });
    }
  });
  const clusters = [];
  for (const it of items) {
    let best = null, bestSim = 0;
    for (const c of clusters) {
      const sim = jaccard(it.sh, c.centroid);
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && bestSim >= SIM_THRESHOLD) {
      best.members.push(it);
      for (const x of it.sh) best.centroid.add(x);
      best.agents.add(it.ai);
    } else {
      clusters.push({ members: [it], centroid: new Set(it.sh), agents: new Set([it.ai]) });
    }
  }
  return clusters;
}

function repText(cluster) {
  // 选最短且信息量够的成员作代表
  return cluster.members.slice().sort((a, b) => a.text.length - b.text.length)[0].text;
}

export function review(run, mode = 'intersection') {
  const agents = run.agents.filter((a) => a.status === 'done' && a.output);
  const n = agents.length;
  const clusters = clusterPoints(agents);
  const majority = Math.ceil(n / 2);

  // 共识(交集)：被多数 agent 覆盖的簇
  const consensus = clusters
    .filter((c) => c.agents.size >= Math.max(2, majority))
    .map((c) => ({
      text: repText(c),
      coverage: c.agents.size,
      agents: [...c.agents].map((i) => agents[i].agentId),
    }))
    .sort((a, b) => b.coverage - a.coverage);

  // 全集(并集)：所有去重后的要点
  const union = clusters.map((c) => ({
    text: repText(c),
    coverage: c.agents.size,
    agents: [...c.agents].map((i) => agents[i].agentId),
    unique: c.agents.size === 1,
  }));

  // 分歧：只有单个 agent 提到的要点（其他人没有 = 可能是洞见，也可能是幻觉）
  const divergence = union
    .filter((u) => u.unique)
    .map((u) => ({ text: u.text, by: u.agents[0] }));

  // 差异归因：结合 trace 信号解释“为什么会不同”
  const attribution = attribute(agents, divergence);

  // 更优解
  const betterSolution = synthesizeBetter(agents, consensus, union, attribution);

  return {
    mode,
    counts: { agents: n, clusters: clusters.length, consensus: consensus.length, divergent: divergence.length },
    consensus,
    union,
    divergence,
    attribution,
    betterSolution,
  };
}

// —— 差异归因：用 trace 把分歧分类到可解释的原因 ——
function attribute(agents, divergence) {
  const reasons = [];
  const traces = agents.map((a) => ({ a, t: summarizeTrace(a.trace?.steps || []) }));

  // 1) 模型差异
  const models = [...new Set(agents.map((a) => a.model))];
  if (models.length > 1) {
    reasons.push({
      kind: '模型差异',
      weight: 'high',
      detail: `参与的 ${agents.length} 个 agent 用了 ${models.length} 种模型（${models.join('、')}）。不同模型的知识截止、对齐倾向与推理风格不同，会在措辞与取舍上分叉。`,
    });
  }

  // 2) 工具/检索差异（trace）
  const toolSets = traces.map((x) => x.t.tools);
  const allTools = [...new Set(toolSets.flat())];
  const partialTools = allTools.filter((tool) => toolSets.some((s) => s.includes(tool)) && toolSets.some((s) => !s.includes(tool)));
  if (partialTools.length) {
    reasons.push({
      kind: '工具/检索差异',
      weight: 'high',
      detail: `工具 [${partialTools.join('、')}] 只有部分 agent 调用了。检索/执行到的事实不同 → 结论必然分叉。这类分歧通常“有据可查的一方更可信”。`,
      evidence: traces.map((x) => ({ agentId: x.a.agentId, tools: x.t.tools })),
    });
  }

  // 3) 步骤深度差异（trace）
  const steps = traces.map((x) => x.t.steps);
  const maxS = Math.max(...steps), minS = Math.min(...steps);
  if (maxS - minS >= 2) {
    const deep = traces.find((x) => x.t.steps === maxS);
    reasons.push({
      kind: '推理深度差异',
      weight: 'medium',
      detail: `步骤数从 ${minS} 到 ${maxS} 不等。${deep.a.framework}·${deep.a.model} 走了更多步（更多自我验证/迭代），更可能覆盖边角，但也更贵。`,
    });
  }

  // 4) 表述/侧重差异（内容层，分歧但非事实冲突）
  if (divergence.length) {
    reasons.push({
      kind: '侧重/表述差异',
      weight: 'low',
      detail: `有 ${divergence.length} 条要点仅单一 agent 提及。需人工判断：是独到洞见（保留）还是无依据发挥（剔除）。aker 在“更优解”里默认对“有 trace 工具支撑的一方”加权。`,
    });
  }

  return reasons;
}

// —— 更优解综合（Sim 模式：基于规则的可解释综合）——
function synthesizeBetter(agents, consensus, union, attribution) {
  const traces = agents.map((a) => summarizeTrace(a.trace?.steps || []));
  // 给每个 agent 一个“过程可信度”分（基于 trace：有工具、步骤适中、无错误）
  const cred = {};
  agents.forEach((a, i) => {
    const t = traces[i];
    cred[a.agentId] = (t.tools.length * 2) + Math.min(t.steps, 6) - t.errors * 3;
  });

  // 采纳的独有要点：来自可信度高于中位数的 agent
  const credVals = Object.values(cred).sort((x, y) => x - y);
  const med = credVals[Math.floor(credVals.length / 2)] ?? 0;
  const adoptedUnique = union
    .filter((u) => u.unique && (cred[u.agents[0]] ?? 0) >= med)
    .map((u) => ({ text: u.text, from: u.agents[0] }));

  const lines = [];
  lines.push('## 综合最优解（aker 评审会）');
  lines.push('');
  lines.push('### 已确立的共识（多数 agent 一致，可信度最高）');
  if (consensus.length) consensus.forEach((c) => lines.push(`- ${c.text}  _(${c.coverage} 个 agent 覆盖)_`));
  else lines.push('- （本次无强共识——说明任务发散或 agent 配置差异大，建议增加一致性约束或换更同质的模型组）');
  lines.push('');
  lines.push('### 选择性纳入的独有洞见（过程可信度更高的一方提出）');
  if (adoptedUnique.length) adoptedUnique.forEach((u) => lines.push(`- ${u.text}  _(来自 ${u.from}，其 trace 有工具/验证支撑)_`));
  else lines.push('- （无满足采纳门槛的独有要点）');
  lines.push('');
  lines.push('### 评审会判断');
  attribution.forEach((r) => lines.push(`- **${r.kind}**（权重 ${r.weight}）：${r.detail}`));
  lines.push('');
  lines.push('> Live 模式接入真实模型后，这一段会替换为 LLM 对以上结构化证据的二次综合（措辞更自然，并能解决事实冲突）。');

  return {
    credibility: cred,
    adoptedUnique,
    markdown: lines.join('\n'),
  };
}
