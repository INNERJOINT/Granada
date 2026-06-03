---
description: Export documentation for vendor-modified or vendor-added AOSP features by summarizing implementation methods from related context code
argument-hint: '"<vendor feature description>"'
model: opus
level: 3
translate-dirs: [.granada/aosp-exports]
---

# AOSP Feature Export Skill

Documents vendor/third-party features added on top of AOSP. Takes a concrete vendor feature description as input, extracts any available vendor modification context from the description or conversation, then uses the `mcp__plugin_zaku_sourcepilot__*` tools to search the AOSP codebase for the original code being modified or extended. Outputs an English canonical markdown document focused on the problem or requirement the feature addresses, vendor solution, implementation method, related context code, and verification approach, archived to `.granada/aosp-exports/`.

**Key distinction:** The feature being documented is NOT an AOSP built-in feature. It is a vendor customization — code added or modified by the third-party vendor on top of AOSP. The AOSP search phase finds the original context that the vendor code interacts with.

**Scope principle:** One export should describe one concrete vendor feature slice, such as `AIUD 在 Settings 中的定制功能`, not a broad module-level topic like `Settings 定制` or `Connectivity 定制`. If the input is too broad, first run bounded coarse exploration, then list concrete sub-feature candidates with evidence, stop without exporting a report, and tell the user to run the skill again with one selected sub-feature.

## Usage

```
/zaku:aosp-feature-export "公共DNS"
/zaku:aosp-feature-export "fingerprint unlock"
/zaku:aosp-feature-export "AIUD 在 Settings 中的定制功能"
```

The only user input is the concrete vendor feature description. If additional vendor modification context or previous export context is needed, the skill should discover it from the conversation or ask for it during the protocol rather than exposing it as command-line flags.

## Protocol


### Step 1: Health Check

Call `mcp__plugin_zaku_sourcepilot__list_projects()` to verify the MCP server is reachable and upstream is responding.

