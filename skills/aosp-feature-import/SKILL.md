---
description: Import a six-layer AOSP vendor feature meta-slice package into another AOSP project and produce a plan-ready mapping guide
argument-hint: '"<path-to-meta-slice-package>" [--target <project>] [--depth shallow|deep]'
model: opus
translate-dirs: [.granada/aosp-imports]
---

# AOSP Feature Import Skill

Consumes the **Vendor Feature Meta-slice Package Contract** written by `aosp-feature-export`, maps the package's feature elements from a source AOSP project to a target AOSP project, and produces a best-effort **Plan-ready Import Map** saved to `.granada/aosp-imports/`.

**Key distinction from aosp-feature-export:** export discovers and explains a vendor feature slice in one AOSP tree. Import takes that feature-first package and maps it into another AOSP tree, preserving feature semantics, dependencies, interactions, evidence, and migration risks.

**Input compatibility:** this skill requires the new `vendor-feature-meta-slice/v1` package. Legacy export reports that only contain sections like `Overview`, `Key Interfaces`, `Dependencies`, or `Per-Project Code Paths` are incompatible. Abort with a clear instruction to re-run `/zaku:aosp-feature-export` using the latest skill.

## Usage

```
/zaku:aosp-feature-import .granada/aosp-exports/public-dns.md
/zaku:aosp-feature-import .granada/aosp-exports/fingerprint-unlock.md --target rk3588_android14
/zaku:aosp-feature-import .granada/aosp-exports/usb-audio-routing.md --depth shallow
```

## Flags

- `--target <project>`: override the target AOSP project. Default: read from `.granada/aosp-config.json`.
- `--depth shallow|deep`: controls investigation depth. Default: `deep`.
  - `shallow`: Phase 2 runs one target-only round and skips convergence checks. Use for quick feasibility assessment.
  - `deep`: Phase 2 runs up to four rounds with coverage-based convergence.
- `--skip-source-verify`: trust package source evidence freshness and run target-side mapping only. This reduces AOSP MCP calls but increases risk if the package is stale.

## When to Use

- You have a `vendor-feature-meta-slice/v1` package and need to apply the same vendor feature to another AOSP project or SoC tree.
- Porting vendor customizations between Android versions.
- Porting vendor customizations between SoC platforms.
- User says "aosp import", "feature import", "port feature", or asks to import an exported vendor feature package.

## When NOT to Use

- No meta-slice package exists yet — run `/zaku:aosp-feature-export` first.
- The export file is a legacy report, not a six-layer package — re-export first.
- Source and target are the same project — the export package already documents the source tree.
- The feature is an AOSP built-in rather than a vendor customization — use `aosp-plan` instead.

## Plan-ready Import Map Output

The input contract is the shared **Vendor Feature Meta-slice Package Contract** defined by `aosp-feature-export`. This skill's output is a **Plan-ready Import Map**. For every feature element, it must provide:

- source element and evidence
- target status
- target path/interface/config/policy/build hook when found
- gap summary
- migration action
- risk
- confidence
- manual verification point
- supporting evidence

Import is **best-effort**. Architecture divergence between source and target does not automatically stop guide generation, but low-confidence mappings must be clearly marked and routed to manual verification.

## Protocol

### Step 1: Health Check and Project Resolution

#### 1a. MCP Health Check

Call `mcp__plugin_zaku_sourcepilot__list_projects()` to verify the MCP server is reachable.

On failure, abort with: `AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.`

#### 1b. Resolve Target Project

Determine the target AOSP project:
1. If `--target <project>` is provided, use that value.
2. Otherwise, read `.granada/aosp-config.json` for the active project.
3. If neither exists, abort with `No target AOSP project was specified. Use --target <project> or run /zaku:aosp-project to configure one.`

#### 1c. Parse and Validate Meta-slice Package

Read the input file and verify that it satisfies the shared **Vendor Feature Meta-slice Package Contract** from `aosp-feature-export`. Required markers:

