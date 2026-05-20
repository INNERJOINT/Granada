---
name: jira-analyze
description: Android bug root-cause analysis via JIRA logs, AOSP source search, and parallel hypothesis investigation. Report in Chinese, posted as JIRA comment.
argument-hint: <JIRA URL or issue key> [--project <name>]
model: opus
triggers:
  - "jira analyze"
  - "jira_analyze"
  - "jira rca"
  - "analyze jira"
handoff: .granada/specs/jira-analyze-{issue_key}.md
level: 3
---

<Purpose>
Automates Android bug root-cause analysis by fetching JIRA issue details via mcp-atlassian, downloading and decompressing zip attachments containing Android system logs (logcat, tombstone, ANR traces, kernel logs), parsing them into a chronological timeline, searching AOSP source code for crash-related context, generating and investigating hypotheses in parallel, and producing a structured 7-section Chinese RCA report posted as a JIRA comment.
</Purpose>

<Use_When>
- User has an Android JIRA bug with log attachments and wants root-cause analysis
- User says "jira analyze", "jira_analyze", "jira rca", or "analyze jira"
- User provides a JIRA URL or issue key containing Android crash/ANR/kernel panic logs
- User wants to correlate Android system logs with AOSP source code
</Use_When>

<Do_Not_Use_When>
- Issue has no log attachments — nothing to parse
- Logs are from iOS or non-Android platforms
- User wants interactive conversational analysis — this produces a static report
- User already has parsed logs and just needs AOSP source lookup — use aosp-plan directly
</Do_Not_Use_When>

<Steps>

## Phase 1: Initialize

1. **Parse `{{ARGUMENTS}}`** to extract the issue key and optional flags:
   - Extract `--project <value>` if present (pattern `--project\s+(\S+)`); store as project override (or null if absent). Strip the flag from arguments before issue key parsing.
   - Extract `--fresh` if present (boolean flag). Strip from arguments.
   - URL pattern: extract key from `https://<domain>/browse/<KEY>` via regex
   - Direct key pattern: validate `^[A-Z][A-Z0-9_]+-\d+$`
   - If neither matches, abort with: "Could not parse JIRA issue key from input. Provide a URL (https://jira.example.com/browse/PROJ-123) or key (PROJ-123)."

1b. **Resume check** (before MCP health checks):
   - If `--fresh` flag is present: remove `.granada/jira-analyze-state.json`; remove `/tmp/jira-analyze-<KEY>` only after the issue key has passed `^[A-Z][A-Z0-9_]+-\d+$`, quote the target, and use `rm -rf -- "$target"`, then proceed as fresh run.
   - Otherwise, read existing state: `Read .granada/jira-analyze-state.json`
   - If state exists AND `active == true` AND `state.issue_key` matches current `<KEY>`:
     - Display: "检测到未完成的分析 (phase: <current_phase>)。从断点恢复..."
     - Validate temp directory exists: `ls /tmp/jira-analyze-<KEY>`
     - Validate phase artifacts before skipping:
       - Skip to Phase 3: verify `/tmp/jira-analyze-<KEY>/extracted/` has files
       - Skip to Phase 4: verify `anomalies.md` contains at least one `### Anomaly` or `### Rank` heading
       - Skip to Phase 5: verify `aosp-context.md` contains at least one `###` section heading
       - Skip to Phase 6: verify `hypotheses.md` contains at least one `## Hypothesis` heading AND at least one `investigation-*.md` contains a `**Confidence:**` line
     - Resume from the NEXT phase after `current_phase`:
       - `initialize` → start Phase 2
       - `data-collected` → start Phase 3
       - `parsed` → start Phase 4
       - `aosp-searched` → start Phase 5
       - `investigated` → start Phase 6
     - If temp directory missing OR artifact validation fails: restart from the failed phase (not Phase 1)
   - If state exists but `issue_key` does NOT match: clear old state, start fresh
   - If no state exists: start fresh (normal flow)

