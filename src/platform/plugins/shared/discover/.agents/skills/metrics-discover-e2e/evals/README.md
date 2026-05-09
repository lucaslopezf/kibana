# `metrics-discover-e2e` evals

Declarative test prompts + assertions for evaluating whether the colocated `metrics-discover-e2e` skill (`../SKILL.md` plus `../references/`) helps an AI agent answer real-world tasks correctly.

## What's here

`evals.json` — 2 prompts: writing a new spec for the breakdown selector (exercises the page-object hierarchy and locator conventions) and triaging a flaky spec (exercises the triage workflow). Each prompt has 5–8 assertions an answer must satisfy.

The schema is harness-agnostic — any tool that reads JSON can consume it. Run artifacts (transcripts, grading, benchmarks) are ephemeral and not checked in; regenerate them on demand.

## Running the evals

Driven through Anthropic's [`skill-creator`](https://github.com/anthropics/skills/tree/main/skill-creator).

**One-time setup** — in any Claude Code session:

    /plugin marketplace add anthropics/skills
    /plugin install example-skills@anthropic-agent-skills

**Run** — open a Claude Code session in this repo and say:

> Run the evals for the `metrics-discover-e2e` skill.

Skill-creator runs each prompt twice (with-skill and baseline subagent), grades against the assertions, and opens the eval viewer. To compare across changes: *"Run iteration N of the evals for `metrics-discover-e2e`."*

If the conversational flow gets stuck, drive `skill-creator`'s scripts directly — see its [README](https://github.com/anthropics/skills/tree/main/skill-creator).

## Adding a new eval

Append to the `evals` array: `id` (next integer), `name` (short slug), `prompt` (user-facing question), `expected_output` (one-paragraph rubric), 3–6 `assertions` (each `{name, description}`). Keep assertions objectively verifiable — "places spec under path X", "uses page object Y", "delegates to skill Z" — not "answer is well-written."
