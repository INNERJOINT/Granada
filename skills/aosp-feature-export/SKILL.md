---
description: Export documentation for vendor-modified or vendor-added AOSP features by summarizing implementation methods from related context code
argument-hint: '"<vendor feature description>"'
model: opus
level: 3
translate-dirs: [.granada/aosp-exports]
---

# AOSP Feature Export Skill

Documents vendor/third-party features added on top of AOSP. Takes a concrete vendor feature description and GitLab MR/commit URLs (vendor changes) as input, delegates URL inspection to `gitlab-info` to identify modification points, then uses the `mcp__plugin_zaku_sourcepilot__*` tools to search the AOSP codebase for the original code being modified or extended. Outputs an English canonical markdown document focused on the feature's problem, vendor solution, implementation method, related context code, and verification approach, archived to `.granada/aosp-exports/`. After the canonical export is written, the plugin `PostToolUse` hook generates a best-effort Simplified Chinese sibling file with `_zh.md` suffix in the same directory.

**Key distinction:** The feature being documented is NOT an AOSP built-in feature. It is a vendor customization — code added or modified by the third-party vendor on top of AOSP. The AOSP search phase finds the original context that the vendor code interacts with.

**Scope principle:** One export should describe one concrete vendor feature slice, such as `AIUD 在 Settings 中的定制功能`, not a broad module-level topic like `Settings 定制` or `Connectivity 定制`. If the input is too broad, split it into candidate sub-features, ask the user to confirm one, export only that confirmed sub-feature report, then stop and tell the user to run the skill again for the remaining sub-features.

## Usage

```
/zaku:aosp-feature-export "公共DNS"
/zaku:aosp-feature-export "fingerprint unlock"
/zaku:aosp-feature-export "AIUD 在 Settings 中的定制功能"
```

The only user input is the concrete vendor feature description. If GitLab links, commits, or previous export context are needed, the skill should discover or ask for them during the protocol rather than exposing them as command-line flags.

## Protocol

### Step 0: State Initialization

```
Write JSON to .granada/aosp-feature-export-state.json with, active=true, task_description="<description>")
```

### Step 1: Health Check

Call `mcp__plugin_zaku_sourcepilot__list_projects()` to verify the MCP server is reachable and upstream is responding.

After health check passes, read `.granada/aosp-config.json` to display the active AOSP project:
- If configured: display `**🔍 AOSP Project: <project_name>**` prominently
- If not configured: display `**⚠ 未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

(The `aosp-investigator` subagent reads this config and passes `project` to search calls automatically — no need to inject it into spawn prompts.)

On failure:
```
Bash: rm -f .granada/aosp-feature-export-state.json
```
Abort with: `AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.`

### Step 2: Keyword Extraction

#### 2a: Fetch change data from related links or commits

If GitLab MR/commit URLs are discovered from the conversation context or requested from the user during the protocol, delegate GitLab URL inspection to `gitlab-info` instead of parsing GitLab URLs locally:

1. Invoke `/zaku:gitlab-info <url1> <url2> ...` with all confirmed links in one call.
2. Require `gitlab-info` output to provide, per URL:
   - parsed `project_id`
   - URL type and diff scope (`MR overall`, `selected commit`, or `selected diff version`)
   - MR title/description or commit title/message
   - changed file paths (`old_path`, `new_path`, added/renamed/deleted when available)
   - concise modification summary and key diff identifiers
   - commit SHAs and authored/committed dates when available
   - any `未确认 / 需要确认` entries
3. Treat any `未确认 / 需要确认` entries as warnings. Continue with confirmed URLs; if ALL URL inspections fail, fall back to description-only mode.

4. From `gitlab-info` data, extract:
   - Changed file paths (strip extensions to get class/module names)
   - Class/interface names from path components
   - Noun phrases from MR title/description or commit messages
   - Key identifiers from diff additions or modification summaries (class declarations, method names, constants)

#### 2a-discover: Related commit discovery

**Prerequisite:** Step 2a (fetch) must complete first — discovery uses project IDs and commit dates from fetched data.

**Skip conditions (any triggers silent skip):**
- No confirmed GitLab project/date context is available from Step 2a

**Procedure:**

1. **Runtime tool verification:** Call `mcp__gitlab__list_commits` with a minimal query (the first project, `per_page=1`, `since` = 1 hour ago). If the call returns an error indicating the tool does not exist or is unsupported, emit `"⚠ GitLab list_commits 不可用，跳过关联提交发现。"` and skip discovery entirely.

2. **Build discovery queries:** For each unique `project_id` extracted from user-confirmed URLs:
   - Determine time window: `since` = (earliest user commit date − 30 days), `until` = (latest user commit date + 7 days)
   - Query: `mcp__gitlab__list_commits(project_id, since, until, per_page=100)`
   - Budget: 1 verification call + up to 29 project queries = 30 total cap
   - If no project context is available: skip discovery gracefully with `"⚠ 无项目上下文，跳过关联提交发现。"`

3. **Execution bounds:**
   - **Call cap:** Maximum 30 total `list_commits` API calls (including verification). Stop querying remaining projects if cap reached.
   - **Timeout:** 30-second wall-clock timeout for entire discovery sub-step. If exceeded, use collected results and emit `"⚠ 关联提交发现超时 (30s)，使用已收集的部分结果。"`

4. **Keyword post-filter:** From returned commits, keep only those whose commit message contains at least one keyword from the Step 2b keyword set (the deduplicated 10-15 terms from description + fetched diff file path stems). Discard commits already in user-confirmed set (by SHA match).

5. **Output:** Store as `discovered_commits[]` with fields: `sha`, `project_id`, `title`, `authored_date`, `web_url` (constructed as `https://{host}/{project_path}/-/commit/{sha}`). Cap at 20 commits (sorted by date, most recent first).