After health check passes, read `.granada/aosp-config.json` to display the active AOSP project:
- If configured: display `**🔍 AOSP Project: <project_name>**` prominently
- If not configured: display `**⚠ 未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

(The `aosp-investigator` subagent reads this config and passes `project` to search calls automatically — no need to inject it into spawn prompts.)

On failure, abort with: `AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.`

### Step 2: Keyword Extraction

#### 2a: Extract vendor modification context

Extract any available vendor modification context from the feature description and conversation history. Do not require a specific hosting provider or source-control system.

When available, capture:
- changed file paths or module names
- class/interface names from path components or text
- method names, constants, settings keys, properties, resources, or config names
- concise descriptions of added or modified behavior
- user-visible entry points, API hooks, service hooks, or HAL/native touch points

If no modification context is available, continue in description-only mode and rely on AOSP source search to identify likely original context.

#### 2b: Build keyword set

1. From description text: extract noun phrases, domain terms, subsystem names
2. Merge with keywords extracted from vendor modification context (if any)
3. Deduplicate all keywords, cap at 10-15
4. Group into 3 keyword groups by implementation concern (e.g., user-facing entry, framework/service path, native/HAL dependency), not by broad subsystem area alone

### Step 2c: Scope Granularity Check

Before spawning investigators, decide whether the requested feature is concrete enough to export as one report.

**Single-purpose test (primary):** The feature should be describable in one sentence with one purpose. If the sentence contains two independent purposes (for example, `query and display user location`), split it into `query location` and `display location`.

**Split when any of these are true:**
- The feature contains more than 2 independent logical steps such as fetch, process, store, output, or notify.
- A part can be expressed as a reusable AOSP feature element composed from primitives such as Intent, System Service, HAL interface, Content Provider, or JobScheduler.
- The relevant implementation appears to exceed roughly 20-50 logical lines, has cyclomatic complexity > 10, or is hard to unit test independently.
- Different parts may change for different reasons (AOSP API change, business rule change, UI change, device/HAL change), following Parnas' separation principle.
- The description names a broad module or domain (`Settings customization`, `Connectivity customization`, `Audio routing`) rather than a concrete user-visible behavior, API behavior, or vendor hook.

**If the input is too broad: run bounded coarse exploration.** This branch runs after the Step 2c granularity decision and before Step 3 Phase 1 discovery. It is not a full export, must not write `.granada/aosp-exports/<slug>.md`, and must not continue into Step 3 after listing candidates.

1. Run coarse exploration with a **2 rounds adaptive** budget:
   - **Round 1:** spawn 2 `zaku:aosp-investigator` agents in parallel.
   - **Round 2:** only if Round 1 finds fewer than 2 actionable candidates, evidence is weak, or the results cannot be bounded into 2-6 single-purpose sub-features. Spawn 1-2 additional `zaku:aosp-investigator` agents focused on candidate boundaries and evidence gaps, not full implementation tracing.
   - **Total cap:** at most 4 coarse-exploration agents. Failed agents are not retried.
   - **Partial failure:** if more than 50% of agents fail in any round, stop coarse exploration and output partial candidates from the collected material with a warning.
   - Investigators may read small key file snippets, but must not perform formal export-level dependency tracing.

2. Use a breadth-first investigator prompt:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Coarsely explore AOSP for a BROAD vendor customization description: '<description>'.

  This is a third-party/vendor customization, NOT an AOSP built-in feature, and NOT yet a confirmed single feature slice.

  Vendor modification context (if available):
  <known changed file paths, class names, method names, settings/config keys, and behavior summaries from Step 2>

  Previously discovered prefixes, anchors, and candidate areas to avoid in this round (Round 2 only):
  <prefixes, anchors, and candidate areas already covered>

  Your mission: discover likely concrete sub-feature slices that could each be exported separately later.
  - Prefer breadth over depth: identify candidate behavior boundaries, entry points, key AOSP paths, class/interface/settings anchors, resources, and evidence snippets
  - Do not produce a full implementation report or trace the complete dependency chain
  - Avoid re-searching already discovered prefixes, anchors, or candidate areas in Round 2
  - Report candidate sub-features with evidence, uncertainty, and known gaps

  For each candidate, include: candidate name, one-sentence description, why it is independently exportable, evidence discovered, likely search anchors, confidence/evidence strength, and known gaps."
)
```

3. Synthesize 2-6 candidate sub-features. For each candidate, present:
   - **Candidate name:** concrete enough to rerun as `/zaku:aosp-feature-export "..."`
   - **Description:** one-sentence single-purpose behavior, API behavior, or vendor hook
   - **Why independent:** which split rule it satisfies, such as single purpose, separate UI/API/HAL concern, independent change reason, or reusable AOSP primitive
   - **Evidence discovered:** AOSP paths, classes, methods, settings keys, resources, or snippets found during coarse exploration
   - **Search anchors:** exact terms likely useful for the next run
   - **Confidence / evidence strength:** high, medium, or low
   - **Known gaps:** what still needs deep investigation in the next run

4. If evidence is insufficient, output conservative low-confidence candidates with explicit evidence gaps rather than presenting them as confirmed.

5. Stop without exporting a report, without writing `.granada/aosp-exports/<slug>.md`, and without continuing to Step 3. Tell the user to run `/zaku:aosp-feature-export` again with one selected candidate.

### Step 3: Phase 1 — Implementation Context Discovery

