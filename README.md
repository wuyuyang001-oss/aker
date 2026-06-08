# Aker

> 多 agent（不同框架 × 不同模型）并行运行 → **评审会**对多输出取交集/并集、做差异归因、给更优解 → 基于 **trace** 做多模型/多 agent 的效果评审。

**▶ 在线体验（无需安装）：** https://wuyuyang001-oss.github.io/aker/
**⬇ 下载桌面版（macOS Apple Silicon）：** [Releases](https://github.com/wuyuyang001-oss/aker/releases) 里的 `Aker-mac-arm64.zip`

零依赖（Node 内置 http），双模式：
- **Sim 模式**（默认，无需 key）：用真实编排器跑出差异化输出 + 归一化 trace，完整演示评审闭环。所有交并集/归因都是**真实计算**，非假数据。
- **Live 模式**（检测到 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 或 `claude`/`codex` CLI 时自动启用）：adapter 切到真实模型调用，不可用时优雅降级回 Sim。

## 跑起来

**桌面 App（Electron）**
```bash
npm install
npm run app          # 启动 Aker 桌面应用
npm run pack         # 打包成 dist-app/.../Aker.app（含图标）
```

**纯网页 / 服务器**
```bash
node server.mjs      # → http://localhost:5178
npm run build:web    # 生成零依赖单文件 dist/aker.html（= docs/index.html，Pages 用）
```

## 四个板块
1. **运行台** — 配置「任务 + N 个 (框架×模型) agent」，并行派发，看各自输出与 trace 指标。
2. **评审会** — 选一次 run，取「交集(共识)」或「并集(全集)」，看分歧点 + 差异归因 + 综合更优解。
3. **Trace 对比** — 选两个 agent，对比执行过程（步骤/工具/token/耗时）做效果评审。
4. **框架图鉴** — 各 agent 框架的范式、多 agent、工具调用、**trace 可得性**对比矩阵 + 代码卡片。

## 架构（可插拔）
```
server.mjs            HTTP + API（零依赖）
src/frameworks.mjs    框架图鉴数据（含 trace 可得性分级）
src/adapters.mjs      runner 适配器：每个框架一个；Sim + Live(Anthropic/OpenAI/CLI)
src/orchestrator.mjs  并行编排（Promise.allSettled，互不拖累）
src/committee.mjs     评审会：要点聚类 → 交并集 / 分歧 / trace 归因 / 更优解综合
src/trace.mjs         统一 trace 模型 + 过程 diff
src/store.mjs         run 持久化（data/runs.json）
web/                  前端 SPA（vanilla，claude design 风格）
```

## 扩展一个框架
在 `src/frameworks.mjs` 加一条图鉴；在 `src/adapters.mjs` 的 `FRAMEWORK_TOOLKIT` 加工具集，
Live 模式在 `runLive()` 里加一个真实通道（HTTP 或 `spawn` 调 CLI）即可。

---

## 关于「CLI 能不能拿到任务运行的 trace」——可行性结论

能，但**可得性分四档**（见框架图鉴的 trace 可得性列），aker 据此决定评审能做多细：

| 档位 | 框架举例 | 怎么拿 | 评审粒度 |
|---|---|---|---|
| 原生结构化 | Claude Code/Agent SDK、OpenAI Agents SDK | 直接读 session transcript(jsonl) / SDK 的 trace 对象（含每步 token） | 可逐步回放、逐工具归因 |
| OTel/回调 | LangGraph、CrewAI、AutoGen、ADK、smolagents | 接 OpenTelemetry exporter 或框架 callback/event listener | 节点/agent 级，含耗时 token |
| CLI 日志 | Codex CLI、Aider | 解析 `--json` 事件流，或 stdout / `~/.codex/sessions`、`.aider.chat.history` | 步骤级，需解析 |
| 仅最终响应 | Hermes（裸模型+约定） | 框架本身不记录，需在 adapter **包一层**记录每轮 messages | 只能记我们包的那层 |

**对 aker 的含义**：adapter 层把上述异构 trace 统一归一成 `src/trace.mjs` 的 step 结构（think/tool/observe/message…），
之后的效果评审（过程 diff、差异归因）就与具体框架解耦了。本机当前未装 CLI / 未配 key，故默认 Sim；
装上 `claude`/`codex` 或配置 key 后，Live adapter 会把真实 trace 喂进同一套评审管线。
