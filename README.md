# Aker

> A multi-perspective decision workbench for important questions that do not have an immediate ground truth.

[Try the Sim-only web demo](https://wuyuyang001-oss.github.io/aker/) · [Download the latest macOS app](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip) · [View releases](https://github.com/wuyuyang001-oss/aker/releases)

Aker helps you make a better decision when there is no test suite, obvious correct answer, or reliable single expert. You provide a structured decision brief; independent strategy, counterargument, action, and evidence perspectives examine it separately; a final committee chair produces one decision package with conditions, objections, uncertainties, and low-cost validation steps.

Aker is not a model leaderboard and does not treat majority agreement as truth. Its purpose is to reduce decision risk by exposing assumptions and preserving meaningful disagreement.

## Current Status

| Capability | Status |
|---|---|
| macOS desktop app | Available for Apple Silicon (`arm64`) |
| Codex CLI Live runner | Implemented with real `codex exec --json` events and token usage |
| OpenAI / Anthropic API runners | Implemented with final response and usage data |
| Structured decision brief | Implemented |
| Four independent decision perspectives | Implemented |
| Live decision-package synthesis | Implemented |
| Browser demo | Sim only; it never calls a real model |
| Windows / Linux / Intel Mac packages | Not currently published |
| Code signing / Apple notarization | Not currently configured |

The default Live setup uses four separate calls to the first available runner. The perspectives do not see one another's answers, but they may still share the same model and information source. Role separation reduces omissions; it does **not** guarantee true multi-model independence.

Current Aker reviews the information you provide. It does not yet perform source-backed external research, so an evidence perspective identifies missing evidence and unsupported claims rather than inventing or retrieving sources.

## Fastest Path: Desktop App

The downloadable desktop app is the recommended way to evaluate Aker visually.

### Requirements

- Apple Silicon Mac
- [Codex app](https://openai.com/codex/) installed at `/Applications/Codex.app` and signed in

Aker does not bundle a model, Codex credentials, or API keys. The desktop app detects the Codex executable bundled with Codex.app and uses its existing login.

### Install and run

1. Download [`Aker-mac-arm64.zip`](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip).
2. Optionally verify it using [`Aker-mac-arm64.zip.sha256`](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip.sha256).
3. Unzip it and move `Aker.app` to Applications or another local folder.
4. Open Aker. The sidebar should show **Live channel detected** and `Codex CLI · current login`. Detection confirms configuration, not provider reachability, quota, or account health.
5. Describe the decision, known context, constraints, success criteria, and the unknowns most likely to change your mind.
6. Keep Live mode selected and run the default strategy / counterargument / action / evidence perspectives.
7. Open **Decision Package** to generate and copy the final recommendation.

The app is not signed or notarized yet. On first launch, macOS may require **Control-click → Open** or approval under **System Settings → Privacy & Security**. Only run binaries downloaded from this repository, and verify the checksum when provenance matters.

```bash
cd ~/Downloads
shasum -a 256 -c Aker-mac-arm64.zip.sha256
```

The desktop build does not currently auto-update. Download a newer release explicitly when one is published.

## Run From Source

Use this path for development, non-Codex API runners, or local Web access.

### Requirements

- Node.js 20 or newer
- At least one Live channel:
  - a signed-in `codex` executable on `PATH`; or
  - `OPENAI_API_KEY`; or
  - `ANTHROPIC_API_KEY`

```bash
git clone https://github.com/wuyuyang001-oss/aker.git
cd aker
npm install
npm start
```

Open <http://127.0.0.1:5178>. The health indicator lists the Live channels Aker actually detected.

Optional API model overrides:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export AKER_OPENAI_MODEL="gpt-4.1-mini"
export AKER_ANTHROPIC_MODEL="claude-sonnet-4-6"
npm start
```

API-key configuration is documented for source/server usage. A Finder-launched desktop app does not reliably inherit shell environment variables; use Codex.app for the normal desktop Live path.

## What a Successful Run Produces

1. Independent judgments that explicitly separate facts, assumptions, inferences, and unknowns.
2. The strongest objection and the information that would change each judgment.
3. A decision package containing:
   - recommendation, confidence, and conditions;
   - key reasons and their epistemic status;
   - strongest counterargument;
   - unresolved uncertainty;
   - lowest-cost validation steps;
   - immediate actions.
4. A local audit record with status, latency, token usage, and available process events.

Live failures are explicit and are **never silently replaced with Sim output**.

## Live, Sim, and Method Transparency

| Mode | Data source | Intended use |
|---|---|---|
| Live · Codex CLI | Real answers, JSONL events, and token usage from `codex exec --json` | Actual independent judgment, synthesis, and process audit |
| Live · OpenAI / Anthropic API | Real final answers and usage | Actual independent judgment and synthesis |
| Sim | Deterministic template outputs and generated trace values | Learning the interface without model access |

Sim runs demonstrate the workflow only. Their outputs, tokens, latency, and traces are not real model measurements.

The **Method Transparency** screen is a reference catalog describing possible integration and audit strategies. It does **not** mean every listed framework has a runnable Aker adapter. The implemented Live channels are the ones reported by the app's health indicator.

## Important Limitations

- Current reviewers analyze only the submitted brief. Aker does not yet retrieve and cite external evidence.
- Shared models and shared source information create correlated errors even when roles differ.
- Common-claim clustering uses lexical Jaccard similarity, not semantic embeddings. Paraphrases may be reported as divergence.
- A majority is not proof of correctness.
- Codex CLI exposes real event-level trace data; direct OpenAI and Anthropic API runners currently expose only final response and usage.
- Each perspective and the committee chair is a real model call in Live mode and consumes provider time and quota.
- Aker sends the submitted decision brief and synthesis context to the selected model provider.

Runs are stored locally:

- source/server: `data/runs.json`
- packaged macOS app: `~/Library/Application Support/Aker/runs.json`

Aker does not implement its own telemetry service. Model-provider behavior and data handling remain subject to the provider and account configuration you use.

For the product thesis and prioritized roadmap, see [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md). For the detailed critique log, see [docs/CRITICISMS.md](docs/CRITICISMS.md).

## Development

```bash
npm start          # local Web server at http://127.0.0.1:5178
npm run app        # Electron app from source
npm test           # unit and server smoke tests
npm run check      # tests plus standalone Web build
npm run build:web  # build dist/aker.html and sync docs/index.html
npm run pack       # build macOS app, zip, and SHA-256 checksum on Desktop
```

Architecture:

```text
server.mjs            HTTP API and Live synthesis orchestration
src/adapters.mjs      Codex CLI, OpenAI, Anthropic, and Sim runners
src/orchestrator.mjs  parallel dispatch and failure isolation
src/committee.mjs     lexical consensus, divergence, and rule-based analysis
src/trace.mjs         normalized trace model and process comparison
src/store.mjs         local run persistence
web/                  dependency-free frontend
```

## License

MIT
