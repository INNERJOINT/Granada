---
name: aosp-feature-export
description: Export AOSP feature element documentation by iteratively searching related code across all AOSP projects
argument-hint: "<feature description>" --links <url1,url2,...>
level: 3
---

# AOSP Feature Export Skill

Documents vendor/third-party features added on top of AOSP. Takes a feature description and GitLab MR/commit URLs (vendor changes) as input, fetches diffs via GitLab MCP tools to identify modification points, then uses `sourcepilot` to search the AOSP codebase for the original code being modified or extended. Outputs a comprehensive Chinese-language markdown document that maps the vendor feature across AOSP layers, archived to `.plugin-state/aosp-exports/`.

**Key distinction:** The feature being documented is NOT an AOSP built-in feature. It is a vendor customization — code added or modified by the third-party vendor on top of AOSP. The AOSP search phase finds the original context that the vendor code interacts with.

## Usage

```
/zaku:aosp-feature-export "公共DNS" --links https://gitlab.gz.cvte.cn/mt8781_androidu/platform/packages/modules/Connectivity/-/merge_requests/3/diffs
/zaku:aosp-feature-export "fingerprint unlock" --links https://gitlab.gz.cvte.cn/project/path/-/commit/d2794bf5a8132dc9
/zaku:aosp-feature-export "USB audio routing" --links <mr-url1>,<commit-url2>
/zaku:aosp-feature-export "USB audio routing"
```

## Flags

- `--links <url1,url2,...>`: Comma-separated GitLab MR diff or commit URLs as starting points for keyword extraction (primary input mode)
- `--depth shallow|deep`: Controls investigation depth (default: `deep`)
  - `shallow`: Phase 2 (Step 4) runs exactly 1 round with 2 agents. No convergence check is evaluated. Useful for quick overviews or when the feature scope is already well-understood.
  - `deep`: Phase 2 runs up to 5 rounds with convergence-based termination (existing behavior, unchanged).
- `--append`: Incremental update mode. If a previous export exists for this feature (matched by slug), load it and expand rather than overwrite. Skips Phase 1 and uses prior findings as the starting set for Phase 2.
- Without flags: Uses only the description text for keyword extraction

### Supported URL Formats

- **MR diffs:** `https://{host}/{project_path}/-/merge_requests/{iid}/diffs` (trailing `/diffs` optional)
- **Commit:** `https://{host}/{project_path}/-/commit/{sha}`

Future: URL routing is provider-dispatched. Currently supports GitLab only. GitHub/Gerrit patterns may be added later.

## Protocol

### Step 0: State Initialization

```
Write JSON to .plugin-state/aosp-feature-export-state.json with, active=true, task_description="<description>")
```

### Step 1: Health Check

Call `sourcepilot` with `tool: "list_tools"` to verify MCP server reachability. Then issue one lightweight search query to confirm upstream is responding.