2. **MCP health checks** (run both in parallel):
   - JIRA: call `jira_get_issue(issue_key=<KEY>, fields="summary")` — if fails, abort with "mcp-atlassian unreachable. Check JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN env vars."
   - AOSP: call `sourcepilot(tool="list_tools")` — if fails, abort with "sourcepilot MCP unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."

3. **Display active AOSP project**:
   - If `--project` override was provided: display `**🔍 AOSP Project: <name> (命令行指定)**` and use this value for all subsequent phases. Skip reading `.granada/aosp-config.json`.
   - Otherwise, read `.granada/aosp-config.json`:
     - If configured: display `**🔍 AOSP Project: <project_name>**` prominently
     - If not configured: display `**⚠ 未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`
   (When no `--project` override is provided, the `aosp-investigator` subagent reads this config and passes `project` to search calls automatically. When `--project` is provided, the override is passed explicitly in subagent prompts — see Phase 4 and Phase 5.)

4. **Initialize state**:
```
Write JSON to .granada/jira-analyze-state.json with, active=true, current_phase="initialize", state={
  "issue_key": "<KEY>",
  "temp_dir": "/tmp/jira-analyze-<KEY>",
  "issue_summary": null,
  "attachment_meta": "[]",
  "log_file_types": "{}",
  "anomaly_count": "0",
  "hypothesis_count": "0",
  "report_path": null,
  "project_override": "<name>|null"
})
```

5. **Create temp directory**:
```bash
mkdir -p /tmp/jira-analyze-<KEY>/extracted
```

## Phase 2: JIRA Data Collection (via aosp-log-collector Agent)

Delegate all JIRA issue metadata, attachment collection, archive unpacking, fallback log download, file organization, and file classification to `aosp-log-collector`.

1. **Spawn the aosp-log-collector agent**:

```
Agent(
  subagent_type="zaku:aosp-log-collector",
  model="sonnet",
  prompt="Collect Android logs for JIRA issue <KEY>.

Mode: JIRA
Issue key: <KEY>
Temp directory: /tmp/jira-analyze-<KEY>/
Extracted directory: /tmp/jira-analyze-<KEY>/extracted/
Classification manifest: /tmp/jira-analyze-<KEY>/file-classification.json

Fetch issue details with comments excluded, collect log attachments or fallback logs, populate the extracted directory, and generate the classification manifest. Report issue summary, attachment metadata, collection summary, per-type counts, and Collection status."
)
```

2. **Verify collection output**: After the agent completes, check that `/tmp/jira-analyze-<KEY>/extracted/` contains files and `/tmp/jira-analyze-<KEY>/file-classification.json` exists. If the collector reports FAILED or either artifact is missing, abort with "Log collection failed — extracted logs or classification manifest missing."

3. **Update state**: `current_phase: "data-collected"`, persist `attachment_meta` and `log_file_types` from the collector summary.

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-3 -->
## Phase 3: Log Parsing and Timeline Construction (via aosp-log-parser Agent)

Delegate all log parsing to a single `aosp-log-parser` agent. This agent reads the collector-generated file classification, runs all 4 log type parsers, and performs the merge/synthesis step internally.

### Spawn aosp-log-parser Agent

```
Agent(
  subagent_type="zaku:aosp-log-parser",
  model="sonnet",
  prompt="Parse Android log files for JIRA issue <KEY>.

Temp directory: /tmp/jira-analyze-<KEY>/
Source files directory: /tmp/jira-analyze-<KEY>/extracted/
Classification manifest: /tmp/jira-analyze-<KEY>/file-classification.json

Read the collector-generated classification manifest first, parse each listed log type using parallel tool calls where possible, then merge into unified timeline.md and anomalies.md. Abort if the manifest is missing or inconsistent with the extracted directory.

Report the total anomaly count at the end of your response."
)
```

### Verify Output

After the agent completes, check that `/tmp/jira-analyze-<KEY>/timeline.md` and `/tmp/jira-analyze-<KEY>/anomalies.md` exist. If not, abort with "Log parsing failed — timeline or anomalies output missing."

