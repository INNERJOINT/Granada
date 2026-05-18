---
name: aosp-plan
description: AOSP investigation-driven planning with parallel code search
argument-hint: <AOSP investigation query>
pipeline: [aosp-plan, ralph]
next-skill: ralph
handoff: .plugin-state/plans/aosp-*.md
level: 4
---

# AOSP Plan Skill

Investigation-first AOSP planning. Decomposes queries into facets, spawns parallel `aosp-investigator` subagents, synthesizes all findings, and produces an evidence-backed plan saved to `.plugin-state/plans/`.

## Usage

```
/zaku:aosp-plan "query about AOSP code"
/zaku:aosp-plan --agents 5 "query"
```

## Flags

- `--agents N`: Number of parallel investigator subagents (default: 3, max: 5)
- `--deliberate`: Force deliberate mode for high-risk AOSP changes. Adds pre-mortem (3 failure scenarios) and expanded test plan. Auto-enables when query involves: SELinux policy, Binder/AIDL interfaces, CTS/VTS tests, public/@SystemApi changes, init/boot sequence, Treble boundaries, kernel/DT changes, or multi-partition modifications.
- `--interactive`: Enable user prompts at synthesis review and final approval. Without this flag, the workflow outputs the final plan and stops (no auto-execution).

## Protocol

### Step 0: State Initialization

Call `Write {"active": true} to .plugin-state/aosp-plan-state.json` before any other action. This enables stop-hook enforcement during parallel investigation.

### Step 1: MCP Health Check

Call `sourcepilot` with `tool: "list_tools"` once at startup to verify the MCP server is reachable and discover available remote tool names.

If the call fails, call `Bash: rm -f .plugin-state/aosp-plan-state.json` and abort immediately with:

```
AOSP MCP server unreachable. Check AOSP_MCP_URL and AOSP_MCP_KEY environment variables.
```

Do NOT proceed to spawn agents if this check fails.

After health check passes, read `.plugin-state/aosp-config.json` to display the active AOSP project:
- If configured: display `**🔍 AOSP Project: <project_name>**` prominently
- If not configured: display `**⚠ 未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

(The `aosp-investigator` subagent reads this config and passes `project` to search calls automatically.)

### Step 2: Facet Decomposition

Given the user query, decompose into 2–N independent investigation facets. Each facet targets a different aspect of the AOSP codebase. Show the decomposition to the user:

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

Fire N `aosp-investigator` subagents in parallel (one per facet). N comes from `--agents` (default 3, max 5):

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="sonnet",
  prompt="Investigate AOSP facet: <facet description>. Use sourcepilot tool. Report structured findings with file paths, code snippets, and architectural observations."
)
```

Cap at 5 agents regardless of `--agents` value.

### Step 4: Synthesis

Merge all investigation results:

- Deduplicate overlapping findings across investigators
- Resolve conflicts between investigators (prefer AOSP source-based evidence)
- Rank findings by relevance and evidence strength
- Note gaps where investigation was inconclusive or returned no results

### Step 4.5: Synthesis Review (--interactive only)

If running with `--interactive`, use `AskUserQuestion` to present the synthesis results with these options:
- **Proceed to plan generation** (Recommended) — generate the structured plan
- **Request additional investigation** — spawn more investigators for identified gaps
- **Refine scope** — narrow or broaden the investigation, return to Step 2

If NOT running with `--interactive`, automatically proceed to Step 5.

### Step 5: Plan Generation

Generate a structured plan based on investigation evidence. The plan MUST include an AOSP-DR (Decision Rationale) section that articulates explicit reasoning, not just steps.