After health check passes, read `.plugin-state/aosp-config.json` to display the active AOSP project:
- If configured: display `**🔍 AOSP Project: <project_name>**` prominently
- If not configured: display `**⚠ 未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

(The `aosp-investigator` subagent reads this config and passes `project` to search calls automatically — no need to inject it into spawn prompts.)

On failure:
```
Bash: rm -f .plugin-state/aosp-feature-export-state.json
```
Abort with: `AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.`

### Step 2: Keyword Extraction

#### 2a: Fetch change data from links or commits

**If `--links` provided**, parse each URL and call GitLab MCP tools. **Process all URLs in parallel** — each URL's fetches are independent and should be issued concurrently:

1. For each URL, determine type by pattern matching:
   - **MR URL** (`{host}/{project_path}/-/merge_requests/{iid}` with optional `/diffs`):
     - Extract `project_id` = `{project_path}` (e.g., `mt8781_androidu/platform/packages/modules/Connectivity`)
     - Extract `merge_request_iid` = `{iid}`
     - Call `mcp__gitlab__get_merge_request(project_id, merge_request_iid)` and `mcp__gitlab__get_merge_request_diffs(project_id, merge_request_iid)` **concurrently** (independent calls for the same MR) → extract MR title, description, changed file paths (old_path, new_path), and diff content
   - **Commit URL** (`{host}/{project_path}/-/commit/{sha}`):
     - Extract `project_id` = `{project_path}`
     - Extract `sha` = `{sha}`
     - Call `mcp__gitlab__get_commit(project_id, sha)` and `mcp__gitlab__get_commit_diff(project_id, sha, full_diff=true)` **concurrently** → extract commit message, changed file paths, and diff content

2. From fetched data, extract:
   - Changed file paths (strip extensions to get class/module names)
   - Class/interface names from path components
   - Noun phrases from MR title/description or commit messages
   - Key identifiers from diff additions (class declarations, method names, constants)

3. **Error handling:** If any URL returns an error (unreachable, 404, permission denied), log it and continue with remaining URLs. If ALL URLs fail, fall back to description-only mode.

#### 2a-discover: Related commit discovery

**Prerequisite:** Step 2a (fetch) must complete first — discovery uses project IDs and commit dates from fetched data.

**Skip conditions (any triggers silent skip):**
- All URL fetches in Step 2a failed AND no `--links` provided (no project/date context)

**Procedure:**

1. **Runtime tool verification:** Call `mcp__gitlab__list_commits` with a minimal query (the first project, `per_page=1`, `since` = 1 hour ago). If the call returns an error indicating the tool does not exist or is unsupported, emit `"⚠ GitLab list_commits 不可用，跳过关联提交发现。"` and skip discovery entirely.

2. **Build discovery queries:** For each unique `project_id` extracted from user-provided URLs:
   - Determine time window: `since` = (earliest user commit date − 30 days), `until` = (latest user commit date + 7 days)
   - Query: `mcp__gitlab__list_commits(project_id, since, until, per_page=100)`
   - Budget: 1 verification call + up to 29 project queries = 30 total cap
   - If no project context is available (no `--links`): skip discovery gracefully with `"⚠ 无项目上下文，跳过关联提交发现。"`

3. **Execution bounds:**
   - **Call cap:** Maximum 30 total `list_commits` API calls (including verification). Stop querying remaining projects if cap reached.
   - **Timeout:** 30-second wall-clock timeout for entire discovery sub-step. If exceeded, use collected results and emit `"⚠ 关联提交发现超时 (30s)，使用已收集的部分结果。"`

4. **Keyword post-filter:** From returned commits, keep only those whose commit message contains at least one keyword from the Step 2b keyword set (the deduplicated 10-15 terms from description + fetched diff file path stems). Discard commits already in user-provided set (by SHA match).

5. **Output:** Store as `discovered_commits[]` with fields: `sha`, `project_id`, `title`, `authored_date`, `web_url` (constructed as `https://{host}/{project_path}/-/commit/{sha}`). Cap at 20 commits (sorted by date, most recent first).

6. **Reporting:** Emit progress: `"发现关联提交: {N} 条 (来自 {M} 个项目, 耗时 {T}s)"`

#### 2b: Build keyword set

1. From description text: extract noun phrases, domain terms, subsystem names
2. Merge with keywords extracted from links/commits (if any)
3. If discovery ran: merge additional keywords from discovered commit messages (noun phrases, identifiers)
4. Deduplicate all keywords, cap at 10-15
5. Group into 3 keyword groups by subsystem area (e.g., HAL-related, Framework-related, App-related)

### Step 3: Phase 1 — Project Discovery

