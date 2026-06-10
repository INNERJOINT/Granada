---
description: AOSP investigation-driven planning with consensus review
argument-hint: <AOSP investigation query>
model: opus
artifacts-dirs: [.granada/plans]
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


### Step 1: MCP Health Check

Call `mcp__plugin_zaku_sourcepilot__list_projects()` once at startup to verify the MCP server is reachable.

If the call fails, abort immediately with:

```
AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.
```

After health check passes, read `.granada/aosp-config.json` to display the active AOSP project:
- If configured: display `**AOSP Project: <project_name>**` prominently
- If not configured: display `**AOSP Project: not configured** — Searches will not be project-scoped. Run /zaku:aosp-project to configure one.`

### Step 2: Facet Decomposition

Given the user query, decompose into 2-N independent investigation facets. Each facet targets a different aspect of the AOSP codebase.

Use this AOSP-oriented facet taxonomy by default, then prune facets that are clearly irrelevant and merge facets when the query is narrow:

1. **Entrypoints and call flow** — public APIs, callbacks, broadcasts, system service entrypoints, command paths, or lifecycle triggers.
2. **Owning service / manager logic** — framework service, manager, controller, policy, state machine, or native daemon that owns the behavior.
3. **Boundary crossings** — Binder/AIDL/HIDL, JNI, native service, HAL, vendor/system, Treble, kernel, or device tree boundaries.
4. **Configuration and build surface** — resources, overlays, properties, XML config, init rc, Soong/Make files, sepolicy, feature flags, permissions.
5. **Tests and observability** — CTS/VTS/unit tests, instrumentation, dumpsys, stats/logcat, perfetto, bugreport evidence points.
6. **Compatibility and risk surface** — @SystemApi/@hide, compatibility behavior, migration concerns, multi-user, multi-display, boot/upgrade interactions.

Rules:
- Always include entrypoint/call-flow and owning-service facets unless the query is purely about build/config/test files.
- Include boundary-crossing and configuration facets when the query touches HAL, vendor, boot, permissions, SELinux, resources, properties, or multi-partition behavior.
- Include tests/observability for all implementation plans, even if the search focus is lightweight.
- Prefer 3 facets for normal mode, up to 5 with `--agents 5`, and include all relevant high-risk facets in `--deliberate` mode.
- If a default facet is pruned, record the reason so reviewers know it was considered.

Show the decomposition to the user:

```markdown
## AOSP Investigation Decomposition

**Query:** <original query>
**Facet strategy:** <normal/deliberate/pruned>

### Facet 1: <facet-name>
- **Taxonomy:** Entrypoints and call flow / Owning service / Boundary crossings / Configuration / Tests / Compatibility
- **Search focus:** What to search for in AOSP
- **Expected areas:** Framework, HAL, kernel, tests, sepolicy, build, etc.
- **Why included:** Why this facet matters for the query

### Facet 2: <facet-name>
- **Taxonomy:** ...
- **Search focus:** ...
- **Expected areas:** ...
- **Why included:** ...

### Pruned facets
- **<facet-name>:** <why it is not relevant or was merged>
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

After synthesis, build and save an **Evidence Artifact** containing the full investigation context plus a compact **Evidence Index**. Each cited AOSP fact that may influence planning gets a stable ID.

Derive the final artifact slug once before saving evidence, then reuse that exact slug in Step 6 for the final plan:
- Lowercase the query, convert whitespace runs to `-`, strip characters outside `a-z`, `0-9`, and `-`, collapse repeated `-`, and trim leading/trailing `-`.
- Limit the slug body to 64 characters after normalization.
- If normalization produces an empty slug, use `plan`.
- If either `.granada/plans/aosp-<slug>.md` or `.granada/plans/aosp-<slug>-evidence.md` already exists, append `-2`, `-3`, etc. until both paths are free.
- The evidence artifact, consensus packet, final plan path, and final summary MUST all use this resolved slug; do not recompute it later.

Save the artifact before consensus to:

```text
.granada/plans/aosp-<resolved-slug>-evidence.md
```

The evidence artifact MUST use this structure:

```markdown
# AOSP Evidence: <query>

