# Aker

> A conversation-first decision workbench for consequential questions without an immediate ground truth.

[Download the latest macOS app](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip) · [Try the Sim-only web demo](https://wuyuyang001-oss.github.io/aker/) · [View releases](https://github.com/wuyuyang001-oss/aker/releases)

Aker helps a user move from an ambiguous question to an auditable decision and a concrete next action. The user starts with one natural-language message. Aker builds a working brief behind the conversation, dispatches independent strategy, counterargument, action, and evidence perspectives, reviews disagreement while they run, and produces one decision package.

Aker is not a model leaderboard, a generic chat wrapper, or a majority-vote machine. It is designed for one-off product, market, vendor, architecture, rollout, and operating decisions where plausible answers are easy to produce but costly to trust blindly.

## What The User Gets

- No required intake form. Start with one question and refine it through conversation.
- A persistent decision project containing the brief, messages, evidence, execution timeline, and result.
- Continuous review during execution, not a hidden evaluation step after the answer.
- A decision package with a recommendation, confidence, conditions, strongest objection, unresolved unknowns, validation steps, and immediate actions.
- Branch exploration from any important claim.
- Local-first execution through the user's own Agent CLIs or model API accounts.

## Five-Minute Acceptance Tour

1. Download and open Aker.
2. Ask a consequential question, including any constraints that already matter.
3. Use **Sim** to learn the workflow or **Live** to use a detected local/API channel.
4. Watch independent perspectives and committee checks arrive in the execution timeline.
5. Paste a public source URL into the conversation. Confirm it appears under **Evidence** with an `[S1]` identifier and readable status.
6. Open the decision package and create a branch from one claim.
7. Open **Connections** to verify which local CLIs and APIs are actually runnable.

The product is usable when a first-time user can complete that tour without reading source code, obtain a decision package, and identify the next validation action.

## Desktop Install

### Requirements

- Apple Silicon Mac
- For Live mode, at least one supported channel:
  - signed-in Codex CLI, Claude Code, or Gemini CLI;
  - OpenAI API; or
  - Anthropic API.

Aker does not bundle models, credentials, or API quota. It detects local executables and lets the user configure API keys in the Connections screen. API keys entered in the desktop app are stored in macOS Keychain.

### Run

1. Download [`Aker-mac-arm64.zip`](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip).
2. Optionally verify [`Aker-mac-arm64.zip.sha256`](https://github.com/wuyuyang001-oss/aker/releases/latest/download/Aker-mac-arm64.zip.sha256).
3. Unzip and open `Aker.app`.
4. If macOS blocks the unsigned app, use **Control-click → Open** or approve it under **System Settings → Privacy & Security**.

```bash
cd ~/Downloads
shasum -a 256 -c Aker-mac-arm64.zip.sha256
```

The app is currently unsigned, not notarized, and does not auto-update.

## Connection Support

| Channel | Current behavior |
|---|---|
| Codex CLI | Runnable; read-only sandbox; real JSON event trace |
| Claude Code | Runnable when detected; non-interactive JSON; tools disabled |
| Gemini CLI | Runnable when detected; headless JSON; plan approval mode |
| OpenAI API | Runnable when configured; final answer and usage |
| Anthropic API | Runnable when configured; final answer and usage |
| Aider | Detection only; intentionally not used for general decision work |
| Sim | Deterministic workflow demonstration; never presented as real research |

Detection confirms that an executable or credential exists. It does not guarantee provider reachability, authentication health, quota, or model access. Live failures remain explicit and are never silently replaced with Sim output.

## Evidence Model

Public HTTP/HTTPS links pasted into the conversation become numbered user-provided sources. The desktop server reads a bounded text excerpt, blocks local/private-network targets, and passes the resulting source dossier to each perspective. A source being present does not prove a claim; reviewers are instructed to cite `[S1]`-style identifiers and label unsupported statements as assumptions, inferences, or unknowns.

Aker does not yet autonomously search the public web. It audits sources supplied by the user and makes evidence gaps visible.

## Run From Source

```bash
git clone https://github.com/wuyuyang001-oss/aker.git
cd aker
npm install
npm start
```

Open <http://127.0.0.1:5178>. Node.js 20 or newer is required.

```bash
npm run app        # Electron app from source
npm test           # unit and server smoke tests
npm run check      # tests plus standalone Web build
npm run build:web  # build the Sim-only single-file Web demo
npm run pack       # build macOS app, zip, and checksum on Desktop
```

Optional environment-based API configuration remains supported:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export AKER_OPENAI_MODEL="gpt-4.1-mini"
export AKER_ANTHROPIC_MODEL="claude-sonnet-4-6"
npm start
```

## Important Boundaries

- Sim output, traces, latency, and token values are generated demonstrations.
- Shared models, prompts, and sources can create correlated errors even when roles differ.
- Common-claim clustering is lexical, so paraphrases may appear as disagreement.
- Direct API runners expose final responses and usage; Codex CLI exposes richer event-level traces.
- Each Live perspective and Live synthesis consumes the user's provider quota.
- Aker sends the decision brief and supplied source excerpts to the selected Live provider.
- Aker supports decision work; the accountable human still owns the decision.

Decision projects and runs are stored locally:

- source/server: `data/runs.json`
- packaged app: `~/Library/Application Support/Aker/runs.json`

Aker has no first-party telemetry service.

## Architecture

```text
server.mjs             loopback HTTP API and streaming orchestration
src/projects.mjs       conversational project, brief, branch, and timeline model
src/sources.mjs        bounded public-source intake with private-network blocking
src/connections.mjs    local CLI detection and macOS Keychain-backed API settings
src/adapters.mjs       CLI, API, and Sim runners
src/orchestrator.mjs   parallel dispatch and failure isolation
src/committee.mjs      claim clustering, disagreement audit, and decision package
src/store.mjs          local project and run persistence
web/                   dependency-free desktop/Web interface
```

See [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) for the product thesis and roadmap.

## License

MIT