Spawn 3 `aosp-investigator` subagents in parallel. Each investigator is given the full confirmed sub-feature context and independently decides what/how to search. The orchestrator does NOT pre-generate search queries — investigators handle search strategy themselves:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Investigate AOSP for the original code related to a VENDOR feature: '<description>'.
  
  This is a third-party/vendor customization, NOT an AOSP built-in feature. The vendor has modified or extended AOSP code to implement this feature.
  
  Vendor modification context (if available):
  <known changed file paths, class names, method names, settings/config keys, and behavior summaries from Step 2>
  
  Your mission: Search AOSP to find the ORIGINAL context code that explains how this confirmed vendor sub-feature is implemented.
  - Search for the original AOSP classes/interfaces that the vendor code modifies, extends, or calls
  - Follow the implementation path from user-facing entry/API hook to framework/service/native/HAL dependencies when relevant
  - Identify the concrete problem being solved, the vendor method, the affected code path, and the observable effect
  - For each finding, document: file path, code snippet, implementation role, and how it supports the vendor solution
  
  Report ALL discovered AOSP file paths grouped by implementation concern. Include only architecture observations that explain the vendor implementation method."
)
```

Collect all investigator reports. Extract unique second-level directory prefixes (first two path segments from AOSP root, e.g., `frameworks/base`, `hardware/interfaces`, `packages/modules/Connectivity`). Store in `discovered_prefixes` set.

### Step 4: Phase 2 — Iterative Expansion

Run the full deep investigation loop by default.

Loop up to 5 rounds (max 15 total successful agent spawns across all rounds including Phase 1).

Each round, spawn N `aosp-investigator` subagents where N is determined by discovery rate:
- **Round 1** (first Phase 2 round): spawn 2 agents (baseline, no prior rate available)
- **Subsequent rounds:** if the previous round discovered ≥ 5 new prefixes, spawn 3 agents; otherwise spawn 2 agents
- **Per-round cap:** never exceed 3 agents in a single round
- **Total cap:** 15 successful spawns across all phases (Phase 1 + Phase 2) still applies
- **Tunable constant:** The 5-prefix scaling threshold is an initial heuristic. Adjust based on observed discovery patterns — lower it if features consistently under-explore, raise it if agent spawns are wasted on diminishing returns.

Pass them the accumulated findings so far and let them independently decide how to expand the search — the orchestrator provides context, not queries:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Continue investigating AOSP for the original code related to a VENDOR feature: '<description>'.
  
  This is a third-party/vendor customization. The vendor has modified or extended AOSP code.
  
  Previously discovered AOSP paths (DO NOT re-search these):
  <list of discovered_prefixes>
  
  Specific files already documented (avoid redundant searches):
  <list of up to 50 most-referenced file paths from prior rounds, selected for prefix diversity — spread across the most distinct prefixes to maximize coverage signal>
  
  Key interfaces and classes found so far:
  <extracted interface names, class names, AIDL/HIDL definitions from prior rounds>
  
  Your mission: Find AOSP code OUTSIDE the already-discovered areas that clarifies the confirmed sub-feature's implementation method.
  - Search for callers/implementors of the interfaces found so far
  - Look for adjacent code that explains why the vendor method works: entry points, state flow, config gates, permissions, persistence, service calls, native/HAL boundaries, or tests
  - Avoid broad subsystem surveys unless they directly explain the sub-feature's problem-solution path
  - Explore upstream/downstream AOSP dependencies not yet covered
  
  Report only NEW findings (paths not in the already-discovered list). Group by implementation concern with observations about how each finding explains the vendor method."
)
```

After each round:
1. Collect results, extract new second-level prefixes
2. **Convergence check:** If this round added fewer than 3 never-before-seen prefixes to `discovered_prefixes`, stop iterating
3. **Partial failure handling:** Failed agents don't count toward the 15-spawn cap. If >50% of agents in a round fail, halt and emit partial results with warning. No retries.
4. Emit progress to user: `Round N (M agents): +X new prefixes (total: Y unique prefixes, Z files discovered)`

<!-- FUTURE: Semantic convergence (stopping when findings repeat thematically rather than
     just by prefix count) requires a structured `layer` field in aosp-investigator output.
     See agents/aosp-investigator.md for the prerequisite change. Until that field exists,
     convergence remains prefix-count-based only. -->

### Step 5: Synthesis

The orchestrator's only heavy-lifting phase — merge investigator reports into a problem-solution implementation document:

1. Concatenate all investigator findings across all rounds
2. Deduplicate findings:
   a. **Exact path dedup:** merge entries with identical file paths (keep the richer implementation observation)
   b. **Overlapping snippet dedup:** if two findings reference the same file with overlapping line ranges, merge into one entry with the broader range
   c. **Semantic dedup:** if two findings describe the same interface/class or implementation step from different angles, consolidate into one entry combining both observations
