# Aker Product Direction

## Product Thesis

Aker helps a user make a consequential decision when there is no immediate ground truth, the available information is incomplete, and a confident single answer may hide important failure modes.

The product is not a model leaderboard. It uses independent perspectives, explicit uncertainty, and structured disagreement to reduce decision risk.

## Best-Fit Tasks

- Product direction and prioritization
- Market, competitor, and opportunity research
- Vendor, architecture, and operating-model selection
- Rollout, policy, and risk decisions
- Any one-off decision where the cost of a plausible but wrong answer is meaningful

Coding benchmarks remain useful for testing adapters and execution traces, but they are not the primary product.

## Core Workflow

1. **Conversation**: start from one natural-language question rather than a required form.
2. **Working brief**: automatically maintain decision, context, constraints, success criteria, and unknowns behind the conversation.
3. **Independent judgments**: strategy, counterargument, action, and evidence perspectives answer without seeing one another.
4. **Continuous review**: expose evidence checks and disagreement while perspectives are still running.
5. **Decision package**: provide a recommendation, confidence, conditions, strongest objection, unresolved uncertainty, and low-cost validation steps.
6. **Branch and update**: add evidence, challenge a claim, or create a branch and rerun the decision.

## Product Principles

- Agreement is a signal, not proof.
- A minority view can be more important than the majority.
- Confidence must state its basis and conditions.
- Unknowns should become validation actions.
- Process traces improve transparency, but more steps do not imply a better answer.
- Shared models and shared sources create correlated errors and must be disclosed.
- Aker must never invent evidence or silently replace a failed Live run with simulated output.

## Priorities

### P0: Decision Workflow

- Structured decision brief
- Four independent perspectives
- Decision-package-first result hierarchy
- Explicit facts, assumptions, inferences, and unknowns
- Strongest objection and information-that-would-change-the-conclusion prompts

Status: implemented in v0.4.0, including the conversation-first project model, live execution timeline, and branch exploration.

### P1: Source-Backed Research

- Ingest public sources supplied in conversation
- Attach citations to individual claims
- Record source date, publisher, and independence
- Detect when several perspectives rely on the same underlying source
- Show unsupported or conflicting claims before synthesis

Status: public links are safely ingested, numbered, and passed to reviewers in v0.4.0. Autonomous source discovery, claim-level citation enforcement, and source-independence analysis remain future work.

### P2: Decision Criteria and Scenarios

- Let users weight decision criteria and risk tolerance
- Compare explicit options rather than only answering an open question
- Show how the recommendation changes under different assumptions
- Track reversible versus irreversible choices

### P3: Independence Controls

- Support multiple model providers and research strategies in one run
- Display a correlation warning for shared model, provider, prompt, or source
- Recommend an appropriate perspective mix for the decision type
- Allocate more budget only to high-impact disagreements

### P4: Outcome Learning

- Let users record the decision made and later outcome
- Compare predicted risks with actual results
- Improve templates and confidence calibration from completed decisions

## Success Metrics

Aker should optimize for decision quality and actionability, not answer volume:

- Percentage of runs that produce a copied or exported decision package
- Percentage of decision packages that lead to a validation action
- Number of critical unknowns resolved before commitment
- User-reported reduction in overlooked risks
- Calibration between stated confidence and later outcomes
- Time and model cost required to reach a decision

## Explicit Non-Goals

- Declaring a universally best model or CLI
- Treating majority vote as truth
- Replacing the accountable human decision owner
- Presenting simulated runs as research evidence
- Generating longer answers without improving the decision
