---
name: pi-subagents
description: Project-specific guide to the pi-subagents extension and delegation workflows for BigLeninHistMod. Use for agent discovery, creation, configuration, single/parallel/chain/async runs, HOI4 implementation handoffs, review, and runtime control.
---

# Pi Subagents — BigLeninHistMod

This skill is for the parent orchestrator only. Spawned children receive concrete role tasks and must not read or apply this skill. Ordinary children must not launch subagents. A child may delegate only when its resolved `tools` explicitly includes `subagent` and the parent assigned bounded fanout work.

## Project agents

Call `subagent({ action: "list" })` before execution and use only agents reported as executable.

| Agent | Purpose |
|---|---|
| `hoi4-weak-agent` | Subagent worker |
| `hoi4-strong-agent` | Subagent planner / worker (for complex tasks) |

Generic builtin and user agents are disabled for this project. Do not use agent names from upstream examples unless `action: "list"` actually reports them.

## Documentation contract

Project agents receive the project extensions and can use `docs_search`. Every HOI4 child task should require the agent to:

1. extract domain-specific words, exact identifiers, effects, triggers, modifiers, scopes, and localization terms from the request;
2. call `docs_search` for unfamiliar or engine-sensitive terms before planning or editing;
3. search both exact tokens and a short conceptual phrase;
4. verify documentation against the actual mod and local vanilla files;
5. cite documentation paths in evidence, plans, handoffs, and reviews.

Codebase-memory MCP is disabled. Use `docs_search`, `rg`, local vanilla files, and `scripts/hoi4-mcp-cli.js`.

# Extension reference

## Tool and command surfaces

The parent normally uses the `subagent(...)` tool. Interactive users may use the extension commands:

- `/run` — run one agent;
- `/parallel` — run independent tasks concurrently;
- `/chain` — run sequential and static fanout/fan-in steps;
- `/run-chain` — run a saved `.chain.md` or `.chain.json` workflow;
- `/subagents-fleet` — inspect active runs;
- `/subagents-doctor` — diagnose discovery, sessions, async execution, and intercom;
- `/subagents-models` — inspect resolved models;
- `/subagent-cost` — inspect parent and child usage.

Use tool calls in automated orchestration. Use slash commands when explaining an interactive action to the user.

## Execution modes

### Single

Use one agent for one bounded responsibility:

```ts
subagent({
  agent: "hoi4-weak-agent",
  task: "Investigate the specified focus reward. Use docs_search and local vanilla evidence. Do not edit files.",
  context: "fresh",
  acceptance: { level: "none", reason: "Explicit evidence task." }
})
```

### Parallel

Parallelize independent reading, research, review, or validation angles. Give every child a distinct task and output path. Do not run multiple writers in one checkout.

```ts
subagent({
  tasks: [
    { agent: "hoi4-weak-agent", task: "Trace script definitions and references. No edits.", output: "script-context.md" },
    { agent: "hoi4-weak-agent", task: "Trace localization, tooltips, and vanilla precedents. No edits.", output: "loc-context.md" }
  ],
  context: "fresh",
  concurrency: 2,
  acceptance: { level: "none", reason: "Independent evidence tasks." }
})
```

### Chain

Use a chain when later work consumes earlier results. Available template variables:

- `{task}` — original chain task;
- `{previous}` — previous step output or aggregated parallel output;
- `{chain_dir}` — chain artifact directory;
- `{outputs.name}` — a prior successful result named with `as`.

Use `reads` for durable file handoffs and `as` when a later step needs one specific result. Use `phase` and `label` to improve status output.

```ts
subagent({
  chain: [
    {
      agent: "hoi4-weak-agent",
      as: "context",
      task: "Build exact HOI4 evidence for {task}. No edits.",
      output: "context.md",
      outputMode: "file-only",
      acceptance: { level: "none", reason: "Evidence step." }
    },
    {
      agent: "hoi4-strong-agent",
      reads: ["context.md"],
      task: "Read {chain_dir}/context.md and produce an implementation-ready plan for {task}.",
      output: "plan.md",
      outputMode: "file-only",
      acceptance: { level: "none", reason: "Planning step." }
    }
  ],
  context: "fresh"
})
```

Do not create saved chains until their workflow is explicitly agreed with the user.

### Async/background

Use `async: true` when useful work can continue in the parent or when the workflow is long-running. Async does not authorize simultaneous edits to the same checkout.

When no independent work remains and the current turn must continue, call:

```ts
wait({ id: run.id })
wait({ all: true })
```

Do not poll with sleep loops. In non-interactive `pi -p` runs, ending the turn abandons live children; use `wait` when completion is required in the same run.

