# Aker

> Run multiple agents (different frameworks x different models) in parallel, then a **review committee** computes the intersection/union of their outputs, attributes differences, and synthesizes a better answer — plus **trace-based** effectiveness review across models and agents.

**▶ Live demo (no install):** https://wuyuyang001-oss.github.io/aker/
**⬇ Download desktop build (macOS Apple Silicon):** grab `Aker-mac-arm64.zip` from [Releases](https://github.com/wuyuyang001-oss/aker/releases)

Zero runtime dependencies (Node's built-in `http`), two modes:

- **Sim mode** (default, no API key): runs the real orchestrator to produce differentiated outputs + normalized traces, fully demonstrating the review loop. All intersection/union/attribution results are **real computations**, not mock data.
- **Live mode** (auto-enabled when `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` or a `claude` / `codex` CLI is detected): adapters switch to real model calls, gracefully degrading back to Sim when unavailable.

## Quick start

**Desktop app (Electron)**
```bash
npm install
npm run app          # launch the Aker desktop app
npm run pack         # package into dist-app/.../Aker.app (with icon)
```

**Plain web / server**
```bash
node server.mjs      # → http://localhost:5178
npm run build:web    # build the zero-dependency single-file dist/aker.html (= docs/index.html, used by Pages)
```

## Four panels

1. **Run desk** — configure a task plus N `(framework x model)` agents, dispatch in parallel, and inspect each agent's output and trace metrics.
2. **Review committee** — pick a run, take the **intersection (consensus)** or **union (full set)**, and see divergence points, difference attribution, and a synthesized better answer.
3. **Trace comparison** — pick two agents and compare their execution (steps / tools / tokens / latency) for an effectiveness review.
4. **Framework gallery** — a comparison matrix of each agent framework's paradigm, multi-agent support, tool calling, and **trace availability**, with code cards.

## Architecture (pluggable)

```
server.mjs            HTTP + API (zero dependencies)
src/frameworks.mjs    framework gallery data (with trace-availability tiers)
src/adapters.mjs      runner adapters: one per framework; Sim + Live (Anthropic/OpenAI/CLI)
src/orchestrator.mjs  parallel orchestration (Promise.allSettled, failures isolated)
src/committee.mjs     review committee: point clustering → intersection/union / divergence / trace attribution / synthesis
src/trace.mjs         unified trace model + process diff
src/store.mjs         run persistence (data/runs.json)
web/                  frontend SPA (vanilla JS)
```

## Adding a framework

Add an entry to `src/frameworks.mjs`; add a toolkit to `FRAMEWORK_TOOLKIT` in `src/adapters.mjs`; for Live mode, add a real channel in `runLive()` (HTTP, or `spawn` to invoke a CLI).

## On "can a CLI expose the trace of a task run?" — feasibility

Yes, but **availability comes in four tiers** (see the trace-availability column in the framework gallery). Aker uses these tiers to decide how granular a review it can produce:

| Tier | Framework examples | How to obtain | Review granularity |
|---|---|---|---|
| Native structured | Claude Code / Agent SDK, OpenAI Agents SDK | Read the session transcript (jsonl) / the SDK's trace object (with per-step tokens) directly | Step-by-step replay, per-tool attribution |
| OTel / callbacks | LangGraph, CrewAI, AutoGen, ADK, smolagents | Attach an OpenTelemetry exporter or a framework callback / event listener | Node/agent level, with latency and tokens |
| CLI logs | Codex CLI, Aider | Parse the `--json` event stream, or stdout / `~/.codex/sessions`, `.aider.chat.history` | Step level, requires parsing |
| Final response only | Hermes (bare model + convention) | The framework records nothing; the adapter must **wrap a layer** to record each round of messages | Only the layer we wrap |

**What this means for Aker:** the adapter layer normalizes these heterogeneous traces into the step structure in `src/trace.mjs` (think / tool / observe / message …), so the downstream effectiveness review (process diff, difference attribution) is decoupled from any specific framework. When no CLI is installed and no key is configured, it defaults to Sim; install `claude` / `codex` or configure a key and the Live adapter feeds real traces into the same review pipeline.

## Tech stack

- Node.js (>= 20), zero runtime dependencies (built-in `http`)
- Electron desktop shell (`@electron/packager` for builds)
- Vanilla-JS single-page frontend, buildable into one self-contained HTML file
- Optional Live integrations: Anthropic / OpenAI APIs, `claude` / `codex` CLIs

## License

MIT — see [LICENSE](LICENSE).
