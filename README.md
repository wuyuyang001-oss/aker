# Aker

> 把一个真实问题交给多个独立评审角色并行分析，再由评审团主席生成一份可直接执行的最终方案。

[在线体验（仅 Sim 演示）](https://wuyuyang001-oss.github.io/aker/) · [下载 macOS Apple Silicon 版](https://github.com/wuyuyang001-oss/aker/releases)

在线体验不会调用真实模型。要得到对实际工作有意义的结果，请在本地使用 Live 模式。

## 你能用它做什么

- 在上线前让“策略评审、反方评审、执行评审”独立检查同一个方案。
- 把多个真实回答合并为最终判断、推荐方案、风险验证和立即行动。
- 对比不同 agent 的真实事件、token、耗时与工具调用。
- 保存每次 run，随时回看、复制最终 Markdown。

适合产品决策、技术方案、实施计划、风险审查和复盘。不适合把多数意见直接当作事实真相。

## 5 分钟首次使用

### 1. 准备一个真实运行通道

推荐使用已经登录的 [Codex CLI](https://github.com/openai/codex)。Aker 会自动检测 PATH，以及 macOS 的 `/Applications/Codex.app`。

也可以设置 API key：

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."

# 可选：覆盖默认模型
export AKER_OPENAI_MODEL="gpt-4.1-mini"
export AKER_ANTHROPIC_MODEL="claude-sonnet-4-6"
```

### 2. 启动

需要 Node.js 20 或更高版本。

```bash
npm install
npm start
```

打开 http://127.0.0.1:5178 。侧栏显示 **Live 可用**，就说明真实通道已经就绪。

### 3. 完成一次真实评审

1. 在运行台写下目标、约束和完成标准。
2. 保持 **Live 模式**，使用默认的策略 / 反方 / 执行三个评审角色。
3. 点击“并行运行”。
4. 完成后点击“进入评审会，生成最终方案”。
5. 复制“更优解”Markdown，直接进入执行。

Live 失败会明确显示错误，**不会静默降级成 Sim**。

## 运行模式

| 模式 | 数据来源 | 适合用途 |
|---|---|---|
| Live · Codex CLI | `codex exec --json` 的真实回答、事件和 token | 实际评审、真实综合、trace 对比 |
| Live · OpenAI / Anthropic API | 真实最终回答和 usage | 实际评审、真实综合 |
| Sim | 确定性模板输出和模拟 trace | 无账号时了解产品流程 |

Sim 的聚类算法是真实执行的，但输入和 trace 是模板数据，不代表任何真实模型的共识或能力。

## 当前实现边界

- Codex CLI 已接通真实 JSONL 事件流；OpenAI / Anthropic 直连目前只有最终回答和 usage。
- 共识聚类仍使用字面 Jaccard 相似度，不是语义 embedding；同义改写可能被误判为分歧。
- Live 评审团主席会做真实二次综合；规则聚类主要用于提供结构化参考。
- Codex CLI 每个评审都是一次真实模型调用，会消耗时间和额度。
- GitHub Pages 单文件版永远只运行 Sim，避免在浏览器中暴露 API key。

完整批评、限制和路线图见 [docs/CRITICISMS.md](docs/CRITICISMS.md)。

## 常用命令

```bash
npm start          # 本地 Web 服务：http://127.0.0.1:5178
npm run app        # Electron 桌面应用
npm test           # 单元测试 + 服务端首次使用 smoke test
npm run check      # 测试 + 构建单文件网页
npm run build:web  # 构建 dist/aker.html，并同步 GitHub Pages
npm run pack       # 打包 macOS 应用与 zip
```

## 工作原理

```text
用户任务
  -> 多个评审角色并行运行
  -> 归一化真实回答与 trace
  -> 规则聚类：共识 / 全集 / 分歧
  -> Live 评审团主席解决冲突并综合
  -> 可复制的最终行动方案
```

```text
server.mjs            HTTP + API
src/adapters.mjs      Codex CLI / OpenAI / Anthropic / Sim runner + Live synthesis
src/orchestrator.mjs  并行编排与失败隔离
src/committee.mjs     共识、分歧、规则式归因
src/trace.mjs         统一 trace 模型与过程对比
src/store.mjs         run 持久化
web/                  Vanilla JS 前端
```

## License

MIT