- `Package schema: vendor-feature-meta-slice/v1`
- `Vendor Feature Meta-slice Package` title or metadata
- `Feature Spec`
- `Traceability Matrix`
- all six layer sections:
  - `Layer 1: Feature Semantics`
  - `Layer 2: Variation Points`
  - `Layer 3: Implementation Elements`
  - `Layer 4: Dependencies`
  - `Layer 5: Interactions`
  - `Layer 6: Evidence`
- `Completeness Check`

If these markers are missing, abort with:

```
Export package is incompatible with aosp-feature-import. Re-export the feature with the latest /zaku:aosp-feature-export so it produces a six-layer vendor-feature-meta-slice/v1 package. Missing markers: {missing_markers}
```

Do not fall back to legacy parsing.

Extract:

```json
{
  "schema": "vendor-feature-meta-slice/v1",
  "source_project": "<AOSP project from Overview>",
  "feature_name": "<package title or Feature Spec>",
  "feature_spec": { "capability": "...", "scope_boundary": "...", "activation": [] },
  "traceability_items": [],
  "feature_elements": [],
  "variation_points": [],
  "dependencies": [],
  "interactions": [],
  "evidence": [],
  "completeness": []
}
```

If `source_project` is missing, abort with:

```
Meta-slice package is missing source AOSP project information. Re-run /zaku:aosp-feature-export with an active AOSP project configured.
```

#### 1d. Validate Projects

- If `source_project == target_project`, abort with `Source and target projects are the same (<project>). No import is needed.`
- Display:

```
Feature import configuration:
- Source AOSP project: <source_project>
- Target AOSP project: <target_project>
- Feature: <feature_name>
- Package schema: vendor-feature-meta-slice/v1
- Feature element count: <count>
- Dependency edge count: <count>
- Interaction count: <count>
```

### Step 2: Feature Element Extraction

Build mapping tasks from the meta-slice package, not from legacy report sections.

Each task represents one feature element or tightly coupled element group:

```json
{
  "feature_elements": [
    {
      "id": "element-id-from-package-or-generated",
      "name": "<feature element name>",
      "semantic_role": "<role in Feature Semantics>",
      "source_locations": ["<path#symbol or config/interface>"],
      "layer": "framework|system_service|HAL|sepolicy|init|app|build|resource|native|unknown",
      "variation_points": ["<related variation IDs>"],
      "dependencies": ["<dependency edge IDs>"],
      "interactions": ["<interaction IDs>"],
      "evidence_ids": ["<evidence IDs>"],
      "priority": "critical|important|optional",
      "confidence": "high|medium|low"
    }
  ]
}
```

Priority assignment:
- `critical`: entry points, activation gates, dependencies required for the feature to work, policy/permission gates, or elements with high-risk interactions.
- `important`: implementation elements that carry core behavior or target adaptation risk.
- `optional`: verification-only or contextual elements that do not block the feature.

Cap at 10 mapping tasks. If the package has more, merge related elements by feature role and dependency/interactions, not merely by directory prefix. The merged task inherits the highest priority and lowest confidence among its elements.

### Step 3: Phase 1 — Parallel Source/Target Mapping

For each `critical` and `important` mapping task, up to 6 tasks total, spawn paired `zaku:aosp-investigator` agents: one verifies/enriches source context, one maps target context. Run all pairs in parallel.

If `--skip-source-verify` is set, skip source investigators and use the package evidence as source context.

#### Source Investigator

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="opus",
  prompt="Verify source context for a vendor feature meta-slice import.

AOSP Project Override: Use project '<source_project>' for ALL mcp__plugin_zaku_sourcepilot__* search calls. Do NOT read .granada/aosp-config.json.

Feature Spec:
<feature_spec>

Feature Element:
<feature_element_json>

Package evidence:
<evidence linked to this element>

Your mission:
1. Verify source paths, symbols, configs, interfaces, policies, and build hooks still exist.
2. Confirm the element's role in the feature semantics, variation points, dependencies, and interactions.
3. Extract exact signatures, config keys, module names, policy names, or runtime hooks needed to find the target equivalent.
4. Note stale evidence, missing source elements, or changed APIs.

