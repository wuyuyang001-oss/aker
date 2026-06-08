// committee.mjs — 评审会引擎
// 输入：一个 run 的多个 agent 输出（+各自 trace）
// 输出：交集(共识) / 并集(全集) / 差异归因 / 更优解
// 关键：所有分析都是“真实计算”出来的，不依赖 LLM 也能跑（Sim 模式）。
// 综合更优解（synthesizeBetter）当前为【规则式启发综合，仅演示】——
// 即便配置了 API key，本次也不做 LLM 二次综合（adapters.liveSynthesize 尚未实现，属 roadmap）。

import { summarizeTrace } from './trace.mjs';

// —— 评审会可调常数（CONFIG）——
// ⚠️ 重要：以下阈值/权重均为【启发式经验值，仅供 Sim 演示】，未经任何标定或验证，
//    不代表真实质量评估。Sim 模式下 trace（工具数/步数）由框架工具表 + rng 生成，
//    因此“可信度”实质由框架配置预定，并非事实依据。详见 README「Sim 可信度说明」。
const CONFIG = {
  // 要点聚类的字面 jaccard 相似度阈值：>= 此值视为同一主张簇。
  // 0.34 为经验取值（CJK bigram + latin 词袋下，过低会乱并、过高会过散）。
  SIM_THRESHOLD: 0.34,
  // 进入“共识”所需的最少 agent 覆盖数下限（再与多数票 ceil(n/2) 取较大者）。
  MIN_CONSENSUS: 2,
  // “推理深度差异”归因触发门槛：最大步数 - 最小步数 >= 此值才报告。
  DEPTH_GAP: 2,
  // 过程可信度（cred）启发式打分权重（仅 Sim 演示，非真实质量）：
  //   cred = tools*toolW + min(steps, stepCap) - errors*errPenalty
  CRED: { toolW: 2, stepCap: 6, errPenalty: 3 },
};

// —— 文本切片：把一段输出拆成“论点/要点”单元 ——
// P2 修复：剔除“方案标题/元信息行”，避免三家相似标题被聚成头号伪共识。
//   命中以下任一模式即视为标题/元信息，不进入可聚类正文：
//   - 「针对「…」的方案」开头的标题行
//   - 含「方案（by …」「by X·Y」署名样式
//   - 含「风格：/风格:」标注
const TITLE_NOISE = /^针对「.*」的方案|方案（by\s|（by\s|风格[:：]/;
export function splitPoints(text = '') {
  return text
    .split(/\n+|(?<=[。！？.!?])\s+/g)
    .map((s) => s.replace(/^[\s\-*•\d.、)）]+/, '').trim())
    .filter((s) => s.length >= 4)
    .filter((s) => !TITLE_NOISE.test(s));
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
    if (best && bestSim >= CONFIG.SIM_THRESHOLD) {
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

  // 共识(交集)：被多数 agent 覆盖的簇（覆盖数 >= max(MIN_CONSENSUS, 多数票)）
  const consensus = clusters
    .filter((c) => c.agents.size >= Math.max(CONFIG.MIN_CONSENSUS, majority))
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
  if (maxS - minS >= CONFIG.DEPTH_GAP) {
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

// —— 更优解综合（当前为规则式启发综合，仅演示；Live LLM 综合为 roadmap）——
function synthesizeBetter(agents, consensus, union, attribution) {
  const traces = agents.map((a) => summarizeTrace(a.trace?.steps || []));
  // 给每个 agent 一个“过程可信度”分（启发式：有工具、步骤适中、无错误）
  // ⚠️ Sim 下 trace 由框架工具表 + rng 生成、errors 恒 0，该分数无事实依据。
  const { toolW, stepCap, errPenalty } = CONFIG.CRED;
  const cred = {};
  agents.forEach((a, i) => {
    const t = traces[i];
    cred[a.agentId] = (t.tools.length * toolW) + Math.min(t.steps, stepCap) - t.errors * errPenalty;
  });

  // 采纳的独有要点：来自可信度高于中位数的 agent
  const credVals = Object.values(cred).sort((x, y) => x - y);
  const med = credVals[Math.floor(credVals.length / 2)] ?? 0;
  const adoptedUnique = union
    .filter((u) => u.unique && (cred[u.agents[0]] ?? 0) >= med)
    .map((u) => ({ text: u.text, from: u.agents[0] }));

  // 是否含 Sim agent：决定要不要在文案里醒目标注“可信度基于模拟 trace”。
  const isSim = agents.some((a) => (a.mode || 'sim') === 'sim');
  const credNote = isSim ? '（Sim：可信度基于模拟 trace，无事实依据）' : '';

  const lines = [];
  lines.push('## 综合最优解（aker 评审会）');
  lines.push('');
  if (isSim) lines.push('> ⚠️ Sim 模式：以下“可信度/采纳依据”均基于**模拟 trace**（工具数/步数由框架表生成），不代表真实质量。');
  lines.push('');
  lines.push('### 已确立的共识（多数 agent 覆盖）');
  lines.push('> 注：“多数 agent 覆盖”≠ 绝对正确——同源模型可能共同偏见，相关性一起错。');
  if (consensus.length) consensus.forEach((c) => lines.push(`- ${c.text}  _(${c.coverage} 个 agent 覆盖)_`));
  else lines.push('- （本次无强共识——说明任务发散或 agent 配置差异大，建议增加一致性约束或换更同质的模型组）');
  lines.push('');
  lines.push(`### 选择性纳入的独有洞见（过程可信度更高的一方提出）${credNote}`);
  if (adoptedUnique.length) adoptedUnique.forEach((u) => lines.push(`- ${u.text}  _(来自 ${u.from}，其 trace 有工具/验证支撑${isSim ? '；Sim 模拟' : ''})_`));
  else lines.push('- （无满足采纳门槛的独有要点）');
  lines.push('');
  lines.push('### 评审会判断');
  attribution.forEach((r) => lines.push(`- **${r.kind}**（权重 ${r.weight}）：${r.detail}`));
  lines.push('');
  lines.push('> 当前为规则式启发综合（仅演示）。Live LLM 二次综合（adapters.liveSynthesize，对以上结构化证据综合并解决事实冲突）为 roadmap，尚未实现。');

  return {
    credibility: cred,
    adoptedUnique,
    markdown: lines.join('\n'),
  };
}