3. Identify the confirmed sub-feature's problem-solution path:
   a. **Vendor problem:** what user-visible behavior, API behavior, device behavior, or integration gap the vendor change addresses
   b. **Vendor method:** what the vendor added/modified and why that method works in the AOSP context
   c. **Implementation path:** entry point → key modified code → AOSP context code → state/config/permission/service/native/HAL dependency → observable effect
   d. **Verification path:** logs, settings UI behavior, command/API observation, tests, or runtime state that can prove the feature works
4. Group findings by implementation concern first, and by AOSP path second. Example concern groups: UI/entry, framework/service flow, persistence/config, permission/SELinux, native/HAL boundary, verification/test.
5. Synthesize "Implementation method" and "implementation rationale" from concrete code paths and snippets. Do not produce a broad architecture survey unless it directly explains the vendor solution.
6. Map cross-project dependencies only when they are required to explain the implementation path.
6b. **Adaptive template sections:**
   - If the feature is small, use condensed output and fold interface/path summaries into "实现路径".
   - If no AIDL/HIDL interfaces found, omit "关键接口" and mention relevant APIs inside implementation steps.
   - If only 1 AOSP project discovered, omit a separate project summary table unless it clarifies the implementation.
   - If no cross-project dependencies are required to explain the solution, omit "依赖关系".
   - **Always include:** Overview, Vendor Problem and Solution, Implementation Method, Key Context Code, Verification Method, Investigation Log
7. Build the canonical output document **in English** using the template below

### Step 5b: Existing Export Context

If `.granada/aosp-exports/<slug>.md` already exists for the confirmed sub-feature, load it as prior context automatically.

1. Compute slug from description (same logic as Step 6)
2. Check if `.granada/aosp-exports/<slug>.md` exists
   - If not: skip this step
   - If exists: load the file and extract:
     a. previously documented implementation concerns and AOSP paths
     b. `last_verified` timestamp from the metadata section
     c. all previously documented file paths

3. **Staleness check:**
   - Parse `last_verified` from the existing document's metadata section
   - If `last_verified` is older than 30 days: emit warning to user: `"⚠ Last verification is older than 30 days ({date}). A full export will be regenerated from current code."`
   - Proceed regardless (warning only, not blocking)

4. **Merge strategy:**
   - Use existing findings only as background context for deduplication and comparison
   - Duplicate file paths are deduplicated (keep the newer observation)
   - Update `last_verified` timestamp to current date
   - Update convergence stats to reflect the current run

### Step 6: Save

1. Generate slug from description: lowercase, replace spaces/special chars with hyphens, max 50 chars
2. Create `.granada/aosp-exports/` directory if it doesn't exist
3. Write the English canonical output to `.granada/aosp-exports/<slug>.md`
4. Confirm to user: `Feature export saved to .granada/aosp-exports/<slug>.md`.

### Error Recovery

On any unrecoverable error:
- If agent data has been collected, write partial results to `.granada/aosp-exports/<slug>-partial.md`
- Report the error to the user

Skill is idempotent — re-running with the same inputs overwrites the output file.

## Output Template

