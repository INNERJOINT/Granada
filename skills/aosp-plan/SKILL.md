---
description: AOSP investigation-driven planning with consensus review
argument-hint: <AOSP investigation query>
model: opus
pipeline: [aosp-plan, aosp-autopilot]
next-skill: aosp-autopilot
handoff: .granada/plans/aosp-*.md
level: 4
---

# AOSP Plan Skill

Investigation-first AOSP consensus planning. Decomposes queries into facets, spawns parallel `aosp-investigator` subagents, synthesizes findings, then runs a zaku-native Planner -> Architect -> Critic consensus loop. Final plans are saved to `.granada/plans/` with `**Status:** pending approval`.

## Usage

```
/zaku:aosp-plan "query about AOSP code"
/zaku:aosp-plan --agents 5 "query"
```

## Flags

- `--agents N`: Number of parallel investigator subagents (default: 3, max: 5)
- `--deliberate`: Force deliberate mode for high-risk AOSP changes. Adds pre-mortem and expanded test planning. Auto-enables for SELinux policy, Binder/AIDL/HIDL interfaces, CTS/VTS tests, public/@SystemApi changes, init/boot sequence, Treble boundaries, kernel/DT changes, or multi-partition modifications.
- `--interactive`: Enable user prompts at synthesis review and final approval. Without this flag, save the final pending-approval plan and stop.

## Planning / Execution Boundary

This skill may inspect context, query AOSP source, and write pending-approval plan artifacts. Before explicit execution approval, it MUST NOT edit source code, commit, push, open PRs, or invoke execution skills. Consensus approval means the plan is suitable to present; it is not runtime execution authorization.

## Protocol

### Step 0: State Initialization

Call `Write {"active": true}` to `.granada/aosp-plan-state.json` before any other action.

### Step 1: MCP Health Check

Call `mcp__plugin_zaku_sourcepilot__list_projects()` once at startup to verify the MCP server is reachable.

If the call fails, call `Bash: rm -f .granada/aosp-plan-state.json` and abort immediately with:

```
AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.
```

After health check passes, read `.granada/aosp-config.json` to display the active AOSP project:
- If configured: display `**AOSP Project: <project_name>**` prominently
- If not configured: display `**未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

### Step 2: Facet Decomposition

Given the user query, decompose into 2-N independent investigation facets. Each facet targets a different aspect of the AOSP codebase. Show the decomposition to the user:

```markdown
## AOSP Investigation Decomposition

**Query:** <original query>

### Facet 1: <facet-name>
- **Search focus:** What to search for in AOSP
- **Expected areas:** Framework, HAL, kernel, etc.

### Facet 2: <facet-name>
- **Search focus:** ...
- **Expected areas:** ...
```

### Step 3: Spawn Investigators

Fire N `aosp-investigator` subagents in parallel, one per facet. N comes from `--agents` (default 3, max 5):

```text
Agent(
  subagent_type="zaku:aosp-investigator",
  model="sonnet",
  prompt="Investigate AOSP facet: <facet description>. Use the sourcepilot tools. Report structured findings with file paths, code snippets, and architectural observations."
)
```

Cap at 5 agents regardless of `--agents` value.

### Step 4: Synthesis

Merge all investigation results:

- Deduplicate overlapping findings across investigators
- Resolve conflicts between investigators, preferring AOSP source-based evidence
- Rank findings by relevance and evidence strength
- Note gaps where investigation was inconclusive or returned no results

### Step 4.5: Synthesis Review (--interactive only)

If running with `--interactive`, use `AskUserQuestion` to present synthesis results with these options:
- **Proceed to consensus planning phase** (Recommended) — generate the structured plan through Planner -> Architect -> Critic consensus
- **Request additional investigation** — spawn more investigators for identified gaps
- **Refine scope** — narrow or broaden the investigation, return to Step 2

If not running with `--interactive`, automatically proceed to Step 5.

### Step 5: Planner -> Architect -> Critic Consensus Phase

After synthesis, always run a sequential zaku-native consensus phase before saving the final plan. This phase runs automatically in both interactive and non-interactive modes; it is not an execution approval gate.

Build an **AOSP evidence bundle** and pass it to every consensus agent. The bundle MUST include:
- Original query and flags
- Active AOSP project/config state
- Deliberate-mode trigger and reason, if applicable
- Facet decomposition
- All `zaku:aosp-investigator` outputs with facet labels
- Synthesis findings, conflicts, gaps, and confidence notes
- Step 4.5 user feedback, if any
- Current iteration number
- Previous plan markdown, if any
- Previous `ARCHITECT_REVIEW`, if any
- Previous Critic verdict and feedback, if any

Previous fields are empty on iteration 1. Do not allow consensus agents to invent uncited AOSP facts.

#### Step 5a: Planner draft/revision

Call Planner first:

```text
Agent(
  subagent_type="zaku:aosp-planner",
  model="opus",
  prompt="<AOSP evidence bundle + current iteration feedback>"
)
```

Planner MUST create or revise the draft AOSP plan with this structure:

```markdown
# AOSP Plan: <query>
**Status:** pending approval