Spawn 3 `aosp-investigator` subagents in parallel. Each investigator is given the full feature context and independently decides what/how to search. The orchestrator does NOT pre-generate search queries — investigators handle search strategy themselves:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Investigate AOSP for the original code related to a VENDOR feature: '<description>'.
  
  This is a third-party/vendor customization, NOT an AOSP built-in feature. The vendor has modified or extended AOSP code to implement this feature.
  
  Vendor modification points (from GitLab diffs):
  <changed file paths, class names, method names, and diff summaries from Step 2>
  
  Your mission: Search AOSP to find the ORIGINAL code that the vendor modifications interact with.
  - Search for the original AOSP classes/interfaces that the vendor code modifies, extends, or calls
  - Follow cross-references: if the vendor modifies an interface, find its original definition, implementations, and callers in AOSP
  - Cover multiple AOSP layers: HAL, native, framework, system services, apps
  - For each finding, document: file path, code snippet, architectural role, and how it relates to the vendor modification points
  
  Report ALL discovered AOSP file paths grouped by theme. Include architectural observations about how the vendor changes hook into the AOSP architecture."
)
```

Collect all investigator reports. Extract unique second-level directory prefixes (first two path segments from AOSP root, e.g., `frameworks/base`, `hardware/interfaces`, `packages/modules/Connectivity`). Store in `discovered_prefixes` set.

### Step 4: Phase 2 — Iterative Expansion

**Depth gate:** If `--depth shallow`, execute exactly 1 round (spawn 2 agents), skip convergence check, and proceed directly to Step 5. If `--depth deep` (or no flag specified), run the full loop below.

Loop up to 5 rounds (max 15 total successful agent spawns across all rounds including Phase 1).

Each round, spawn N `aosp-investigator` subagents where N is determined by discovery rate:
- **Round 1** (first Phase 2 round): spawn 2 agents (baseline, no prior rate available)
- **Subsequent rounds:** if the previous round discovered ≥ 5 new prefixes, spawn 3 agents; otherwise spawn 2 agents
- **Per-round cap:** never exceed 3 agents in a single round
- **Total cap:** 15 successful spawns across all phases (Phase 1 + Phase 2) still applies
- **Tunable constant:** The 5-prefix scaling threshold is an initial heuristic. Adjust based on observed discovery patterns — lower it if features consistently under-explore, raise it if agent spawns are wasted on diminishing returns.

When `--depth shallow` is active, dynamic scaling is moot (only 1 round executes with 2 agents).

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
  
  Your mission: Find AOSP code OUTSIDE the already-discovered areas that the vendor modifications interact with.
  - Search for callers/implementors of the interfaces found so far
  - Look for related AOSP subsystems that the vendor feature depends on or extends
  - Check for configuration, SELinux policies, init scripts, or test code in AOSP related to the modified components
  - Explore upstream/downstream AOSP dependencies not yet covered
  
  Report only NEW findings (paths not in the already-discovered list). Group by theme with observations about how vendor changes hook into these AOSP components."
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

The orchestrator's only heavy-lifting phase — merge and structure all investigator reports into the final document:

1. Concatenate all investigator findings across all rounds
2. Deduplicate findings:
   a. **Exact path dedup:** merge entries with identical file paths (keep the richer observation)
   b. **Overlapping snippet dedup:** if two findings reference the same file with overlapping line ranges, merge into one entry with the broader range
   c. **Semantic dedup:** if two findings describe the same interface/class from different angles, consolidate into one entry combining both observations
3. Group findings by second-level AOSP directory prefix (these become the "projects" in the output)
4. For each project group: collect key interfaces, code patterns, and design decisions reported by investigators
5. Synthesize an overall "Design Principles" section from investigators' architectural observations
6. Map cross-project dependencies from investigators' interface-caller/implementor findings
6b. **Adaptive template sections:**
   - If ≤ 2 discovered project groups AND findings span a single architectural layer: use condensed output (omit summary table, fold interface mentions into project sections)
   - If no AIDL/HIDL interfaces found: omit "关键接口" section header, fold any interface mentions into project sections
   - If only 1 AOSP project discovered: omit the "相关AOSP项目" summary table (redundant with the single project section)
   - If no cross-project dependencies found: omit "依赖关系" section
   - If `discovered_commits[]` is empty (no project context or no matches): omit "发现的关联提交" section
   - **Always include:** 概览, Vendor修改概述, 设计原理, 各项目代码路径, 调查日志
7. **Construct commit URLs:** For each input link's project, build browsable commit URLs using format `https://{host}/{project_path}/-/commit/{sha}`. If the input was an MR, use the MR's source commits. Include these URLs in the output under "Related Commits".
8. Build the output document **in Chinese** using the template below

### Step 5b: Append Mode (if `--append` flag)

If `--append` is NOT set, skip this step entirely.

1. Compute slug from description (same logic as Step 6)
2. Check if `.plugin-state/aosp-exports/<slug>.md` exists
   - If not: emit `"⚠ 未找到已有导出文件，回退到完整模式。"` and proceed normally (append degrades to full mode gracefully — Phase 1 executes as usual)
   - If exists: load the file and extract:
     a. `discovered_prefixes` from the "相关AOSP项目" table
     b. `last_verified` timestamp from the metadata section
     c. All previously documented file paths

3. **Staleness check:**
   - Parse `last_verified` from the existing document's metadata section
   - If `last_verified` is older than 30 days: emit warning to user: `"⚠ 上次验证已超过30天 ({date})。建议不使用 --append 重新完整导出。"`
   - Proceed regardless (warning only, not blocking)

4. **Inject prior context into Phase 2:**
   - Skip Phase 1 (Step 3) entirely — use loaded prefixes as the starting set for `discovered_prefixes`
   - In Phase 2 agent prompts, include loaded prefixes in the "Previously discovered" list
   - Phase 2 runs normally (respecting `--depth` flag), searching only for NEW findings

5. **Merge strategy:**
   - New findings are APPENDED to existing sections (not replacing)
   - Duplicate file paths are deduplicated (keep the newer observation)
   - Update `last_verified` timestamp to current date
   - Update convergence stats to reflect the append run

**Known limitation:** If the AOSP codebase has undergone major directory renames or module splits since the last export, stale prefixes may send Phase 2 agents down dead paths. In this case, re-run without `--append` for a fresh full export.

### Step 6: Save

1. Generate slug from description: lowercase, replace spaces/special chars with hyphens, max 50 chars
2. Create `.plugin-state/aosp-exports/` directory if it doesn't exist
3. Write output to `.plugin-state/aosp-exports/<slug>.md`
4. Call `Bash: rm -f .plugin-state/aosp-feature-export-state.json`
5. Confirm to user: `Feature export saved to .plugin-state/aosp-exports/<slug>.md`

### Error Recovery

