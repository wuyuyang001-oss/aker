// committee.mjs — 评审会引擎
// 输入：一个 run 的多个 agent 输出（+各自 trace）
// 输出：交集(共识) / 并集(全集) / 差异归因 / 更优解
// 关键：所有分析都是“真实计算”出来的，不依赖 LLM 也能跑（Sim 模式）。
// synthesizeBetter 生成规则式基础综合；server.mjs 会在 Live run 首次评审时
// 调用 adapters.synthesizeReview，以真实评审团主席结果替换 betterSolution.markdown。

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
};

const ROLE_LABELS = {
  strategist: '策略视角',
  critic: '反方视角',
  operator: '行动视角',
  researcher: '证据视角',
};

// —— 文本切片：把一段输出拆成“论点/要点”单元 ——
// P2 修复：剔除“方案标题/元信息行”，避免三家相似标题被聚成头号伪共识。
//   命中以下任一模式即视为标题/元信息，不进入可聚类正文：
//   - 「针对「…」的方案」开头的标题行
//   - 含「方案（by …」「by X·Y」署名样式
//   - 含「风格：/风格:」标注
const TITLE_NOISE = /^#{1,6}\s|^针对「.*」的方案|方案（by\s|（by\s|风格[:：]/;
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

  // 决策包基础版本
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
      detail: `参与的 ${agents.length} 个视角用了 ${models.length} 种模型（${models.join('、')}）。不同模型的知识截止、对齐倾向与推理风格不同，会在措辞与取舍上分叉。`,
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
      detail: `步骤数从 ${minS} 到 ${maxS} 不等。${deep.a.framework}·${deep.a.model} 走了更多步骤，但步骤更多不自动代表结论更可靠。`,
    });
  }

  // 4) 表述/侧重差异（内容层，分歧但非事实冲突）
  if (divergence.length) {
    reasons.push({
      kind: '侧重/表述差异',
      weight: 'low',
      detail: `有 ${divergence.length} 条要点仅单一视角提及。它们可能是关键少数意见，也可能缺乏依据；需要结合证据与可验证性判断，不能按人数直接剔除。`,
    });
  }

  return reasons;
}

// —— 更优解基础综合（Sim / standalone 使用；Live server 会做真实二次综合）——
function synthesizeBetter(agents, consensus, union, attribution) {
  // 单一视角提出的观点必须保留给人审查，不能用步骤数或工具数自动判为更可信。
  const adoptedUnique = union
    .filter((u) => u.unique)
    .slice(0, 8)
    .map((u) => {
      const agent = agents.find((item) => item.agentId === u.agents[0]);
      return { text: u.text, from: ROLE_LABELS[agent?.role] || '独立视角' };
    });

  // 是否含 Sim agent：决定是否醒目标注演示边界。
  const isSim = agents.some((a) => (a.mode || 'sim') === 'sim');

  const lines = [];
  lines.push('## 建议与置信度');
  lines.push('');
  if (isSim) lines.push('> Sim 模式只演示决策流程，不代表真实研究结论。请使用 Live 模式处理真实决策。');
  lines.push('- 当前建议：在关键未知项得到验证前，优先采用可逆的小规模验证，不做不可逆承诺。');
  lines.push(`- 置信度：${consensus.length ? '中' : '低'}。当前共同主张数量为 ${consensus.length}，但共同出现不等于事实正确。`);
  lines.push('');
  lines.push('## 为什么这样决定');
  lines.push('> 以下是多个视角重复提出的主张，不等于已经核验的事实。');
  if (consensus.length) consensus.forEach((c) => lines.push(`- ${c.text}  _(${c.coverage} 个视角覆盖)_`));
  else lines.push('- 当前没有强共同主张，说明信息不足或视角判断明显分叉。');
  lines.push('');
  lines.push('## 最强反对意见');
  lines.push('- 条件推进仍可能造成机会成本：如果验证动作过慢、结果不可判定，团队可能同时承担试点成本并错过窗口期。');
  lines.push('');
  lines.push('## 需保留的少数观点');
  if (adoptedUnique.length) adoptedUnique.forEach((u) => lines.push(`- ${u.text}  _(来自单一视角 ${u.from}，需要进一步验证)_`));
  else lines.push('- 当前没有可自动识别的少数意见；这不代表不存在共同盲区。');
  lines.push('');
  lines.push('## 未解决的不确定性');
  const unknowns = union.filter((item) => /\[未知\]|证据不足|没有提供足够/.test(item.text)).slice(0, 5);
  if (unknowns.length) unknowns.forEach((item) => lines.push(`- ${item.text}`));
  else lines.push('- 当前材料仍不足以证明真实需求、预期收益和执行成本；这些未知项可能改变建议。');
  lines.push('');
  lines.push('## 最低成本验证');
  lines.push('- 选择最可能改变结论的未知项，设计一个有明确观察指标和停止条件的小规模验证。');
  lines.push('- 验证后重新运行 Aker，并在决策简报中补充新事实。');
  lines.push('');
  lines.push('## 立即行动');
  lines.push('- 指定一名决策负责人，明确决策截止时间与不可接受结果。');
  lines.push('- 把当前最关键假设转成未来 1-7 天内可验证的行动。');
  lines.push('');
  lines.push('> Sim 模式的内容用于演示工作流；处理真实决策时请使用 Live 通道并提供可核验来源。');

  return {
    credibility: {},
    adoptedUnique,
    markdown: lines.join('\n'),
  };
}