Update state: `current_phase: "parsed"`, `anomaly_count: <N>` (from the agent's summary).

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-4 -->
## Phase 4: AOSP Source Context Analysis

Before hypothesis investigation, perform a dedicated AOSP source search based on crash signatures extracted from anomalies. This phase is **mandatory** — skip only if you are absolutely certain the issue has zero relevance to AOSP code (e.g., purely app-layer business logic with no framework/system interaction).

### Extract Search Targets

Read `/tmp/jira-analyze-<KEY>/anomalies.md` and extract:
- Java/native class names from stack traces (e.g., `SurfaceFlinger`, `ActivityManagerService`, `InputDispatcher`)
- Native library names (e.g., `libsurfaceflinger.so`, `libbinder.so`)
- Kernel subsystem identifiers (e.g., `mm/slub.c`, `drivers/gpu/`)
- Signal/error patterns (e.g., `SIGSEGV`, `SIGABRT`, specific error messages)

### Parallel AOSP Search (via Subagents)

Group search targets into 2-3 clusters by subsystem, then spawn one aosp-investigator per cluster **in parallel**:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="sonnet",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL sourcepilot search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Search AOSP source code for the following crash-related classes/functions from JIRA issue <KEY>.

Search targets:
<list of class names, function names, native libraries from anomalies>

For each target:
1. Use sourcepilot — first call {tool: 'list_tools'} to discover available tools
2. Search for the class/function definition in AOSP
3. Find error handling code paths, especially around the crash point
4. Look for related comments, TODOs, known limitations
5. Check if there are CTS tests or known failure patterns

Report for each target:
- **AOSP file path** and relevant line numbers
- **Code snippet** (the function/method containing the crash point)
- **Error handling analysis**: how does this code handle the failure mode seen in the crash?
- **Related patterns**: similar crash patterns, known issues, defensive checks"
)
```

### Collect AOSP Context

- Merge all AOSP investigator results into `/tmp/jira-analyze-<KEY>/aosp-context.md`
- This file feeds into both hypothesis investigation (Phase 5) and the final report (Section 4)
- If AOSP search returns no results for a target, note it as a gap — do not silently omit

Update state: `current_phase: "aosp-searched"`.

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-5 -->
## Phase 5: Hypothesis Generation and Parallel Investigation

### Hypothesis Generation (via Subagent)

Spawn an analyst subagent to generate hypotheses from the anomalies:

```
Agent(
  subagent_type="zaku:analyst",
  model="sonnet",
  prompt="Analyze Android crash anomalies for JIRA issue <KEY> and generate root-cause hypotheses.

Read the anomalies file: /tmp/jira-analyze-<KEY>/anomalies.md
Read the timeline file: /tmp/jira-analyze-<KEY>/timeline.md
Read the AOSP context file: /tmp/jira-analyze-<KEY>/aosp-context.md (use AOSP findings to inform and strengthen hypotheses)

Generate 2-3 root-cause hypotheses. Each hypothesis must have:
- Title (one-line description)
- Supporting anomaly references (which timeline events support it)
- Relevant AOSP source context (which AOSP code paths are involved, error handling gaps found in Phase 4)
- **Covered by Phase 4 context:** list aosp-context.md sections whose class/function names appear in this hypothesis's stack frames or supporting anomalies (these are already searched — investigators will NOT re-search them)
- **New investigation targets:** code paths NOT already in aosp-context.md that need searching
- Key stack frames to investigate in AOSP source code

Prioritize hypotheses by:
1. Fatal/crash events over warnings
2. Earliest anomaly in timeline over later ones
3. System-level crashes over app-level

Save output to /tmp/jira-analyze-<KEY>/hypotheses.md in this format:

## Hypothesis 1: <title>
**Supporting anomalies:** <list of anomaly references>
**Covered by Phase 4 context:** <list of already-searched targets from aosp-context.md>
**New investigation targets:** <list of targets NOT in aosp-context.md>
**Stack frames to investigate:**
- <frame1>
- <frame2>

## Hypothesis 2: ...
(repeat for each hypothesis)"
)
```

Read the generated hypotheses from `/tmp/jira-analyze-<KEY>/hypotheses.md`.

### Parallel Investigation via Agent Tool

Spawn one agent per hypothesis (max 3). Each agent receives Phase 4 context to avoid redundant searches:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="sonnet",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL sourcepilot search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Investigate this Android crash hypothesis for JIRA issue <KEY>:

Hypothesis: <hypothesis_title>

## Pre-existing AOSP Context (from Phase 4 — DO NOT re-search these)

The following AOSP source findings are already available. Use them directly as evidence.
Only perform NEW sourcepilot searches for code paths NOT covered below.

<Include aosp-context.md sections whose search target class/function names appear in
the hypothesis's 'Stack frames to investigate' or 'Supporting anomalies'. Filter by
string match of class/function names.>

## Incremental Investigation Task

Search ONLY for:
- Code paths listed in 'New investigation targets' above
- Caller/callee relationships of already-found functions
- Error propagation paths between known crash points
- Concurrency/timing interactions between components

Timeline context:
<relevant_timeline_events>

Report format:
- AOSP source files and line numbers relevant to this crash
- Code context (what the function does, error handling patterns)
- Evidence FOR this hypothesis
- Evidence AGAINST this hypothesis
- Confidence: high/medium/low with rationale"
)
```