Report source status, current signatures/context, evidence freshness, and source-side risks."
)
```

#### Target Investigator

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="opus",
  prompt="Map a vendor feature meta-slice element into the TARGET AOSP project.

AOSP Project Override: Use project '<target_project>' for ALL mcp__plugin_zaku_sourcepilot__* search calls. Do NOT read .granada/aosp-config.json.

Feature Spec:
<feature_spec>

Feature Element:
<feature_element_json>

Source context:
<source locations, signatures, configs, interfaces, policies, build hooks>

Dependencies and interactions to preserve:
<related dependencies and interactions>

Your mission:
1. Find target equivalents by exact path, symbol, interface, config key, resource, property, policy, build module, or functional role.
2. Classify target status: MAPPED, MOVED, DIVERGED, MISSING, or RISKY.
3. For DIVERGED: document API, module, policy, lifecycle, or build differences.
4. For MISSING: search for replacement APIs/modules or alternative implementation paths.
5. For RISKY: explain the architecture divergence, low-confidence assumption, and manual verification needed.
6. Preserve feature interactions and dependencies when proposing migration actions.

Report target status, target locations, gap summary, proposed migration action, risk, confidence, manual verification point, and evidence."
)
```

### Step 3b: Post-Phase-1 Validation

After Phase 1 agents complete:

1. Verify source investigators used `source_project` and target investigators used `target_project`.
2. Check that every critical feature element has either source verification or package evidence if `--skip-source-verify` was used.
3. Check that every target result includes status, gap, migration action, risk, confidence, manual verification point, and evidence.
4. If an agent appears to have searched the wrong project, re-spawn only that agent with reinforced project override instructions.

### Step 4: Phase 2 — Gap and Interaction Expansion

Categorize every feature element:

- `MAPPED`: target equivalent found and migration action is direct or localized.
- `MOVED`: equivalent exists at a different path/module/package.
- `DIVERGED`: target has equivalent capability but API, policy, lifecycle, build, or architecture differs.
- `MISSING`: no target equivalent found.
- `RISKY`: mapping exists only by weak functional analogy or has unresolved feature interactions.
- `UNVERIFIED`: source verification failed and package evidence is insufficient.

If `--depth shallow`, run exactly one round with two target-only agents focused on DIVERGED/MISSING/RISKY elements, then proceed to Step 5.

For `deep`, run up to 4 rounds and up to 8 Phase 2 agents total. Each round focuses on the highest-risk gaps:

- missing critical dependencies
- unresolved feature interactions
- low-confidence target equivalents
- policy/permission mismatches
- lifecycle or IPC differences
- build/packaging blockers
- verification gaps

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="opus",
  prompt="Deep gap investigation for a vendor feature meta-slice import.

AOSP Project Override: Use project '<target_project>' for ALL mcp__plugin_zaku_sourcepilot__* search calls.

Feature Spec:
<feature_spec>

Gap focus:
<one DIVERGED/MISSING/RISKY/UNVERIFIED element or interaction>

Known source context:
<source evidence and dependencies>

Known target findings:
<target findings so far>

