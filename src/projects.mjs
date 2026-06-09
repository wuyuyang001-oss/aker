import { review } from './committee.mjs';
import { runParallel } from './orchestrator.mjs';

let projectCounter = 1;
function newProjectId(prefix) { return `${prefix}_${Date.now().toString(36)}_${(projectCounter++).toString(36)}`; }

const ROLE_PLAN = [
  { role: 'strategist', label: '策略视角', why: '比较可选路径、机会成本与可逆性' },
  { role: 'critic', label: '反方视角', why: '构造最强反对意见与失败预演' },
  { role: 'operator', label: '行动视角', why: '把未知项转成低成本验证行动' },
  { role: 'researcher', label: '证据视角', why: '区分事实、假设、推断与证据缺口' },
];

function clean(text = '') { return String(text).replace(/\s+/g, ' ').trim(); }

function sentenceMatches(text, pattern) {
  return clean(text).split(/[。！？!?；;\n]+/).filter((s) => pattern.test(s)).join('；');
}

export function deriveBrief(question, previous = {}) {
  const text = clean(question);
  const constraints = sentenceMatches(text, /不能|必须|仅|只有|预算|成本|周期|周|天|月|人|截止|风险|不可接受/i);
  const criteria = sentenceMatches(text, /成功|目标|达到|至少|指标|意味着|验收|接受/i);
  return {
    decision: previous.decision || text,
    context: previous.context || '',
    constraints: previous.constraints || constraints,
    criteria: previous.criteria || criteria,
    unknowns: previous.unknowns || '真实需求强度、执行成本、关键风险边界，以及哪些新信息会改变当前选择。',
    assumptions: previous.assumptions || '在缺少更多信息时，优先采用可逆、低成本且能产生新证据的行动。',
  };
}

export function extractSourceLinks(text = '') {
  const links = String(text).match(/https?:\/\/[^\s<>"'，。！？；）)]+/gi) || [];
  return [...new Set(links.map((url) => url.replace(/[.,;:!?]+$/, '')))].slice(0, 12);
}

function addSourceLinks(project, text) {
  project.sources ||= [];
  for (const url of extractSourceLinks(text)) {
    if (project.sources.some((source) => source.url === url)) continue;
    let host = url;
    try { host = new URL(url).hostname; } catch {}
    project.sources.push({
      id: `S${project.sources.length + 1}`,
      url,
      title: host,
      excerpt: '',
      status: 'provided',
      addedAt: new Date().toISOString(),
    });
  }
}

export function briefToTask(brief, sources = []) {
  const sections = [
    ['决策问题', brief.decision],
    ['已知背景', brief.context],
    ['约束与不可接受结果', brief.constraints],
    ['成功标准', brief.criteria],
    ['关键未知项', brief.unknowns],
    ['默认假设', brief.assumptions],
  ];
  const sourceText = sources.length
    ? `## 用户提供来源\n${sources.map((source) => {
      const status = source.status === 'ready' ? '已读取' : source.status === 'failed' ? `读取失败：${source.error}` : '仅记录链接';
      return `### [${source.id}] ${source.title || source.url}\nURL: ${source.finalUrl || source.url}\n状态: ${status}\n摘要: ${source.excerpt || '尚无可读取摘要'}`;
    }).join('\n\n')}\n\n引用来源时必须使用 [S1] 这类编号；没有来源支持的内容不能写成事实。`
    : '## 用户提供来源\n当前没有用户提供的来源。不得把外部事实写成已经核验。';
  return [...sections.filter(([, value]) => clean(value)).map(([title, value]) => `## ${title}\n${clean(value)}`), sourceText].join('\n\n');
}

export function createProject({ message, mode = 'sim', parentId = null, branchFrom = null }) {
  const question = clean(message);
  const now = new Date().toISOString();
  const project = {
    id: newProjectId('project'),
    title: question.slice(0, 56),
    status: 'ready',
    mode,
    parentId,
    branchFrom,
    createdAt: now,
    updatedAt: now,
    brief: deriveBrief(question),
    messages: [
      { id: newProjectId('msg'), role: 'user', content: question, createdAt: now },
      {
        id: newProjectId('msg'),
        role: 'assistant',
        content: '我已把问题整理成工作简报。你可以直接开始探究；缺失信息将按可逆、低成本原则作为假设处理，也可以继续补充约束。',
        createdAt: now,
      },
    ],
    timeline: [],
    runs: [],
    sources: [],
    decisionPackage: null,
    review: null,
  };
  addSourceLinks(project, question);
  return project;
}

export function appendProjectMessage(project, message) {
  const content = clean(message);
  const now = new Date().toISOString();
  project.messages.push({ id: newProjectId('msg'), role: 'user', content, createdAt: now });

  const lower = content.toLowerCase();
  if (/成功|标准|指标|验收|达到/.test(lower)) project.brief.criteria = clean([project.brief.criteria, content].filter(Boolean).join('；'));
  else if (/约束|不能|必须|预算|周期|截止|风险/.test(lower)) project.brief.constraints = clean([project.brief.constraints, content].filter(Boolean).join('；'));
  else if (/未知|不确定|需要验证|假设/.test(lower)) project.brief.unknowns = clean([project.brief.unknowns, content].filter(Boolean).join('；'));
  else if (/背景|已知|现状|客户|目前/.test(lower)) project.brief.context = clean([project.brief.context, content].filter(Boolean).join('；'));
  else project.brief.context = clean([project.brief.context, content].filter(Boolean).join('；'));

  project.messages.push({
    id: newProjectId('msg'),
    role: 'assistant',
    content: '已更新工作简报。除非这条信息改变了目标，你不需要重新填写任何字段。',
    createdAt: now,
  });
  addSourceLinks(project, content);
  project.updatedAt = now;
  return project;
}