## Original Query and Flags
## Active AOSP Project
## Deliberate Mode
## Investigation Decomposition
## Investigator Outputs
## Synthesis
### Findings
### Conflicts
### Gaps
### Confidence Notes
## Evidence Index
[E1] <repo>/<path/to/File.java> — type: source|test|config|log|assumption — strength: direct|indirect|weak — facet: entrypoint|owner|boundary|config|tests|risk — <symbol or area> — <one-sentence finding>
[E2] <repo>/<path/to/File.bp> — type: source|test|config|log|assumption — strength: direct|indirect|weak — facet: entrypoint|owner|boundary|config|tests|risk — <build/test relevance> — <one-sentence finding>
## Interactive Feedback
```

Rules:
- Evidence IDs are stable within the plan run and MUST NOT be reused for different facts.
- Every Evidence Index entry must trace back to an investigator result or direct sourcepilot file read in the same artifact.
- Every Evidence Index entry MUST include `type`, `strength`, and `facet` metadata.
- `type` describes the evidence surface: `source`, `test`, `config`, `log`, or `assumption`.
- `strength` describes how directly the evidence supports the planning claim: `direct`, `indirect`, or `weak`.
- `facet` maps the evidence to the investigation taxonomy: `entrypoint`, `owner`, `boundary`, `config`, `tests`, or `risk`.
- Planner, Architect, and Critic MUST read the evidence artifact and cite `E#` IDs in plan steps, risk analysis, and review findings instead of repeating long snippets.
- Every code-modifying plan step MUST cite at least one Evidence Index entry with `type: source` and `strength: direct`.
- `test` or `config` evidence can support verification/build/config work, but MUST NOT be the only evidence for source-code modification steps.
- `weak` evidence can only support exploratory, verification, or follow-up steps unless paired with direct source evidence.
- `assumption` entries MUST be routed to `## Open Questions` or non-executing follow-ups; they MUST NOT support executor instructions or code-modifying steps.
- Consensus agent prompts should pass the evidence artifact path plus a compact summary, not the full investigator output inline.
- The final `## Sources` section must expand each cited `E#` to the full repo/path, metadata, and relevant snippet summary.

### Step 4.5: Risk Scoring and Deliberate Mode Auto-Trigger

After evidence artifact is saved, calculate risk score from evidence and query context:

**Risk Factors Analysis** (extract from Evidence Index + query text):
- **Code impact scope** (0-50 points):
  - Single file modification: +10
  - Cross-module modification: +30
  - Cross-process boundary (Binder/AIDL/HIDL/IPC): +50
- **Stability risks** (0-50 points, capped at 50):
  - @SystemApi modification: +40
  - SELinux policy change: +30
  - Boot sequence modification: +50
  - Binder interface: +35
  - AIDL interface: +35
  - HIDL interface: +35
  - Treble boundary crossing: +40
  - Public API modification: +45
  - Multi-partition changes: +35
  - Kernel/DT modification: +50
  - Multi-user impact: +20
  - Multi-display impact: +20
- **Test coverage gaps** (0-30 points, capped at 30):
  - Missing unit tests: +20
  - Missing CTS coverage: +30
  - Missing VTS coverage: +25

**Risk Score Thresholds**:
- Total >= 70: **Force deliberate mode** (override `--deliberate` flag)
- Total 50-69: **Suggest deliberate mode** (log recommendation, proceed with current mode)
- Total < 50: **Short mode** (default)

**Display risk assessment**:
```markdown
## Risk Assessment
**Total Score:** [X/100]
**Recommendation:** [short / suggest-deliberate / force-deliberate]

**Breakdown:**
- Code Impact: [X/50]
- Stability: [X/50]
- Test Coverage: [X/30]

**Triggered Factors:**
- [Factor 1]
- [Factor 2]
...

**Mode Decision:** [Proceeding with SHORT mode / DELIBERATE mode auto-triggered]
```

If deliberate mode is force-triggered, update the consensus packet with:
- `Deliberate mode: auto-triggered by risk score [X/100]`
- `Triggered factors: [list]`

### Step 4.6: Synthesis Review (--interactive only)

If running with `--interactive`, use `AskUserQuestion` to present synthesis results with these options:
- **Proceed to consensus planning phase** (Recommended) — generate the structured plan through Planner -> Architect -> Critic consensus
- **Request additional investigation** — spawn more investigators for identified gaps
- **Refine scope** — narrow or broaden the investigation, return to Step 2

If not running with `--interactive`, automatically proceed to Step 5.

### Step 5: Planner -> Architect -> Critic Consensus Phase

After synthesis, always run a sequential zaku-native consensus phase before saving the final plan. This phase runs automatically in both interactive and non-interactive modes; it is not an execution approval gate.