**IMPORTANT:** Spawn all hypothesis agents in parallel (they are independent).

### Collect Results

- Wait for all agents to complete
- Parse each agent's findings into structured format
- Save to `/tmp/jira-analyze-<KEY>/investigation-<N>.md`
- If an agent fails or times out, mark that hypothesis as "investigation incomplete" — do not fail the entire skill
- Update state: `current_phase: "investigated"`, `hypothesis_count: <N>`

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-6 -->
## Phase 6: Synthesis and Report

1. **Read investigation results** from `/tmp/jira-analyze-<KEY>/investigation-*.md` and `/tmp/jira-analyze-<KEY>/aosp-context.md`

2. **Rank hypotheses** by confidence (from investigation results)

3. **Build the 7-section Chinese report** and save to `.granada/specs/jira-analyze-{issue_key}.md` after redacting common secrets from all included log excerpts and issue text (authorization headers, bearer tokens, API keys, passwords, access/refresh/id tokens, cookies, session IDs, private keys, and signed URL token/key/signature query values):

```markdown
<!-- Downstream dependency: jira-aftersales skill detects reports by this title format. Do not change without updating jira-aftersales. -->
# 根因分析报告: {issue_key} — {issue_title}

**生成时间:** {date}
**问题链接:** {jira_url}
**状态:** {status} | **经办人:** {assignee} | **优先级:** {priority}

## 1. 问题概述
{issue_description_summary}

## 2. 事件时间线
| 时间 | 来源 | 严重程度 | 事件 |
|------|------|----------|------|
| {timestamp} | {logcat/tombstone/ANR/kernel} | {INFO/WARN/ERROR/FATAL} | {description} |

## 3. 关键异常/错误
### 异常 1: {title}
- **严重程度:** {FATAL/ERROR/WARN}
- **来源:** {file}:{line}
- **堆栈信息:**
  {stack_trace}

## 4. AOSP 源码分析
{从 Phase 4 AOSP 源码上下文分析阶段收集的完整源码分析结果}

### 4.1 关键代码路径
{针对每个崩溃相关的类/函数，列出 AOSP 源码路径、代码片段和功能说明}

#### {class_or_function_name} — {aosp_file_path}
- **源码位置:** `{aosp/path/to/file.java}:{line_range}`
- **代码片段:**
  ```java
  // 相关代码摘录（含行号）
  ```
- **功能说明:** {该函数/类的作用}
- **与崩溃的关联:** {此代码如何与日志中观察到的崩溃行为相关}
- **错误处理分析:** {该代码对故障模式的处理方式，是否存在处理缺口}

### 4.2 已知问题与模式
{AOSP 源码中发现的相关 TODO、FIXME、已知限制、相似崩溃模式}

### 4.3 源码搜索缺口
{搜索未返回结果的目标，可能需要进一步人工排查的部分}

## 5. 根因假设排名
| 排名 | 假设 | 置信度 | 关键证据 |
|------|------|--------|----------|
| 1 | {title} | {高/中/低} | {evidence_summary} |

### 假设 1: {title} (置信度: {level})
**支持证据:**
- {point}
**反对证据:**
- {point}
**AOSP 上下文:** {relevant_source_findings}

## 6. 受影响组件图
{ASCII diagram showing affected Android subsystems and their relationships}

## 7. 建议修复方案
1. {action with specific file/component reference}
2. {action}
```