export function planProject(project, capabilities) {
  const liveAgents = capabilities.liveAgents || [];
  const mode = project.mode === 'live' && liveAgents.length ? 'live' : 'sim';
  const simRunners = [
    { framework: 'claude-code', model: 'claude-opus-4-8' },
    { framework: 'codex-cli', model: 'gpt-x' },
    { framework: 'langgraph', model: 'o-series' },
    { framework: 'crewai', model: 'gemini-x' },
  ];
  const runners = mode === 'live' ? liveAgents : simRunners;
  const agents = ROLE_PLAN.map((item, index) => {
    const runner = runners[index % runners.length];
    return { ...item, framework: runner.framework, model: runner.model };
  });
  const sharedRunner = new Set(agents.map((a) => `${a.framework}:${a.model}`)).size === 1;
  return {
    mode,
    agents,
    warnings: [
      ...(project.mode === 'live' && mode === 'sim' ? ['未检测到真实运行通道，本次只能使用 Sim 演示。'] : []),
      ...(sharedRunner ? ['所有视角将使用同一运行通道，角色独立不等于模型独立。'] : []),
    ],
  };
}

function timelineEvent(type, title, detail = '', extra = {}) {
  return { id: newProjectId('event'), type, title, detail, at: new Date().toISOString(), ...extra };
}

export async function exploreProject(project, capabilities, { onEvent, synthesize }) {
  const emit = async (event) => {
    const item = timelineEvent(event.type, event.title, event.detail, event);
    project.timeline.push(item);
    project.updatedAt = item.at;
    await onEvent?.(item, project);
  };

  project.status = 'running';
  project.timeline = [];
  project.decisionPackage = null;
  project.review = null;
  const plan = planProject(project, capabilities);
  project.mode = plan.mode;
  const sources = project.sources || [];
  if (sources.length) {
    const ready = sources.filter((source) => source.status === 'ready').length;
    await emit({
      type: 'source_audit',
      title: `已整理 ${sources.length} 个用户提供来源`,
      detail: `${ready} 个已读取摘要；${sources.length - ready} 个仅记录或读取失败。来源存在不等于主张已经得到证实。`,
    });
  }
  await emit({
    type: 'plan',
    title: `已生成 ${plan.agents.length} 个独立判断分支`,
    detail: plan.agents.map((a) => `${a.label}：${a.why}`).join('；'),
    plan,
  });
  for (const warning of plan.warnings) await emit({ type: 'warning', title: warning });

  const task = briefToTask(project.brief, sources);
  const run = await runParallel({
    task,
    agents: plan.agents,
    mode: plan.mode,
    onAgentStart: async (spec) => emit({
      type: 'agent_start',
      title: `${ROLE_PLAN.find((item) => item.role === spec.role)?.label || '独立视角'}开始判断`,
      detail: ROLE_PLAN.find((item) => item.role === spec.role)?.why || '',
      agentId: spec.agentId,
      role: spec.role,
    }),
    onAgentComplete: async (agent, partialAgents) => {
      await emit({
        type: agent.status === 'done' ? 'agent_done' : 'agent_error',
        title: `${ROLE_PLAN.find((item) => item.role === agent.role)?.label || '独立视角'}${agent.status === 'done' ? '已形成观点' : '运行失败'}`,
        detail: agent.status === 'done' ? summarizeOpinion(agent.output) : agent.error,
        agentId: agent.agentId,
        role: agent.role,
        agent,
      });
      const completed = partialAgents.filter((a) => a.status === 'done' && a.output);
      if (completed.length >= 2) {
        const interim = review({ agents: completed }, 'intersection');
        await emit({
          type: 'committee_update',
          title: `委员会已检查 ${completed.length} 个观点`,
          detail: `识别到 ${interim.consensus.length} 条共同主张、${interim.divergence.length} 条少数观点；共同出现不代表事实正确。`,
          counts: interim.counts,
        });
      }
    },
  });
  project.runs.unshift(run.id);

  const completed = run.agents.filter((a) => a.status === 'done' && a.output);
  if (completed.length < 2) {
    project.status = 'failed';
    await emit({ type: 'error', title: '可用观点不足，无法形成可靠决策包', detail: '至少需要两个成功完成的独立视角。' });
    return { project, run, review: null };
  }

  await emit({ type: 'synthesis_start', title: '委员会正在处理分歧并形成决策包' });
  const result = review(run, 'intersection');
  if (plan.mode === 'live' && synthesize) {
    try {
      const live = await synthesize({ task, agents: completed, evidence: result });
      result.betterSolution = {
        ...result.betterSolution,
        ruleMarkdown: result.betterSolution.markdown,
        markdown: live.markdown,
        synthesis: { mode: 'live', channel: live.channel },
      };
    } catch (error) {
      result.betterSolution.synthesis = { mode: 'error', error: String(error?.message || error) };
      await emit({ type: 'warning', title: '真实综合失败，保留规则式决策包', detail: result.betterSolution.synthesis.error });
    }
  }
  project.review = result;
  project.decisionPackage = result.betterSolution.markdown;
  project.status = 'complete';
  await emit({
    type: 'complete',
    title: '决策包已完成',
    detail: '你可以继续补充信息、从任意主张创建分支，或复制当前决策包。',
  });
  return { project, run, review: result };
}

function summarizeOpinion(output = '') {
  const lines = String(output).split('\n').map((line) => line.replace(/^[-#>\s]+/, '').trim()).filter(Boolean);
  const useful = lines.find((line) => !/^(独立判断|关键主张|最强反对意见|会改变结论的信息|最低成本验证)$/.test(line));
  return (useful || '已完成独立判断').slice(0, 180);
}