6. **Reporting:** Emit progress: `"发现关联提交: {N} 条 (来自 {M} 个项目, 耗时 {T}s)"`

#### 2b: Build keyword set

1. From description text: extract noun phrases, domain terms, subsystem names
2. Merge with keywords extracted from links/commits (if any)
3. If discovery ran: merge additional keywords from discovered commit messages (noun phrases, identifiers)
4. Deduplicate all keywords, cap at 10-15
5. Group into 3 keyword groups by implementation concern (e.g., user-facing entry, framework/service path, native/HAL dependency), not by broad subsystem area alone

### Step 2c: Scope Granularity Check

Before spawning investigators, decide whether the requested feature is concrete enough to export as one report.

**Single-purpose test (primary):** The feature should be describable in one sentence with one purpose. If the sentence contains two independent purposes (for example, `query and display user location`), split it into `query location` and `display location`.

**Split when any of these are true:**
- The feature contains more than 2 independent logical steps such as fetch, process, store, output, or notify.
- A part can be expressed as a reusable AOSP feature element composed from primitives such as Intent, System Service, HAL interface, Content Provider, or JobScheduler.
- The relevant implementation appears to exceed roughly 20-50 logical lines, has cyclomatic complexity > 10, or is hard to unit test independently.
- Different parts may change for different reasons (AOSP API change, business rule change, UI change, device/HAL change), following Parnas' separation principle.
- The description names a broad module or domain (`Settings customization`, `Connectivity customization`, `Audio routing`) rather than a concrete user-visible behavior, API behavior, or vendor hook.

**If the input is too broad:**
1. Derive 2-6 candidate sub-features from the description, GitLab diff paths, class/method names, and modification summaries.
2. Present the candidates to the user and ask which one should be exported now.
3. After the user confirms one candidate, continue the protocol using that sub-feature as `<description>` and keep the original broad request as background context only.
4. Export exactly one confirmed sub-feature report.
5. At the end, tell the user which candidate was exported and that remaining candidates require separate runs.

### Step 3: Phase 1 — Implementation Context Discovery

Spawn 3 `aosp-investigator` subagents in parallel. Each investigator is given the full confirmed sub-feature context and independently decides what/how to search. The orchestrator does NOT pre-generate search queries — investigators handle search strategy themselves:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Investigate AOSP for the original code related to a VENDOR feature: '<description>'.
  
  This is a third-party/vendor customization, NOT an AOSP built-in feature. The vendor has modified or extended AOSP code to implement this feature.
  
  Vendor modification points (from GitLab diffs):
  <changed file paths, class names, method names, and diff summaries from Step 2>
  
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
   - If `discovered_commits[]` is empty (no project context or no matches), omit "发现的关联提交".
   - **Always include:** Overview, Vendor Problem and Solution, Implementation Method, Key Context Code, Verification Method, Investigation Log
7. **Construct commit URLs:** For each input link's project, build browsable commit URLs using format `https://{host}/{project_path}/-/commit/{sha}`. If the input was an MR, use the MR's source commits. Include these URLs in the output under "Vendor-Related Commits".
8. Build the canonical output document **in English** using the template below

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
4. The plugin `PostToolUse` hook will best-effort generate `.granada/aosp-exports/<slug>_zh.md` after the canonical file is written. Translation failures warn but do not invalidate or modify the English canonical export.
5. Call `Bash: rm -f .granada/aosp-feature-export-state.json`
6. Confirm to user: `Feature export saved to .granada/aosp-exports/<slug>.md`; if the hook succeeded, also mention `.granada/aosp-exports/<slug>_zh.md`.