On any unrecoverable error after Step 0:
- If agent data has been collected, write partial results to `.plugin-state/aosp-exports/<slug>-partial.md`
- Call `Bash: rm -f .plugin-state/aosp-feature-export-state.json`
- Report the error to the user

Skill is idempotent — re-running with the same inputs overwrites the output file.

## Output Template

```markdown
# Vendor功能元导出: {feature_name}

## 概览
- **功能:** {description}
- **类型:** Vendor/第三方定制功能
- **AOSP项目:** {project_name from .plugin-state/aosp-config.json, or "未配置"}
- **导出日期:** {date}
- **输入链接:** {url_list or "无"}
- **输入提交:** {commit_list or "无"}
- **提取关键词:** {keyword_list}
- **搜索轮次:** {n}/5
- **发现AOSP关联项目数:** {count}
- **收敛情况:** {在第X轮收敛 / 达到最大轮次}
- **关联提交发现:** {启用/未启用} {如启用: "发现 N 条, 耗时 Xs" / "工具不可用，已跳过" / "超时，部分结果"}

## Vendor修改概述

{基于GitLab diff的vendor改动摘要。说明vendor修改了哪些文件、增加了什么逻辑、修改的入口点在哪里。}

## 设计原理

{AI综合说明该vendor功能如何嵌入AOSP架构。涵盖vendor代码的hook点、对AOSP原有逻辑的修改方式、跨层交互模式。}

## 相关AOSP项目

| 项目 | 路径 | 层级 | 与Vendor功能的关系 |
|------|------|------|-------------------|
| {name} | {aosp_path} | {HAL/Framework/System/App} | {vendor如何修改或依赖此项目} |
| ... | ... | ... | ... |

## 关键接口

### {接口名称}
- **文件:** {aosp/path/to/file}
- **类型:** AIDL / HIDL / Java API / Native / JNI
- **AOSP原始用途:** {该接口在AOSP中的原始作用}
- **Vendor修改方式:** {vendor如何修改、扩展或调用此接口}
- **代码片段:**
  ```
  {relevant code excerpt}
  ```

## 各项目代码路径

### {项目名称} ({aosp_path_prefix})
- **关键文件:**
  - `{file_path}`: {用途}
  - `{file_path}`: {用途}
- **Vendor相关提交:**
  - [{commit_message}]({https://gitlab.host/project_path/-/commit/full_sha}) ({date})
- **设计说明:** {vendor代码如何hook进此AOSP项目}

## 架构总览

{Vendor功能如何跨越Android各层嵌入: App → Framework → Native → HAL → Kernel。标注vendor修改点与AOSP原始代码的边界。}

## 依赖关系

- Vendor功能依赖 {AOSP项目A} 的 {接口/机制}
- Vendor功能修改了 {AOSP项目B} 的 {类/方法}
- ...

## 发现的关联提交

> 以下提交通过关联提交发现自动获取，非用户直接提供。基于项目时间窗口和关键词匹配筛选。

| 项目 | SHA | 提交信息 | 日期 | 链接 |
|------|-----|----------|------|------|
| {project_path} | {short_sha} | {title} | {date} | [查看]({web_url}) |
| ... | ... | ... | ... | ... |

**发现参数:** 时间窗口 {since} ~ {until}, 关键词匹配 {keyword_count} 个, 扫描项目 {project_count} 个

## 调查日志

| 轮次 | 查询 | 新增前缀 | 总前缀数 | 总文件数 |
|------|------|----------|----------|----------|
| 1 (发现) | {keyword groups} | {n} | {n} | {n} |
| 2 | {new queries} | {n} | {n} | {n} |
| ... | ... | ... | ... | ... |
| {final} | {queries} | {n} | {n} | {n} |

**终止原因:** {收敛 (< 3个新前缀) / 达到最大轮次 / 部分失败}

## 元数据

- **上次验证:** {last_verified date}
- **更新模式:** {完整导出 / 增量追加}
- **增量历史:** {append count, if applicable}
```

## Keyword Triggers

- `"aosp export"`, `"aosp feature export"`, `"功能元导出"`, `"feature export"`

## Configuration

- Output directory: `.plugin-state/aosp-exports/` (fixed)
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

- **Multi-project:** Only searches within projects referenced by user-provided `--links` URLs. No cross-project or group-level discovery. (Future: GitLab group-level commit search or cross-reference via MR links.)
- **Precision:** Project-scoped (not path-filtered). Keyword filtering reduces noise but may miss semantically related commits with different terminology. (Future: path-level filtering for higher precision.)
- **Tool dependency:** Requires `mcp__gitlab__list_commits` from the GitLab MCP server. Silently skipped if unavailable.
- **Append interaction:** Discovered commits are included in append-mode dedup (by SHA). Re-running with `--append` will not duplicate previously discovered commits.
