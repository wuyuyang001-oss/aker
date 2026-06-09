# Aker

> Compare independent Agents on the same open task, inspect what they actually did, and fuse the best-supported answer.

[Download the latest macOS app](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip) · [Try the Sim-only web demo](https://wuyuyang001-oss.github.io/aker/) · [View releases](https://github.com/wuyuyang001-oss/aker/releases)

Aker is a local-first Agent comparison, evaluation, and answer-fusion workbench for research, analysis, and solution-design tasks without an immediate ground truth. It does not claim that a majority vote reveals absolute truth. It helps users obtain an answer with stronger source support, broader coverage, explicit disagreements, and visible evidence gaps.

## How It Works

1. Start with one natural-language task. No intake form is required.
2. Aker generates an editable brief: objective, deliverable, scope, constraints, freshness, evidence policy, and rubric.
3. Select 2–4 independent Agents and a Judge.
4. Each Agent receives the same task and read-only permission boundary.
5. Inspect each Agent's observable action chain: searches, fetched pages, tools, sources, subagents, errors, and answer.
6. The Judge scores answers and produces an evidence-weighted fused answer.

Research and freshness-sensitive tasks automatically use `required` evidence policy. An Agent that does not search, read a page, or report a source remains visible but is marked **incomplete research** and excluded from factual fusion.

## Five-Minute Acceptance Tour

1. Download and open Aker.
2. Enter: `调研 DeerFlow 2.0 与 Codex CLI 在深度研究任务上的关键差异，给出带来源的完整比较。`
3. Confirm that Aker sets the evidence policy to `required`.
4. Select two available Agents and an independent Judge. Use Sim only to learn the workflow.
5. Start the run and expand each Agent card. Confirm that its searches, sources, tools, errors, and full answer are visible.
6. Scroll the main conversation to the bottom; the composer must remain visible.
7. Run the Judge. Confirm that the result includes a scoreboard, fused answer, contributions and omissions, conflicts, evidence gaps, and sources.

## Desktop Install

Requirements:

- Apple Silicon Mac
- Node.js 20+ only when running from source
- For real runs, at least one supported local CLI, model API, or connected DeerFlow Gateway

Download and open:

1. Download [`Aker-mac-arm64.zip`](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip).
2. Optionally verify [`Aker-mac-arm64.zip.sha256`](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip.sha256).
3. Unzip and open `Aker.app`.
4. If macOS blocks the unsigned app, use **Control-click → Open** or approve it under **System Settings → Privacy & Security**.

The app is currently unsigned, not notarized, and does not auto-update.

## Runner Support

| Runner | Answer tasks | Search/read | Observable trace | Judge |
|---|---:|---:|---:|---:|
| Codex CLI | Yes | Yes | JSONL events | Yes |
| DeerFlow 2.0 Gateway | Yes | Yes | LangGraph-compatible SSE | Yes |
| Claude Code / Gemini CLI | Yes | Adapter-dependent | Limited | Yes |
| OpenAI / Anthropic Direct API | Non-research tasks | No built-in search | Final response + usage | Yes |
| Sim | Workflow demonstration only | Simulated | Simulated | Simulated |

Codex runs in read-only research mode:

```bash
codex --search exec --json --sandbox read-only
```

Aker allows search, browsing, local read-only access, and isolated computation. It prohibits real external writes, submissions, sends, and modifications.

### DeerFlow 2.0

Paste `https://github.com/bytedance/deer-flow` in the Runner panel. Aker recognizes the official repository and can connect to an already-running Gateway, commonly `http://localhost:8001`.

For safety, GitHub import only stores an adapter manifest and previews declared installation/start commands. Aker never executes those commands without explicit confirmation. Other repositories must provide a valid `aker-agent.json` at the repository root.

## Run From Source

```bash
git clone https://github.com/wuyuyang001-oss/aker.git
cd aker
npm install
npm start
```

Open <http://127.0.0.1:5178>.

```bash
npm run app        # Electron app from source
npm test           # unit and server smoke tests
npm run check      # tests plus Sim-only standalone build
npm run pack       # build macOS app, zip, checksum, and Desktop Aker.app
```

## API

- `GET /api/runners`
- `POST /api/runners/import-github`
- `POST /api/runners/:id/test`
- `GET|POST /api/tasks`
- `GET|PATCH /api/tasks/:id`
- `POST /api/tasks/:id/run` (NDJSON event stream)
- `POST /api/tasks/:id/evaluate`

Legacy `/api/projects` endpoints and v0.4 project data remain available. The v0.5 UI opens old projects as read-only legacy tasks and does not delete or rewrite them.

## Important Boundaries

- No-GT evaluation can improve support and coverage; it cannot guarantee absolute correctness.
- A Judge can share model, provider, prompt, or sources with answerers; Aker warns about obvious self-review.
- Observable traces contain tool activity and results, never private chain-of-thought.
- Sim output, searches, sources, latency, and tokens are demonstrations and never enter factual fusion.
- Standalone Web Demo is Sim-only. Real runners and secrets stay behind the local desktop server.
- Each Live run consumes the user's provider quota.

Local data:

- source/server: `data/runs.json`
- packaged app: `~/Library/Application Support/Aker/runs.json`

Aker has no first-party telemetry service.

## Architecture

```text
server.mjs             loopback API, streaming task orchestration, legacy compatibility
src/tasks.mjs          task brief, evidence policy, runner selection, parallel execution
src/runners.mjs        local/API runner registry, DeerFlow and GitHub manifest import
src/adapters.mjs       Codex JSONL, DeerFlow SSE, API, CLI, and Sim adapters
src/evaluator.mjs      evidence gate, scorecards, Judge prompt, and answer fusion
src/trace.mjs          normalized observable action-chain schema
src/store.mjs          local task, project, and run persistence
web/                   dependency-free Electron/Web interface
```

## License

MIT