### Error Recovery

On any unrecoverable error after Step 0:
- If agent data has been collected, write partial results to `.granada/aosp-exports/<slug>-partial.md` (partial files are not translated by the hook)
- Call `Bash: rm -f .granada/aosp-feature-export-state.json`
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
- **Input links:** {url_list or "none"}
- **Input commits:** {commit_list or "none"}
- **Extracted keywords:** {keyword_list}
- **Search rounds:** {n}/5
- **Discovered AOSP project count:** {count}
- **Convergence:** {converged at round X / reached max rounds}
- **Related commit discovery:** {enabled/disabled} {if enabled: "found N commits in Xs" / "tool unavailable, skipped" / "timed out, partial results"}

## Vendor Problem and Solution

- **Problem to solve:** {specific user behavior, API behavior, device behavior, or integration gap addressed by the vendor change}
- **Vendor method:** {what logic the vendor added or modified}
- **Why it works:** {how the original AOSP mechanism allows this approach to take effect}
- **Final effect:** {user-visible, system-observable, or interface-verifiable result}

## Vendor Modification Summary

{Summarize the vendor change from the GitLab diff. Explain which files were changed, what logic was added, and where the modified entry point is. Keep only changes directly related to the confirmed sub-feature.}

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

## Vendor-Related Commits

- [{commit_message}]({https://gitlab.host/project_path/-/commit/full_sha}) ({date})

## Discovered Related Commits

> These commits were discovered automatically, not directly provided by the user. They are filtered by project time window and keyword matching.

| Project | SHA | Commit message | Date | Link |
|---------|-----|----------------|------|------|
| {project_path} | {short_sha} | {title} | {date} | [View]({web_url}) |
| ... | ... | ... | ... | ... |

**Discovery parameters:** time window {since} ~ {until}, matched {keyword_count} keywords, scanned {project_count} projects

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
- Chinese sibling output: `.granada/aosp-exports/<slug>_zh.md` (best-effort hook-derived translation, overwritten atomically on success)
- Translation hook configuration:
  - Skill frontmatter keeps `translate-dirs: [.granada/aosp-exports]` to limit eligible Markdown writes
  - `GRANADA_TRANSLATE_COMMAND` defines the local translation command; default is `claude -p --model sonnet`
  - For `claude`, only `claude -p` and `claude -p --model <model>` are accepted
  - Optional `translate-timeout-ms` can be set in skill frontmatter (default 300000)
  - `TRANSLATE_MD_ZH_ALLOWED_COMMANDS` (optional comma-separated executable allowlist, default `claude`; tests may set `claude,node`)
- Debugging:
  - `GRANADA_DEBUG` controls stderr log threshold without affecting hook stdout JSON
  - Levels: `V` (verbose), `D` (debug), `I` (info), `W` (warn), `E` (error)
  - `1` / `true` / `yes` / `on` are treated as `D`
  - Current events: skip reasons log at `D`; translation start/success log at `I`; translation failures log at `E`
- Test-only hook override:
  - `TRANSLATE_MD_ZH_MOCK_TEXT` returns fixed translated text without invoking `translate-command`
- Max iteration rounds: 5
- Max total agent spawns: 15
- Convergence threshold: < 3 new second-level prefixes per round
- State mode: `aosp-feature-export`
- Discovery call cap: 30 (1 verify + 29 queries)
- Discovery timeout: 30s
- Discovery time window: earliest commit − 30 days to latest commit + 7 days
- Discovery max results: 20 commits (sorted by date desc)
- Discovery keyword filter: Step 2b keyword set (10-15 terms)

## Known Limitations (关联提交发现 V1)

- **Multi-project:** Only searches within projects discovered from confirmed GitLab context. No cross-project or group-level discovery. (Future: GitLab group-level commit search or cross-reference via MR links.)
- **Precision:** Project-scoped (not path-filtered). Keyword filtering reduces noise but may miss semantically related commits with different terminology. (Future: path-level filtering for higher precision.)
- **Tool dependency:** Requires `mcp__gitlab__list_commits` from the GitLab MCP server. Silently skipped if unavailable.
- **Existing export interaction:** Previously exported findings are used for comparison and deduplication when an export with the same slug already exists.