## Investigation Summary
[Key findings from all investigators, grouped by facet]

## AOSP-DR: Decision Rationale
### Principles (3-5)
### Decision Drivers (top 3)
### Viable Options (>=2, or explicit invalidation rationale)
### Selected Option: [A/B]
### Invalidated Alternatives (if < 2 viable options)

## Evidence-Based Plan
### Step 1: <action>
- **Evidence:** [which investigation findings support this step]
- **AOSP files:** [relevant AOSP source files]
- **Acceptance criteria:** [how to verify this step is complete]

## Risks and Mitigations
## Open Questions
## Sources
## Architecture Decision Record
- **Decision:** [What was decided]
- **Drivers:** [Top 3 drivers from AOSP-DR]
- **Alternatives considered:** [All evaluated options]
- **Why chosen:** [Reasoning referencing principles and drivers]
- **Consequences:** [Positive outcomes + accepted tradeoffs + acknowledged risks]
- **Follow-ups:** [Post-implementation verification actions]

## Consensus Review Changelog
- **Iteration:** [number]
- **Architect summary:** [blocking/advisory summary]
- **Critic verdict:** [APPROVE/ITERATE/REJECT or malformed-output note]
- **Required revisions applied:** [changes made]
- **Unresolved blockers:** [remaining blockers, if any]
```

In deliberate mode, additionally include:

```markdown
## Pre-Mortem (Deliberate Mode)
1. [AOSP-specific failure scenario]
2. [AOSP-specific failure scenario]
3. [AOSP-specific failure scenario]