### Fresh and forked context

- `context: "fresh"` — isolated task context; preferred for reconnaissance and independent validation.
- `context: "fork"` — branched persisted parent session; use only when inherited decisions or private conversation context are necessary.

Fork requires a persisted parent session. It inherits conversation history and is not a minimal review context.

## Output and artifact handling

- `output` saves the complete result to a known path.
- `outputMode: "file-only"` returns a compact path reference and keeps large content out of parent context.
- `reads` tells a child which durable files to inspect; it does not inject file contents.
- `output: false` disables saved output and is not equivalent to file-only mode.
- Parallel tasks must never share output paths.
- Generated run artifacts must not be committed.

For repository-local orchestration artifacts use `.pi-runs/<task-slug>/`; `.pi-runs/` and `.pi-subagents/` remain ignored by Git.

## Acceptance policies

The extension supports `auto`, `none`, `attested`, `checked`, `verified`, and `reviewed`. This project normally uses explicit parent review gates, so set:

```ts
acceptance: {
  level: "none",
  reason: "Parent inspects HOI4 changes and validation explicitly."
}
```

Use stronger runtime acceptance only when its criteria and verification commands are deliberately defined. A worker claiming tests passed is evidence, not independent review.

## Runtime control

Inspect active work:

```ts
subagent({ action: "status", id: run.id })
subagent({ action: "status", view: "fleet" })
subagent({ action: "status", id: run.id, view: "transcript", index: 0, lines: 120 })
```

Control rules:

- `steer` queues non-terminal guidance for a live async child;
- `interrupt` softly stops the current child turn and leaves the run paused;
- `resume` follows up with a live child or revives a completed child from its persisted session;
- `stop` terminates a top-level async run and is not a resumable pause;
- `append-step` appends one step to a running async chain.

```ts
subagent({ action: "steer", id: run.id, message: "Verify the exact tooltip key before continuing." })
subagent({ action: "interrupt", id: run.id })
subagent({ action: "resume", id: run.id, index: 0, message: "Continue with the clarified scope." })
subagent({ action: "stop", id: run.id })
```

A quiet child is not necessarily stuck. Inspect status or transcript before intervening. Use `doctor` only for actual discovery, startup, session, async, or intercom failures.

## Supervisor coordination

Children may receive `contact_supervisor` from the native bridge. They should use:

- `need_decision` for blocking product, scope, API, or architecture choices;
- `interview_request` for structured input;
- `progress_update` for meaningful non-blocking progress or a discovery that changes the plan.

The parent replies through `subagent_supervisor`:

```ts
subagent_supervisor({ action: "pending" })
subagent_supervisor({ action: "reply", replyTo: requestId, message: "Use the vanilla-compatible option." })
```

Do not invent intercom targets. Routine completion is returned through the normal result, not supervisor messaging.

# Agent and chain configuration

## Discovery and precedence

Agents:

1. `.pi/agents/**/*.md` — project;
2. `~/.pi/agent/agents/**/*.md` — user;
3. package agents;
4. builtin agents.

Project agents win runtime-name collisions. Legacy `.agents/**/*.md` remains supported, but `.pi/agents/` is canonical here.

Saved chains:

- `.pi/chains/**/*.chain.md` and `.chain.json` — project;
- `~/.pi/agent/chains/**/*.chain.md` and `.chain.json` — user.

Use `.chain.md` for simple sequential/static workflows. Use `.chain.json` for dynamic fanout, inline schemas, or more complex structure.

## Agent frontmatter

Minimal project agent:

```md
---
name: hoi4-specialist-name
description: Exact role and when to invoke it.
tools: read,bash,docs_search
skills: hoi4-mod-development
systemPromptMode: append
inheritProjectContext: true
inheritSkills: false
defaultContext: fresh
completionGuard: false
---

Role-specific instructions.
```

Important fields:

- `name`, optional `package`, and `description` define discovery and runtime identity;
- `tools` is the child tool allowlist; include `docs_search` for HOI4 analysis and `read` when skills must be loaded;
- `skills` adds named skills even when `inheritSkills` is false;
- `extensions` omitted means normal extensions load; empty means no normal extensions;
- `subagentOnlyExtensions` loads extension paths only for this agent's children;
- `systemPromptMode: append` keeps Pi's base prompt; `replace` uses a narrow custom prompt;
- `inheritProjectContext` controls AGENTS/project instruction inheritance;
- `inheritSkills` controls the discovered skill catalog;
- `defaultContext` sets `fresh` or `fork` when a call omits context;
- `model`, `fallbackModels`, and `thinking` choose execution models;
- `output`, `defaultReads`, and `defaultProgress` define handoff defaults;
- `timeoutMs`, `turnBudget`, and `toolBudget` bound execution;
- `maxSubagentDepth` may tighten nested fanout;
- `memory` enables dedicated project/user role memory;
- `completionGuard: false` is appropriate for read-only or bash-enabled advisors that are not implementation agents.