<!-- /SYNC -->

5. **Post report as JIRA comment**: `jira_add_comment(issue_key=<KEY>, body=<redacted_report_content>)` — post the redacted report content as a comment on the JIRA issue. If this fails, warn but do not abort (the local report file is still available).

6. **Finalize state and cleanup**:
   - On success: `Bash: rm -f .granada/jira-analyze-state.json` — terminal exit
   - On error-abort: `Write {"active": false, current_phase="error"} to .granada/jira-analyze-state.json` — preserves state for debugging
   - Announce report location to user

</Steps>

<Error_Handling>
Embed these handlers throughout all phases:

- **MCP unreachable** → abort with specific message naming which MCP failed and env vars to check
- **Collector reports FAILED** → abort with the collector's failure reason
- **Collector reports PARTIAL** → continue only if `extracted/` and `file-classification.json` exist and include parseable logs
- **No parseable logs found** → abort with "No Android log files found in collected artifacts"
- **AOSP search returns no results** → note "no AOSP source found" in report, do not fail
- **Agent timeout/failure** → mark hypothesis as "investigation incomplete", continue with others
- **All hypotheses fail investigation** → report with "insufficient evidence" conclusion
- **JIRA comment post fails** → warn user, do not abort (local report file is still available)
</Error_Handling>

<State_Schema>
```json
{
  "mode": "jira-analyze",
  "active": true,
  "current_phase": "initialize | data-collected | parsed | aosp-searched | investigated | complete | error",
  "state": {
    "issue_key": "string",
    "temp_dir": "/tmp/jira-analyze-<KEY>",
    "issue_summary": "string (title only)",
    "attachment_meta": "[{\"filename\": \"\", \"type\": \"\", \"size_bytes\": 0}]",
    "log_file_types": "{\"filename\": \"logcat|tombstone|anr|kernel|other\"}",
    "anomaly_count": "0",
    "hypothesis_count": "0",
    "report_path": "string|null",
    "project_override": "string|null"
  }
}
```

State is lightweight (<10KB). Parsed data lives in temp files (`/tmp/jira-analyze-<KEY>/`), not in state.

Update state at each phase boundary for resumability. On resume, read state via `Read .granada/jira-analyze-state.json` and continue from `current_phase`.
</State_Schema>

<Tool_Usage>
- `jira_get_issue` — Phase 1 JIRA health check (mcp-atlassian)
- `Agent(subagent_type="zaku:aosp-log-collector", model="sonnet")` — JIRA issue metadata, log attachment collection, archive handling, extracted directory preparation, and classification manifest generation (Phase 2)
- `Agent(subagent_type="zaku:aosp-log-parser", model="sonnet")` — log parsing and timeline construction from the collector-generated classification manifest (Phase 3)
- `Agent(subagent_type="zaku:analyst", model="sonnet")` — hypothesis generation (Phase 5)
- `Agent(subagent_type="zaku:aosp-investigator", model="sonnet")` — AOSP source search (Phase 4) and parallel hypothesis investigation (Phase 5)
- `jira_add_comment` — post RCA report as comment on JIRA issue (mcp-atlassian)
- `sourcepilot` — search AOSP source for crash-related code (always, not conditional)
- `Write` / `Read` / `Bash rm` — phase persistence via .granada/jira-analyze-state.json and final report output
</Tool_Usage>