Build a compact **AOSP consensus packet** and pass it to every consensus agent. The packet MUST include:
- Evidence artifact path: `.granada/plans/aosp-<slug>-evidence.md`
- Original query and flags
- Active AOSP project/config state
- Risk score and auto-triggered deliberate mode status (if applicable)
- Deliberate-mode trigger and reason (explicit `--deliberate` or auto-triggered)
- Short synthesis summary, conflicts, gaps, and confidence notes
- Evidence Index summary with stable `E#` IDs, source mappings, and `type`/`strength`/`facet` metadata
- Step 4.6 user feedback, if any
- Current iteration number
- Convergence history: array of iteration snapshots with plan hash, feedback, evidence IDs, and verdict
- Previous plan markdown, if any
- Previous `ARCHITECT_REVIEW`, if any
- Previous Critic verdict and feedback, if any

The full investigator outputs MUST live in the evidence artifact, not be repeated inline in every consensus prompt. Previous fields are empty on iteration 1.

Consensus evidence scope:
- Planner, Architect, and Critic MUST treat the evidence artifact as the closed source of AOSP facts during Step 5.
- Consensus agents MUST NOT run sourcepilot searches, spawn aosp-investigator, or introduce new uncited AOSP facts during Step 5.
- If a consensus agent finds missing, weak, contradictory, or stale evidence, it MUST mark the affected item as an evidence gap and request additional investigation instead of filling the gap itself.
- Additional investigation is handled by returning to Step 2/3, updating the evidence artifact with new investigator output and new Evidence Index IDs, then restarting or continuing consensus with the updated artifact.
- Local file reads are allowed only for reading the evidence artifact, draft plan, and local zaku skill/agent instructions; they are not a substitute for new AOSP evidence.

#### Step 5a: Planner draft/revision

Call Planner first:

```text
Agent(
  subagent_type="zaku:aosp-planner",
  model="opus",
  prompt="<AOSP consensus packet with evidence artifact path + current iteration feedback>"
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
- **Repo:** `<repo path, e.g. frameworks/base>`
- **Change type:** source|test|config|build|sepolicy|docs|verification
- **Dependencies:** [Step IDs or repo paths that must land first; `none` if independent]
- **Evidence:** [Evidence Index IDs, e.g. E1, E3; code-modifying steps require at least one `type: source`, `strength: direct` ID]
- **AOSP files:** [repo-relative or AOSP-root-relative files; must be specific enough for aosp-autopilot to group by repo]
- **Executor instructions:** [concrete modification guidance for the executor; no assumptions or unresolved questions]
- **Acceptance criteria:** [how to verify this step is complete]
- **Verification:** [specific build/test/runtime command or observable outcome, e.g. CTS, VTS, m, adb, dumpsys, logcat]

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
  prompt="<draft AOSP plan markdown + AOSP consensus packet>"
)
```

Architect MUST return a structured `ARCHITECT_REVIEW` containing:
- Blocking concerns
- Required changes
- Advisory changes
- Evidence gaps requiring additional investigation
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
  prompt="<draft AOSP plan markdown + AOSP consensus packet + ARCHITECT_REVIEW>"
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

#### Step 5d: Consensus loop with convergence detection

The consensus loop is capped at 5 iterations with intelligent early termination:
1. Planner creates or revises the draft plan from the consensus packet and referenced evidence artifact.
2. Architect reviews the draft and returns `ARCHITECT_REVIEW`.
3. Critic evaluates the draft and returns exactly one `VERDICT`.
4. **Convergence check** (after iteration 2+): Analyze iteration history using convergence detection logic:
   - **Plan similarity**: Compare current plan hash to previous iteration (text similarity)
   - **Feedback similarity**: Compare Architect + Critic feedback to previous iteration
   - **Evidence stability**: Percentage of overlapping Evidence Index IDs between iterations
   - **Oscillation detection**: Check if current iteration is similar to iteration N-2 but different from N-1 (stuck in loop)
5. **Early termination conditions**:
   - `VERDICT: APPROVE` → Exit immediately
   - Converged (plan similarity > 95%, feedback similarity > 80%, evidence overlap > 90%) + `APPROVE` → Exit with success message
   - Oscillating (current similar to N-2, different from N-1) after 3+ iterations → Escalate to user with "Loop is stuck, recommend human review"
   - Converged but not approved after iteration 3+ → Log convergence in changelog, continue (quality issues remain)
