// frameworks.mjs — agent 框架图鉴
// 每个条目除了基础信息，重点标注【trace 可得性】，因为这直接决定 aker 能否做效果评审。
// traceability 取值：'native'(原生结构化 trace) | 'otel'(走 OpenTelemetry/callback) | 'cli-log'(只能解析 stdout/日志) | 'api-only'(只有最终响应)

export const FRAMEWORKS = [
  {
    id: 'claude-code',
    name: 'Claude Code / Agent SDK',
    vendor: 'Anthropic',
    kind: 'CLI + SDK',
    paradigm: 'ReAct + 工具循环（harness 托管）',
    language: ['TypeScript', 'Python'],
    multiAgent: '子 agent（Task/Agent 工具）可派生并行',
    state: 'session transcript（jsonl）+ 上下文压缩',
    toolCalling: '原生 tool_use / tool_result 块',
    traceability: 'native',
    traceNote: '每个 session 落 .jsonl transcript：逐条 user/assistant/tool_use/tool_result，含 token 用量。aker 可直接读 ~/.claude/projects/**/**.jsonl 做回放。',
    strengths: ['工具循环与上下文管理开箱即用', '权限/hook 机制完善', 'transcript 天然就是 trace'],
    weaknesses: ['强绑定 Claude 模型', 'harness 行为不完全可控'],
    code: `// Claude Agent SDK（TS）
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const msg of query({
  prompt: "重构这个函数并加测试",
  options: { model: "claude-opus-4-8", allowedTools: ["Read","Edit","Bash"] }
})) {
  // msg.type: 'assistant' | 'tool_use' | 'tool_result' | 'result'
  console.log(msg);   // 这一条条就是 trace
}`,
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    kind: 'CLI',
    paradigm: 'ReAct 工具循环（终端内编码 agent）',
    language: ['Rust 内核 / TS'],
    multiAgent: '单 agent 为主，可脚本并发多进程',
    state: '本地 session rollout 文件',
    toolCalling: 'OpenAI tool calls（apply_patch / shell）',
    traceability: 'cli-log',
    traceNote: 'codex exec --json 可输出结构化事件流；否则解析 stdout。session rollout 存于 ~/.codex/sessions。',
    strengths: ['终端原生、改代码强', 'sandbox 执行', '--json 事件流可解析'],
    weaknesses: ['生态以 OpenAI 模型为中心', '多 agent 编排需自己包'],
    code: `# Codex CLI —— 非交互执行 + 结构化事件
codex exec --json "给 utils.py 补充单元测试" \\
  | jq -c 'select(.type=="item.completed")'
# 每行一个 JSON 事件 → aker 解析为 trace step`,
  },
  {
    id: 'hermes',
    name: 'Hermes (function-calling)',
    vendor: 'Nous Research',
    kind: '模型 + 调用约定',
    paradigm: '<tool_call> XML/JSON 标签约定的函数调用 agent',
    language: ['任意（看推理栈）'],
    multiAgent: '需外部编排（无内置）',
    state: '自管 messages 数组',
    toolCalling: 'Hermes 风格 <tool_call>{json}</tool_call> 标签',
    traceability: 'api-only',
    traceNote: 'Hermes 本身只是模型+提示约定，trace 取决于你的推理服务器（vLLM/TGI）是否记录。aker 通过包一层 adapter 记录每轮 messages 形成 trace。',
    strengths: ['开源权重、可私有化', '函数调用格式清晰', '不锁厂商'],
    weaknesses: ['要自己搭推理与编排', '无原生 observability'],
    code: `# Hermes 函数调用约定（模型输出）
<tool_call>
{"name": "search_web", "arguments": {"q": "aker agent eval"}}
</tool_call>
# 你的 runtime 解析标签 → 执行 → 把结果塞回 messages → 再推理`,
  },
  {
    id: 'langgraph',
    name: 'LangGraph',
    vendor: 'LangChain',
    kind: 'Python/JS 框架',
    paradigm: '有向图状态机（node/edge），支持环与人审',
    language: ['Python', 'JavaScript'],
    multiAgent: '一等公民：supervisor / 多节点子图',
    state: '显式 State + checkpointer（可持久/可回放）',
    toolCalling: 'LangChain tools 绑定',
    traceability: 'otel',
    traceNote: 'LangSmith 原生记录每个 node 的输入输出/耗时/token；也可导出 OpenTelemetry。aker 可接 LangSmith API 或 callback 拉 trace。',
    strengths: ['复杂控制流（分支/循环/中断）', '可持久化 + 时间旅行回放', '观测生态成熟（LangSmith）'],
    weaknesses: ['概念偏重、学习曲线', '调试图状态需要工具'],
    code: `# LangGraph —— 图 + checkpointer（可回放即 trace）
from langgraph.graph import StateGraph, START, END
g = StateGraph(State)
g.add_node("plan", plan); g.add_node("act", act)
g.add_edge(START, "plan"); g.add_conditional_edges("act", route)
app = g.compile(checkpointer=memory)   # 每步存档 → 可回放`,
  },
  {
    id: 'crewai',
    name: 'CrewAI',
    vendor: 'CrewAI Inc.',
    kind: 'Python 框架',
    paradigm: '角色制（role/goal/backstory）+ 任务编排',
    language: ['Python'],
    multiAgent: '核心卖点：多角色 Crew 协作（顺序/层级）',
    state: '任务上下文传递',
    toolCalling: 'CrewAI / LangChain tools',
    traceability: 'otel',
    traceNote: '内置 event listener + 可接 AgentOps/OpenTelemetry，记录每个 agent/task 的执行。aker 通过事件钩子收 trace。',
    strengths: ['多角色协作直观', '上手快、模板多', '适合"专家分工"类任务'],
    weaknesses: ['复杂分支控制弱于图', '隐式行为偏多'],
    code: `# CrewAI —— 角色分工
from crewai import Agent, Task, Crew
researcher = Agent(role="研究员", goal="收集资料", tools=[search])
writer     = Agent(role="撰稿", goal="成稿")
crew = Crew(agents=[researcher, writer], tasks=[t1, t2])
crew.kickoff()   # 事件监听器可抓每步 → trace`,
  },
  {
    id: 'autogen',
    name: 'AutoGen / AG2',
    vendor: 'Microsoft → AG2 社区',
    kind: 'Python 框架',
    paradigm: '多 agent 对话（GroupChat / 可终止会话）',
    language: ['Python', '.NET'],
    multiAgent: '核心：会话式多 agent，自动轮转发言',
    state: '消息历史 + GroupChatManager',
    toolCalling: '函数注册 + 自动调用',
    traceability: 'otel',
    traceNote: '0.4+ 内置 OpenTelemetry 追踪 runtime 消息；也可记录 GroupChat 全量对话。aker 接 OTel exporter 或直接存对话。',
    strengths: ['多 agent 对话范式强', '代码执行 agent 成熟', '可观测性内建'],
    weaknesses: ['会话易发散/绕圈', '成本控制需留意'],
    code: `# AutoGen —— 群聊式多 agent
from autogen import AssistantAgent, GroupChat, GroupChatManager
chat = GroupChat(agents=[planner, coder, critic], max_round=12)
mgr  = GroupChatManager(groupchat=chat, llm_config=cfg)
user.initiate_chat(mgr, message="实现并自审这个需求")`,
  },
  {
    id: 'openai-agents',
    name: 'OpenAI Agents SDK',
    vendor: 'OpenAI',
    kind: 'Python/JS SDK',
    paradigm: 'Agent + handoffs + guardrails（轻量编排）',
    language: ['Python', 'TypeScript'],
    multiAgent: 'handoff 机制在 agent 间转交',
    state: 'Runner 管理 + sessions',
    toolCalling: '原生 function tools / hosted tools',
    traceability: 'native',
    traceNote: '内置 Tracing：每次 run 产生 trace + spans（LLM/tool/handoff），可在 OpenAI 平台看或导出。aker 直接消费其 trace 对象。',
    strengths: ['轻量、官方维护', '原生 tracing 一等公民', 'handoff/guardrail 实用'],
    weaknesses: ['偏 OpenAI 生态', '复杂控制流不如图'],
    code: `# OpenAI Agents SDK —— 原生 tracing
from agents import Agent, Runner
triage = Agent(name="triage", handoffs=[billing, tech])
result = Runner.run_sync(triage, "我账单不对")
# result 自带 trace（spans: llm/tool/handoff）`,
  },
  {
    id: 'google-adk',
    name: 'Google ADK',
    vendor: 'Google',
    kind: 'Python/Java 框架',
    paradigm: '分层 agent（LlmAgent / Workflow agent）',
    language: ['Python', 'Java'],
    multiAgent: 'Sequential/Parallel/Loop 工作流 agent',
    state: 'Session + State service',
    toolCalling: '原生 + OpenAPI/MCP 工具',
    traceability: 'otel',
    traceNote: '内置 OpenTelemetry，与 Cloud Trace / Vertex 集成；本地也有 trace UI。aker 接 OTel。',
    strengths: ['企业级、与 GCP 深度整合', '并行/循环工作流原生', '评估套件自带'],
    weaknesses: ['偏 Google 生态', '相对新'],
    code: `# Google ADK —— 并行工作流 agent
from google.adk.agents import ParallelAgent, LlmAgent
fan = ParallelAgent(sub_agents=[a1, a2, a3])  # 并行扇出
# runner 产生 OTel spans → 导出做评审`,
  },
  {
    id: 'smolagents',
    name: 'smolagents',
    vendor: 'Hugging Face',
    kind: 'Python 框架（极简）',
    paradigm: 'Code-Agent（让模型写 Python 代码当动作）',
    language: ['Python'],
    multiAgent: '可嵌套 managed agents',
    state: '执行环境变量',
    toolCalling: '代码即工具调用（也支持 JSON tool）',
    traceability: 'otel',
    traceNote: '可接 OpenTelemetry / Langfuse；每步生成的代码与执行结果都可记录。',
    strengths: ['极简、代码动作很强', '模型无关', '步骤透明（看生成的代码）'],
    weaknesses: ['代码执行需 sandbox', '复杂编排需自己加'],
    code: `# smolagents —— 代码即动作
from smolagents import CodeAgent, InferenceClientModel
agent = CodeAgent(tools=[search], model=InferenceClientModel())
agent.run("查 aker 的并行评审怎么做")
# 每步=一段可见的 Python 代码 → 天然可审`,
  },
  {
    id: 'aider',
    name: 'Aider',
    vendor: 'OSS (Paul Gauthier)',
    kind: 'CLI（结对编程）',
    paradigm: 'repo-map + 编辑循环',
    language: ['Python 实现，改任意语言代码'],
    multiAgent: '单 agent',
    state: 'git commit 即状态',
    toolCalling: 'SEARCH/REPLACE 编辑块',
    traceability: 'cli-log',
    traceNote: '有 .aider.chat.history.md / llm 历史可解析；每次改动落 git commit，diff 即 trace。',
    strengths: ['git 原生、可回滚', '模型无关（litellm）', '编辑精准'],
    weaknesses: ['专注编码、非通用 agent', '无结构化 trace（需解析）'],
    code: `# Aider —— git 即 trace
aider --model openai/gpt-x --yes "把日志换成结构化 logging"
# 每轮改动 = 一个 commit；git log/diff 复盘`,
  },
];