<Examples>
<Good>
```
User: /jira-analyze https://jira.cvte.com/browse/SPFB-535

[Phase 1] Parsed key: SPFB-535. MCP health checks pass (jira + aosp).
[Phase 2] Spawned aosp-log-collector agent.
         Collection complete → 12 files classified: 3 logcat, 2 tombstone, 1 ANR, 1 kernel, 5 other.
         Issue summary and attachment metadata captured from collector output.
[Phase 3] Spawned aosp-log-parser agent.
         Completed → 847 timeline events, 23 anomalies.
         Top anomalies: SIGSEGV in libsurfaceflinger.so, ANR in SystemUI, kernel BUG at mm/slub.c.
[Phase 4] AOSP Source Context: Spawned 2 aosp-investigator agents in parallel.
         Cluster 1 (SurfaceFlinger/SystemUI): Found SurfaceFlinger::onMessageReceived null check gap,
         SystemUI binder thread pool config in ActivityManagerService.
         Cluster 2 (kernel/mm): Found mm/slub.c slab corruption detection path, related TODO comments.
         Saved aosp-context.md with 8 AOSP source findings.
[Phase 5] Spawned analyst subagent → generated 3 hypotheses (informed by AOSP context):
         H1: SurfaceFlinger null pointer dereference (FATAL, earliest)
         H2: SystemUI ANR from binder thread exhaustion (ERROR)
         H3: Kernel slab corruption causing downstream crashes (FATAL)
         Spawned 3 aosp-investigator agents in parallel.
         H1: HIGH confidence — found matching code path in SurfaceFlinger::onMessageReceived
         H2: MEDIUM — binder thread pool config matches but no direct evidence
         H3: LOW — kernel log timing doesn't correlate with userspace crashes
[Phase 5] Report saved to .granada/specs/jira-analyze-SPFB-535.md (Chinese, 7 sections).
         Posted report as JIRA comment on SPFB-535.
```
Why good: All exploration delegated to subagents. Log collection and classification are handled by aosp-log-collector; aosp-log-parser consumes the manifest and builds timeline/anomalies; hypothesis generation and AOSP investigation run in separate subagents. Lead only orchestrates. Report in Chinese, posted to JIRA.
</Good>

<Bad>
```
User: /jira-analyze SPFB-535
[Phase 2] Main skill performs attachment download, decode, unpack, and cleanup itself.
```
Why bad: Collection implementation details belong in `aosp-log-collector`; the main skill should only orchestrate and verify collector outputs.
</Bad>

<Bad>
```
[Phase 4] Only searched AOSP for the top hypothesis, skipped others.
```
Why bad: AOSP search must run for ALL hypotheses, not just the highest-ranked one.
</Bad>
</Examples>

<Guardrails>
**Must have:**
- `aosp-log-collector` subagent for JIRA issue metadata, log collection, archive handling, extracted directory preparation, and classification manifest generation
- `aosp-log-parser` subagent for parsing the collector-generated classification manifest, timeline merge, and anomaly merge
- mcp-atlassian for JIRA access (not jira-cli)
- sourcepilot for AOSP source (always, not conditional) — **Phase 4 AOSP 源码分析是必选阶段**，除非十分确认问题与 AOSP 源码完全无关才可跳过
- aosp-investigator subagent for both Phase 4 (AOSP context) and Phase 5 (hypothesis investigation)
- Lightweight state (<10KB, file paths not data)
- All 7 report sections (in Chinese)
- Report posted as JIRA comment via jira_add_comment
- Lead only orchestrates: MCP calls, state management, subagent spawning, report assembly

**Must NOT have:**
- Interactive/conversational mode (produces static report)
- iOS or non-Android log parsing
- Binary attachment processing (images, videos)
- Inline download, decompression, base64, or cleanup command details in this skill; those belong in `aosp-log-collector`
</Guardrails>
