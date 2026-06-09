# Aker Product Direction

## Product Thesis

Aker compares different Agent frameworks, models, and execution strategies on the same open task, then produces the answer with the strongest available evidence support and coverage.

It is best suited to research, analysis, and solution design where there is no immediate ground truth and no need to perform real external writes. Aker does not treat consensus as truth and does not promise absolute correctness.

## Core Workflow

1. Start from a natural-language task.
2. Generate an editable task brief, evidence policy, and rubric.
3. Let the user choose 2–4 independent Agents and a Judge.
4. Run all Agents with identical task instructions and read-only boundaries.
5. Stream observable searches, reads, tools, subagents, sources, errors, and answers.
6. Exclude incomplete research from factual fusion.
7. Score, compare, explain disagreement, and produce an evidence-weighted fused answer.

## Product Principles

- Evidence support matters more than confident wording.
- Agreement is a signal, not proof.
- Unique contributions should remain visible.
- No-search research answers must not masquerade as completed research.
- Process traces improve auditability; hidden chain-of-thought is neither required nor displayed.
- Shared model, provider, and source dependencies create correlated error.
- GitHub-imported commands never run without explicit user confirmation.
- Sim is a workflow demo, never research evidence.

## Near-Term Priorities

- More robust claim-to-source mapping and conflict detection
- Full managed DeerFlow setup with explicit command approval
- Additional agent manifests and transport adapters
- Cost and latency budgets per Agent
- Exportable comparison reports
- Outcome feedback for evaluation calibration