// 对比矩阵列定义（前端渲染表头用）
export const MATRIX_COLUMNS = [
  { key: 'kind', label: '形态' },
  { key: 'paradigm', label: '范式' },
  { key: 'multiAgent', label: '多 agent' },
  { key: 'toolCalling', label: '工具调用' },
  { key: 'traceability', label: 'trace 可得性' },
];

export const TRACEABILITY_META = {
  native:    { label: '原生结构化', score: 4, color: '#16a34a', hint: '有一等公民的 trace/spans，直接消费' },
  otel:      { label: 'OTel/回调',  score: 3, color: '#0891b2', hint: '通过 OpenTelemetry 或 callback 收集' },
  'cli-log': { label: 'CLI 日志',   score: 2, color: '#d97706', hint: '解析 --json 事件流或 stdout/日志文件' },
  'api-only':{ label: '仅最终响应', score: 1, color: '#dc2626', hint: '只有最终输出，需自包一层记录中间步骤' },
  // sim 档：这一档不是某个框架的真实 trace 等级，而是「本次 run 是 Sim 模式、step 由模板拼装、未真实采集」的诚实标记。
  // 告警色（土黄）+ score 0，让前端一眼看出「这不是真 trace」。
  sim:       { label: '模拟 trace',  score: 0, color: '#a16207', hint: '模板生成，非真实采集——Sim 模式未真正调用模型，step 由 composeTrace 拼装' },
};

export function getFramework(id) {
  return FRAMEWORKS.find((f) => f.id === id) || null;
}