Your mission:
- Find concrete adaptation points or alternatives.
- Preserve required dependencies and feature interactions.
- Identify migration action, risk, confidence, manual verification, and evidence.
- If no better target evidence exists, state why the mapping remains low-confidence."
)
```

Convergence: stop when a full round produces no new target location, adaptation point, interaction risk, verification method, or confidence upgrade. A component remaining MISSING or RISKY is not enough to continue without new evidence.

Progress reporting:

```
Phase 2 Round N: investigated X gaps; new adaptation points Y; statuses {MAPPED:A, MOVED:B, DIVERGED:C, MISSING:D, RISKY:E, UNVERIFIED:F}
```

### Step 5: Synthesis — Plan-ready Import Map

Merge findings into a structured import guide.

For every feature element, generate:

- source element and evidence
- target status
- target mapping or alternative
- gap summary
- migration action
- risk
- confidence
- manual verification point
- supporting evidence

Best-effort policy:
- Do not silently fail on architecture divergence.
- Do not present low-confidence guesses as ready mappings.
- Mark low-confidence or interaction-sensitive mappings as RISKY.
- If a migration action depends on an unresolved choice, state the decision required before `aosp-plan` execution.

### Step 6: Save and Explicit aosp-plan Handoff

1. Generate slug from feature name: lowercase, replace spaces/special chars with hyphens, max 50 chars.
2. Create `.granada/aosp-imports/` if it does not exist.
3. Write import guide to `.granada/aosp-imports/<slug>.md`.
4. Confirm:

```
Feature import guide saved: .granada/aosp-imports/<slug>.md
```

5. Invoke `Skill("zaku:aosp-plan")` with this planning query:

```
Generate a feature-import modification plan for target project <target_project> based on .granada/aosp-imports/<slug>.md. The plan-ready import map, feature-element mappings, adaptation actions, risk assessment, confidence labels, manual verification points, dependency order, and feature interactions from the import guide must be used as input evidence.
```

The skill MUST NOT write its own implementation plan, run Architect/Critic gates itself, invoke `aosp-autopilot`, or directly modify source code. Planning is delegated to the explicit `aosp-plan` handoff.

## Output Template

```markdown
# Vendor Feature Import Map: {feature_name}

## Overview
- **Feature:** {feature_spec.capability}
- **Source AOSP project:** {source_project}
- **Target AOSP project:** {target_project}
- **Input package:** {meta_slice_package_path}
- **Package schema:** vendor-feature-meta-slice/v1
- **Import date:** {date}
- **Feature element count:** {count}
- **Mapping status:** MAPPED: {n}, MOVED: {n}, DIVERGED: {n}, MISSING: {n}, RISKY: {n}, UNVERIFIED: {n}
- **Estimated porting difficulty:** low / medium / high

## Feature Spec Summary

{Summarize capability, scope boundary, activation, preconditions, visible effect, and non-goals from the package.}

## Plan-ready Mapping

| Feature element | Source evidence | Target status | Target mapping | Gap | Migration action | Risk | Confidence | Manual verification |
|-----------------|-----------------|---------------|----------------|-----|------------------|------|------------|---------------------|
| {element} | {evidence IDs / source path} | MAPPED/MOVED/DIVERGED/MISSING/RISKY/UNVERIFIED | {target path/interface/config/policy/build hook} | {gap summary} | {action for aosp-plan} | high/medium/low | high/medium/low | {manual check} |

## Dependency Preservation

| Dependency | Source role | Target mapping | Required migration action | Evidence | Confidence |
|------------|-------------|----------------|---------------------------|----------|------------|
| {from -> to} | {why required} | {target equivalent or missing} | {action} | {evidence} | {confidence} |

## Feature Interactions

| Interaction | Source behavior | Target concern | Migration decision | Risk | Evidence |
|-------------|-----------------|----------------|--------------------|------|----------|
| {require/exclude/refine/interact/override/conflict} | {source interaction} | {target impact} | {decision/action} | {risk} | {evidence} |

## Adaptation Actions

### Action {n}: {action title} [Priority: critical|important|optional]
- **Feature element:** {element id/name}
- **Target file/interface/config:** {target location}
- **Source evidence:** {source evidence IDs}
- **Change content:** {what vendor logic should be applied or adapted}
- **Adaptation points:** {API/policy/lifecycle/build/config differences}
- **Risk:** {risk and why}
- **Confidence:** {high/medium/low}
- **Manual verification:** {specific manual check}
- **Automated verification candidate:** {test/log/trace/command if available}

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation | Manual verification |
|------|--------|------------|------------|---------------------|
| {risk description} | high/medium/low | high/medium/low | {mitigation} | {check} |

## Dependency Order

```text
1. {first element/action} (no dependencies)
2. {second element/action} (depends on: 1)
3. {third element/action} (depends on: 1, 2)
```