For this project, do not set `extensions:` to empty on agents that need `docs_search`; the tool comes from a normal project extension.

## Management actions

Create, inspect, update, disable, or delete agents without manually editing files:

```ts
subagent({ action: "get", agent: "hoi4-recon" })
subagent({
  action: "create",
  config: {
    scope: "project",
    name: "hoi4-new-specialist",
    description: "Narrow HOI4 project role",
    systemPrompt: "Role-specific instructions.",
    systemPromptMode: "append",
    inheritProjectContext: true,
    inheritSkills: false,
    tools: "read,bash,docs_search",
    skills: "hoi4-mod-development"
  }
})
subagent({ action: "update", agent: "hoi4-new-specialist", agentScope: "project", config: { thinking: "high" } })
subagent({ action: "disable", agent: "hoi4-new-specialist", agentScope: "project" })
subagent({ action: "enable", agent: "hoi4-new-specialist", agentScope: "project" })
subagent({ action: "delete", agent: "hoi4-new-specialist", agentScope: "project" })
```

Use `eject` only to copy a package/builtin definition into editable scope. Use `reset` to remove an ejected override and restore its lower-precedence definition. Do not alter global agents when a project agent or project override is sufficient.

## Child-only extension tools

Use `subagentOnlyExtensions` when a tool should exist only inside one agent type. Paths may be absolute or project-relative according to the extension's resolution rules. If `extensions` is explicitly present, it becomes an allowlist and takes precedence over normal extension discovery; include every required extension.

Normal project extensions and settings are loaded in child Pi processes because subagents run Pi with the assigned cwd. Project trust must therefore be active. Agent-level `inheritProjectContext` and `inheritSkills` rewrite what reaches the child prompt but do not replace tool allowlisting.

## Dynamic fanout

Dynamic fanout is available in direct JSON or saved `.chain.json` workflows. A prior step must produce validated structured output with `outputSchema` and `as`. An `expand` step selects an array by JSON pointer, requires `maxItems`, applies one child template per item, and stores ordered results with `collect.as`.

Do not use dynamic fanout for prose parsing, arbitrary conditions, dynamic agent selection, reducers, nested fanout, or unbounded arrays.

# Project orchestration policy

## Smallest useful delegation

- Locate content or understand a mechanic: one fresh `hoi4-recon`.
- Requested plan: `hoi4-recon → hoi4-architect`.
- Clear script change: one `hoi4-script-worker`; add recon only when terminology or scope is uncertain.
- Localization-only task: one `hoi4-localization-worker`.
- Map/GUI task: one `hoi4-map-gui-specialist`.
- Explicit review request: a fresh `hoi4-validator` after implementation.

Do not launch a full workflow by default. Do not invoke `hoi4-architect` unless planning, recommendation, or a real design decision is needed.

## Writer and Git safety

- Keep one writer in a checkout.
- Parallel writers require isolated worktrees and disjoint ownership.
- Parent owns Git operations unless the user explicitly changes that contract.
- Children must not commit, checkout, reset, stash, merge, or rebase.
- Preserve unrelated changes.
- Writers modify shipped content under `BigLeninHistMod/` unless tooling or agent configuration is explicitly in scope.
- The Windows smoke test runs only when explicitly requested.

## Child prompt contract

Every task should include:

- exact scoped goal and non-goals;
- cwd and artifact paths to read/write;
- instruction to use `docs_search` for request terminology;
- required mod, vanilla, and `hoi4-mcp-cli` evidence;
- ownership and no-Git constraints;
- validation expectations;
- expected status (`DONE`/`BLOCKED` or `PASS`/`FIX`/`DECISION`);
- `Do not read or apply the pi-subagents skill; the parent owns orchestration.`

## Error handling

- Unknown agent or chain: `subagent({ action: "list" })`.
- Discovery/session/intercom failure: `subagent({ action: "doctor" })`.
- Max depth exceeded: flatten the workflow; do not silently raise limits.
- Fork failure: use a persisted parent session or explicitly choose fresh context.
- Parallel output conflict: assign distinct paths.
- Worktree launch failure: inspect cleanliness, cwd ownership, and setup hook requirements.
- Child startup failure: inspect status, transcript, session path, and artifact metadata before retrying.