```markdown
# AOSP Plan: <query>

## Investigation Summary

[Key findings from all investigators, grouped by facet]

## AOSP-DR: Decision Rationale

### Principles (3-5)
1. [AOSP-grounded principle, e.g., "Respect AOSP layer boundaries"]
2. [Compatibility principle, e.g., "Maintain CTS/VTS test compatibility"]
3. [Investigation-derived principle]

### Decision Drivers (top 3)
1. [Most important factor, with evidence reference]
2. [Second factor]
3. [Third factor]

### Viable Options (>=2, or explicit invalidation rationale)
#### Option A: [Name]
- **Approach:** [1-2 sentences]
- **Evidence:** [Investigation findings supporting this]
- **AOSP files:** [Key source files]
- **Pros:** [Bounded, evidence-grounded]
- **Cons:** [Bounded, evidence-grounded]

#### Option B: [Name]
- **Approach:** [1-2 sentences]
- **Evidence:** [Investigation findings supporting this]
- **AOSP files:** [Key source files]
- **Pros:** [Bounded, evidence-grounded]
- **Cons:** [Bounded, evidence-grounded]

### Selected Option: [A/B]
**Why:** [Reasoning referencing drivers and principles]

### Invalidated Alternatives (if < 2 viable options)
- [Option C]: [Why invalidated — e.g., "Requires @hide API deprecated in API level 34"]

## Evidence-Based Plan

### Step 1: <action>
- **Evidence:** [which investigation findings support this step]
- **AOSP files:** [relevant AOSP source files]
- **Acceptance criteria:** [how to verify this step is complete]

### Step 2: <action>
- **Evidence:** ...
- **AOSP files:** ...
- **Acceptance criteria:** ...

## Risks and Mitigations

- **Risk:** [AOSP-specific risk] → **Mitigation:** [concrete action]
- **Risk:** [AOSP-specific risk] → **Mitigation:** [concrete action]

## Open Questions

[Items where investigation was inconclusive or returned no results — flag for further investigation]

## Sources

[All AOSP file paths and references cited across all investigator results]
```

In **deliberate mode** (triggered by `--deliberate` or auto-detected high-risk signals), additionally include after Sources:

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

### Step 5.5: Quality Gate — Architect + Critic Review

Review the generated plan for AOSP-specific quality. This step runs automatically (not gated by `--interactive`).

**Sequential enforcement**: Architect MUST complete before Critic starts. Do NOT run both in parallel.

**a. Architect review** via `Agent(subagent_type="zaku:architect", ...)`:

Review focus:
- Architectural soundness of proposed AOSP modifications
- Subsystem ownership correctness (Framework, HAL, Kernel, etc.)
- Treble/HIDL boundary compliance
- Cross-layer impact (e.g., Framework change requiring SELinux update)
- AOSP version consistency across cited source files
- Steelman antithesis: strongest argument against the proposed approach
- At least one meaningful tradeoff tension

Wait for Architect completion before proceeding to Critic.

**b. Critic evaluation** via `Agent(subagent_type="zaku:critic", ...)`:

Quality criteria:
- 80%+ plan steps cite AOSP source files from investigation results
- 90%+ acceptance criteria reference verifiable outcomes (CTS, VTS, build, adb)
- Each step backed by investigation evidence (no unsupported claims)
- Subsystem boundaries acknowledged at crossing points
- @hide/@SystemApi stability risks explicitly flagged
- Build system references (Android.bp/mk) included for code-modifying steps
- Open Questions section honestly reflects investigation gaps

Critic MUST reject: uncited AOSP file references, unverifiable acceptance criteria, missing @hide API risk flags, mixed AOSP version references without acknowledgment.

**c. Re-review loop** (max 3 iterations):
If Critic rejects: collect feedback → revise plan (re-run Step 5) → Architect → Critic → repeat.
If 3 iterations reached without approval: present best version to user via `AskUserQuestion`.

**d. Apply improvements**:
On approval with suggestions: deduplicate, merge into plan, add changelog section.
Final plan output MUST include an **Architecture Decision Record** section appended after Sources:

```markdown
## Architecture Decision Record
- **Decision:** [What was decided]
- **Drivers:** [Top 3 drivers from AOSP-DR]
- **Alternatives considered:** [All evaluated options]
- **Why chosen:** [Reasoning referencing principles and drivers]
- **Consequences:** [Positive outcomes + accepted tradeoffs + acknowledged risks]
- **Follow-ups:** [Post-implementation verification actions]
```

### Step 6: Save

Derive a slug from the query (lowercase, spaces→hyphens, strip special chars). Save to:

```
.plugin-state/plans/aosp-<slug>.md
```

Confirm the save path to the user after writing.

If NOT running with `--interactive`, call `Bash: rm -f .plugin-state/aosp-plan-state.json` after confirming the save path. The skill stops here in non-interactive mode.

### Step 7: Execution Approval (--interactive only)

Use `AskUserQuestion` to present the saved plan with these options:
- **Approve and implement via team** (Recommended) — proceed to implementation via coordinated parallel team agents
- **Approve and execute via ralph** — proceed to implementation via ralph sequential execution
- **Clear context and implement** — compact context first, then ralph (recommended when context is large after investigation)
- **Request changes** — return to Step 5 with user feedback
- **Reject** — discard plan, call `Bash: rm -f .plugin-state/aosp-plan-state.json`, stop

On approval: Call `Write {"active": false} to .plugin-state/aosp-plan-state.json` before invoking the execution skill. Do NOT use `rm -f .plugin-state/*-state.json` — its cancel signal disables stop-hook enforcement for the newly launched mode.

- **Approve and implement via team**: Invoke `Skill("zaku:team")` with the plan path
- **Approve and execute via ralph**: Invoke `Skill("zaku:ralph")` with the plan path
- **Clear context and implement**: `Write JSON with active=false)` → `Skill("compact")` → `Skill("zaku:ralph")` with plan path

## Risk-Adaptive Mode

AOSP-DR uses **short mode** by default (Principles + Drivers + Options only). Switch to **deliberate mode** with `--deliberate` or when the query involves any of these high-risk areas:

- SELinux policy changes (neverallow, sepolicy, *.te files)
- Binder/AIDL/HIDL interface modifications
- CTS or VTS test changes
- Public API or @SystemApi modifications
- Init/boot sequence changes (init.rc, early boot services)
- Treble vendor/system boundary crossings
- Kernel driver or device tree changes
- Multi-partition changes (system + vendor + product)

Deliberate mode adds:
- **Pre-mortem**: 3 AOSP-specific failure scenarios
- **Expanded test plan**: Unit / Integration (CTS) / E2E (VTS/device) / Observability (logcat/dumpsys/perfetto)

## State Lifecycle

The stop hook uses `aosp-plan` state to enforce continuation during parallel investigation. The skill MUST manage this state:

- **On entry**: `Write {"active": true} to .plugin-state/aosp-plan-state.json` before Step 1
- **On MCP failure**: `Bash: rm -f .plugin-state/aosp-plan-state.json` — terminal exit
- **On non-interactive completion** (Step 6): `Bash: rm -f .plugin-state/aosp-plan-state.json` — plan output only, no execution follows
- **On execution handoff** (Step 7 approval): `Write {"active": false} to .plugin-state/aosp-plan-state.json` — preserves stop-hook enforcement for the execution mode
- **On rejection** (Step 7 reject): `Bash: rm -f .plugin-state/aosp-plan-state.json` — terminal exit

Critical: Never use `rm -f .plugin-state/*-state.json` before launching an execution mode. The 30-second cancel signal disables stop-hook enforcement for ALL modes.

## Configuration

- Maximum 5 parallel `aosp-investigator` agents (matches `external-context` precedent)
- Keyword trigger: `"aosp plan"` or `"aosp_plan"`
- State file: `.plugin-state/aosp-plan-state.json` (Write/Read/rm)
- Non-interactive mode (default): outputs plan and stops after Step 6
- Interactive mode (`--interactive`): adds synthesis review (Step 4.5) and execution approval (Step 7) gates

## Tool Usage

- Use `Agent(subagent_type="zaku:architect", ...)` for Architect review in Step 5.5a
- Use `Agent(subagent_type="zaku:critic", ...)` for Critic evaluation in Step 5.5b
- **CRITICAL**: Architect and Critic calls MUST be sequential, never parallel. Always await the Architect result before issuing the Critic call.
- Quality gate runs automatically on all plans (not gated by `--interactive`)
- Re-review loop capped at 3 iterations (narrower scope than general plans)