## Source Verification Log

| Feature element | Package evidence | Current source status | Notes |
|-----------------|------------------|-----------------------|-------|
| {element} | {evidence IDs} | verified/changed/missing/skipped | {notes} |

## Target Investigation Log

| Round | Focus | Status changes | Findings |
|-------|-------|----------------|----------|
| 1 | {feature elements} | {summary} | {findings} |
| ... | ... | ... | ... |

## aosp-plan Handoff Query

```text
Generate a feature-import modification plan for target project {target_project} based on .granada/aosp-imports/{slug}.md. The plan-ready import map, feature-element mappings, adaptation actions, risk assessment, confidence labels, manual verification points, dependency order, and feature interactions from the import guide must be used as input evidence.
```

## Metadata

- **Input package schema:** vendor-feature-meta-slice/v1
- **Export last verified:** {last_verified from package}
- **Source project search count:** {n}
- **Target project search count:** {n}
- **Total agent dispatch count:** {n}
- **Skipped source verification:** {yes/no}
- **Generated by:** zaku:aosp-feature-import
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Input file not found | Abort with path suggestion |
| Input is legacy export report | Abort with latest `aosp-feature-export` re-export instruction |
| Missing six-layer package markers | Abort listing missing markers |
| Missing source project | Abort and request re-export with active AOSP project configured |
| Source project unreachable | Warn and continue only if `--skip-source-verify` behavior is acceptable; otherwise abort |
| Target project unreachable | Abort because target mapping is required |
| Source == target project | Abort with explanation |
| No target project configured or specified | Abort with setup instructions |
| More than 50% of Phase 1 agents fail | Emit partial import map with warning if target evidence exists; otherwise abort |
| All target mappings are MISSING/RISKY | Complete with high difficulty assessment and manual review recommendation |
| Phase 2 fails partially | Continue with successful findings and mark unresolved gaps |

## Error Recovery

On unrecoverable error:
- If investigator data has been collected, write partial results to `.granada/aosp-imports/<slug>-partial.md`.
- Partial output must still include feature elements, status, risk, confidence, manual verification points, and evidence gathered so far.
- Report the error to the user.

Skill is idempotent: re-running with the same inputs overwrites the output file.

## Configuration

- Output directory: `.granada/aosp-imports/` (fixed)
- Full import map path: `.granada/aosp-imports/<slug>.md`
- Partial import path: `.granada/aosp-imports/<slug>-partial.md`
- Max Phase 1 mapping tasks: 6
- Max Phase 1 agents: 12 when source verification is enabled
- Max Phase 2 agents: 8
- Max Phase 2 rounds: 4
- Feature element cap: 10 mapping tasks after grouping
- Convergence: no new target location, adaptation point, interaction risk, verification method, or confidence upgrade in a full Phase 2 round

## Tool Usage

- `mcp__plugin_zaku_sourcepilot__*`: AOSP MCP health check and AOSP code search through investigators
- `Agent(subagent_type="zaku:aosp-investigator", model="opus")`: parallel source and target investigation
- `Read`: parse meta-slice package and `.granada/aosp-config.json`
- `Write`: save import map
- `Skill("zaku:aosp-plan")`: explicit planning handoff after saving the import map

## Keyword Triggers

- `"aosp import"`, `"aosp feature import"`, `"feature import"`, `"port feature"`, `"meta-slice import"`

## Design Decision: New Package Only

This skill intentionally requires `vendor-feature-meta-slice/v1` and rejects legacy export reports. The import protocol depends on feature semantics, variation points, implementation elements, dependencies, interactions, and evidence being explicit. Supporting old reports would require a weak compatibility layer that guesses missing layers and would undermine plan-ready traceability.

## Design Decision: Best-effort Mapping

Source and target AOSP trees often differ architecturally. Import should still produce a useful plan-ready map when evidence is incomplete, but every uncertain mapping must carry risk, confidence, and manual verification. Low-confidence guesses are outputs for human decision-making, not silent implementation instructions.