6. `VERDICT: ITERATE`, `VERDICT: REJECT`, missing verdict, malformed verdict, or ambiguous verdict means Planner MUST revise the plan using Architect and Critic feedback, add a Consensus Review Changelog entry including convergence metrics, then rerun Architect and Critic.
7. If Architect or Critic reports evidence gaps requiring additional investigation, pause the consensus loop, return to Step 2/3 for targeted investigation, update the evidence artifact with new Evidence Index IDs, then resume consensus with the updated artifact.
8. If 5 iterations complete without approval, save the best available version with unresolved blockers clearly listed. The saved plan remains `**Status:** pending approval`.

**Convergence metrics to log in changelog each iteration**:
- Plan change percentage vs. previous iteration
- Feedback similarity percentage
- Evidence Index overlap percentage
- Oscillation warning if detected

`VERDICT: REJECT` is non-terminal inside the Step 5 consensus loop. Step 7 user rejection remains terminal.

#### Step 5e: Quality criteria

Critic MUST reject or iterate on:
- Any Evidence-Based Plan step missing `Repo`, `Change type`, `Dependencies`, `Evidence`, `AOSP files`, `Executor instructions`, `Acceptance criteria`, or `Verification`
- Fewer than 80% of plan steps cite Evidence Index IDs backed by AOSP source files from investigation results
- Any code-modifying step without at least one Evidence Index ID marked `type: source` and `strength: direct`
- Any source-code modification step backed only by `test`, `config`, `log`, `weak`, or `assumption` evidence
- Any executor instruction supported by an `assumption` Evidence Index entry
- Fewer than 90% of acceptance criteria reference verifiable outcomes such as CTS, VTS, build, adb, dumpsys, or logcat
- Steps not backed by investigation evidence
- Consensus review that introduces source-backed AOSP claims not present in the evidence artifact
- Evidence gaps handled by ad hoc Architect/Critic searches instead of returning to targeted investigation
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

Use the resolved slug from Step 4. Do not recompute, shorten, or renumber it during save. Save to:

```
.granada/plans/aosp-<resolved-slug>.md
```

Before writing, verify that the plan path still does not exist. If it now exists because of a concurrent run, return to Step 4 slug collision handling, choose the next available numeric suffix, rename/rewrite the evidence artifact to match, and update the consensus packet/final summary paths.

Confirm the save path to the user after writing.

If not running with `--interactive`, print a compact final summary before stopping:

```markdown
## AOSP Plan Complete
- **Plan:** `.granada/plans/aosp-<slug>.md`
- **Evidence:** `.granada/plans/aosp-<slug>-evidence.md`
- **Consensus verdict:** APPROVE | best available after 5 iterations | unresolved blockers present
- **Selected option:** <option from AOSP-DR>
- **Top risks:** <1-3 highest-impact risks or `none identified`>
- **Next step:** Review the pending-approval plan, then run `/zaku:aosp-autopilot .granada/plans/aosp-<slug>.md` only if you approve execution.
```

If not running with `--interactive`, the skill stops here after printing the summary and never invokes execution skills.

### Step 7: Execution Approval (--interactive only)

Use `AskUserQuestion` to present the saved plan with these options:
- **Approve and execute via aosp-autopilot** (Recommended) — proceed to implementation via zaku multi-repo executor
- **Request changes** — return to Step 5 with user feedback
- **Reject** — discard plan and stop

On approval: invoke `Skill("zaku:aosp-autopilot")` with the plan path.

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


## Configuration

- Maximum 5 parallel `aosp-investigator` agents
- Keyword trigger: `"aosp plan"` or `"aosp_plan"`
- Non-interactive mode: outputs plan and stops after Step 6
- Interactive mode: adds synthesis review and execution approval gates

## Tool Usage

- Use `Agent(subagent_type="zaku:aosp-investigator", model="sonnet", ...)` for parallel investigation.
- Use `Agent(subagent_type="zaku:aosp-planner", model="opus", ...)` for Planner draft/revision.
- Use `Agent(subagent_type="zaku:aosp-architect", model="opus", ...)` for Architect review.
- Use `Agent(subagent_type="zaku:aosp-critic", model="opus", ...)` for Critic evaluation.
- Planner, Architect, and Critic MUST run sequentially: Planner -> Architect -> Critic. Never run consensus agents in parallel.
- All three consensus agents MUST receive the AOSP consensus packet.
- Critic MUST use the closed verdict contract: exactly one of `VERDICT: APPROVE`, `VERDICT: ITERATE`, or `VERDICT: REJECT`.
- Missing, malformed, multiple, conditional, or ambiguous Critic verdicts MUST be treated as `VERDICT: ITERATE` and recorded in the Consensus Review Changelog.