## Expanded Test Plan (Deliberate Mode)
| Layer | Tests |
|-------|-------|
| Unit | [Framework JUnit / native gtest] |
| Integration | [CTS module / instrumentation tests] |
| E2E | [Full device boot / VTS for HAL] |
| Observability | [Logcat / dumpsys / perfetto] |
```

#### Step 5b: Architect review

Call Architect only after Planner returns the draft plan:

```text
Agent(
  subagent_type="zaku:aosp-architect",
  model="opus",
  prompt="<draft AOSP plan markdown + AOSP evidence bundle>"
)
```

Architect MUST return a structured `ARCHITECT_REVIEW` containing:
- Blocking concerns
- Required changes
- Advisory changes
- Strongest antithesis
- Tradeoff tensions
- Approval recommendation

Malformed or incomplete Architect output is a blocking concern and forces Critic non-approval unless corrected in a later iteration.

#### Step 5c: Critic verdict

Call Critic only after Architect returns:

```text
Agent(
  subagent_type="zaku:aosp-critic",
  model="opus",
  prompt="<draft AOSP plan markdown + AOSP evidence bundle + ARCHITECT_REVIEW>"
)
```

Critic MUST include exactly one closed verdict line:

```text
VERDICT: APPROVE
```

or

```text
VERDICT: ITERATE
```

or

```text
VERDICT: REJECT
```

No verdict, multiple verdicts, synonyms, conditional verdicts, or ambiguous wording MUST be treated as `VERDICT: ITERATE`. Malformed Critic output must be recorded in the Consensus Review Changelog as non-compliant/malformed.

#### Step 5d: Consensus loop

The consensus loop is capped at 5 iterations:
1. Planner creates or revises the draft plan from the evidence bundle.
2. Architect reviews the draft and returns `ARCHITECT_REVIEW`.
3. Critic evaluates the draft and returns exactly one `VERDICT`.
4. Only `VERDICT: APPROVE` exits the loop.
5. `VERDICT: ITERATE`, `VERDICT: REJECT`, missing verdict, malformed verdict, or ambiguous verdict means Planner MUST revise the plan using Architect and Critic feedback, add a Consensus Review Changelog entry, then rerun Architect and Critic.
6. If 5 iterations complete without approval, save the best available version with unresolved blockers clearly listed. The saved plan remains `**Status:** pending approval`.

`VERDICT: REJECT` is non-terminal inside the Step 5 consensus loop. Step 7 user rejection remains terminal.

#### Step 5e: Quality criteria

Critic MUST reject or iterate on:
- Fewer than 80% of plan steps cite AOSP source files from investigation results
- Fewer than 90% of acceptance criteria reference verifiable outcomes such as CTS, VTS, build, adb, dumpsys, or logcat
- Steps not backed by investigation evidence
- Subsystem boundary crossings without acknowledgment
- @hide/@SystemApi stability risks not flagged where relevant
- Missing build system references for code-modifying steps
- Open Questions section hiding investigation gaps
- Uncited AOSP file references
- Selected option that conflicts with stated principles or drivers
- Missing or unfair alternatives without explicit invalidation rationale
- Risks without concrete mitigation or verification path

### Step 6: Save

Before saving, assert the plan contains exactly one `**Status:** pending approval`, and it is the first body line after the title. All saved plans MUST remain pending approval.

Derive a slug from the query: lowercase, spaces to hyphens, strip special chars. Save to:

```
.granada/plans/aosp-<slug>.md
```

Confirm the save path to the user after writing.

If not running with `--interactive`, call `Bash: rm -f .granada/aosp-plan-state.json` after confirming the save path. The skill stops here and never invokes execution skills.

### Step 7: Execution Approval (--interactive only)

Use `AskUserQuestion` to present the saved plan with these options:
- **Approve and execute via aosp-autopilot** (Recommended) — proceed to implementation via zaku multi-repo executor
- **Request changes** — return to Step 5 with user feedback
- **Reject** — discard plan, call `Bash: rm -f .granada/aosp-plan-state.json`, stop

On approval: Call `Write {"active": false}` to `.granada/aosp-plan-state.json` before invoking `Skill("zaku:aosp-autopilot")` with the plan path.

## Risk-Adaptive Mode

AOSP-DR uses short mode by default. Switch to deliberate mode with `--deliberate` or when the query involves any high-risk areas:

- SELinux policy changes
- Binder/AIDL/HIDL interface modifications
- CTS or VTS test changes
- Public API or @SystemApi modifications
- Init/boot sequence changes
- Treble vendor/system boundary crossings
- Kernel driver or device tree changes
- Multi-partition changes

## State Lifecycle

- On entry: `Write {"active": true}` to `.granada/aosp-plan-state.json`
- On MCP failure: `Bash: rm -f .granada/aosp-plan-state.json`
- On non-interactive completion: `Bash: rm -f .granada/aosp-plan-state.json`
- On execution handoff: `Write {"active": false}` to `.granada/aosp-plan-state.json`
- On rejection: `Bash: rm -f .granada/aosp-plan-state.json`

Never use `rm -f .granada/*-state.json` before launching an execution mode.

## Configuration

- Maximum 5 parallel `aosp-investigator` agents
- Keyword trigger: `"aosp plan"` or `"aosp_plan"`
- State file: `.granada/aosp-plan-state.json`
- Non-interactive mode: outputs plan and stops after Step 6
- Interactive mode: adds synthesis review and execution approval gates

## Tool Usage

- Use `Agent(subagent_type="zaku:aosp-investigator", model="sonnet", ...)` for parallel investigation.
- Use `Agent(subagent_type="zaku:aosp-planner", model="opus", ...)` for Planner draft/revision.
- Use `Agent(subagent_type="zaku:aosp-architect", model="opus", ...)` for Architect review.
- Use `Agent(subagent_type="zaku:aosp-critic", model="opus", ...)` for Critic evaluation.
- Planner, Architect, and Critic MUST run sequentially: Planner -> Architect -> Critic. Never run consensus agents in parallel.
- All three consensus agents MUST receive the AOSP evidence bundle.
- Critic MUST use the closed verdict contract: exactly one of `VERDICT: APPROVE`, `VERDICT: ITERATE`, or `VERDICT: REJECT`.
- Missing, malformed, multiple, conditional, or ambiguous Critic verdicts MUST be treated as `VERDICT: ITERATE` and recorded in the Consensus Review Changelog.