```markdown
# Vendor Feature Element Export: {feature_name}

## Overview
- **Feature:** {confirmed_sub_feature_description}
- **Original input:** {original_description, if scope was split; otherwise same as Feature}
- **Type:** Vendor/third-party customization
- **Scope granularity:** {single purpose / split from broad scope / user-confirmed sub-feature}
- **AOSP project:** {project_name from .granada/aosp-config.json, or "not configured"}
- **Export date:** {date}
- **Vendor modification context:** {known paths/classes/methods/config keys or "description-only"}
- **Extracted keywords:** {keyword_list}
- **Search rounds:** {n}/5
- **Discovered AOSP project count:** {count}
- **Convergence:** {converged at round X / reached max rounds}

## Vendor Problem and Solution

- **Problem to solve:** {specific user behavior, API behavior, device behavior, or integration gap addressed by the vendor change}
- **Vendor method:** {what logic the vendor added or modified}
- **Why it works:** {how the original AOSP mechanism allows this approach to take effect}
- **Final effect:** {user-visible, system-observable, or interface-verifiable result}

## Vendor Modification Summary

{Summarize the known vendor modification context. Explain which paths, classes, methods, settings, resources, or behaviors are known to be changed. If no concrete modification context is available, state that the export is based on the feature description only.}

## Implementation Method

### 1. {implementation step name}
- **Purpose:** {what sub-problem this step solves}
- **Vendor change:** `{vendor/file/path}` {how the class/method/constant/configuration was changed}
- **AOSP context:** `{aosp/file/path}` {original mechanism, call relationship, or state flow}
- **Implementation rationale:** {why this change makes the feature work}
- **Key code:**
  ```
  {relevant code excerpt}
  ```

### 2. {implementation step name}
- **Purpose:** {what sub-problem this step solves}
- **Vendor change:** `{vendor/file/path}` {how the class/method/constant/configuration was changed}
- **AOSP context:** `{aosp/file/path}` {original mechanism, call relationship, or state flow}
- **Implementation rationale:** {why this change makes the feature work}
- **Key code:**
  ```
  {relevant code excerpt}
  ```

## Key Context Code

| Concern | File | Type | Role in the implementation method |
|---------|------|------|-----------------------------------|
| {UI entry/API entry/service flow/config persistence/permission/Native/HAL/test} | `{file_path}` | {Java/Kotlin/C++/AIDL/HIDL/XML/SELinux/Test} | {how this code explains the vendor approach} |
| ... | ... | ... | ... |

## Key Interfaces and Data Flow

{Keep this section only when interfaces or cross-layer data flow are necessary to explain the implementation method. Explain how AIDL/HIDL/Java API/Native/JNI/Intent/Content Provider/System Service/HAL participate in the feature.}

```text
{entry point} -> {vendor modified code} -> {AOSP context code} -> {state/config/service/native/HAL dependency} -> {observable effect}
```

## Verification Method

- **Verification entry:** {Settings page, command, API, log, test, or runtime state}
- **Expected behavior:** {what should be observed when the feature works}
- **Key logs/state:** {optional log tag, setting key, property, database row, service state, etc.}
- **Regression focus:** {adjacent logic that may be affected by this feature}

## Supporting Architecture Context

{Only describe architecture relationships required to understand the implementation method. Avoid expanding this into a full AOSP module overview.}

## Investigation Log

| Round | Query/focus | New prefixes | Total prefixes | Total files |
|-------|-------------|--------------|----------------|-------------|
| 1 (discovery) | {keyword groups or implementation concerns} | {n} | {n} | {n} |
| 2 | {new implementation concerns} | {n} | {n} | {n} |
| ... | ... | ... | ... | ... |
| {final} | {queries} | {n} | {n} | {n} |

**Stop reason:** {converged (< 3 new prefixes) / reached max rounds / partial failure}

## Metadata

- **Last verified:** {last_verified date}
- **Update mode:** {full export / incremental append}
- **Historical context:** {whether an existing export was found and used for comparison/deduplication}
- **Scope split:** {not split / split, exported sub-feature: <name>, remaining candidates: <list>}
```

## Keyword Triggers

- `"aosp export"`, `"aosp feature export"`, `"功能元导出"`, `"feature export"`

## Configuration

- Output directory: `.granada/aosp-exports/` (fixed)
- Max iteration rounds: 5
- Max total agent spawns: 15
- Convergence threshold: < 3 new second-level prefixes per round

## Known Limitations

- **Description-only mode:** If no concrete vendor modification context is available, the export may describe the most likely AOSP implementation context rather than confirmed vendor touch points.
- **Existing export interaction:** Previously exported findings are used for comparison and deduplication when an export with the same slug already exists.
