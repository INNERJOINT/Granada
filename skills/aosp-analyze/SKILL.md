---
description: Android system issue root-cause analysis via AOSP source search, with optional local log files for evidence-driven analysis. Report in Chinese, saved locally.
argument-hint: '[<log directory path>] [--project <name>] --title <description>'
model: opus
triggers:
  - "aosp analyze"
  - "aosp_analyze"
  - "aosp rca"
  - "analyze logs"
  - "crash analyze"
  - "aosp source analyze"
  - "aosp 分析"
handoff: .granada/specs/aosp-analyze-{slug}.md
level: 3
---

<Purpose>
Automates Android system issue root-cause analysis. Supports two modes:
- **Log-based mode** (full): Accepts a directory of extracted Android system logs (logcat, tombstone, ANR traces, kernel logs). Parses logs into a chronological timeline, searches AOSP source code for crash-related context, generates and investigates hypotheses in parallel, and produces a structured 7-section Chinese RCA report.
- **No-log mode** (logless): Accepts a text description of the problem (via `--title`). Extracts search targets from the description, searches AOSP source code directly, generates hypotheses based on source analysis, and produces the same 7-section report structure (with sections 2/3 noting the absence of log evidence).

Both modes save the report to `.granada/specs/`.
</Purpose>

<Use_When>
- User has Android crash logs (logcat, tombstone, ANR, kernel) in a local directory and wants root-cause analysis
- User describes an Android system problem and wants AOSP source-level analysis without logs
- User says "aosp analyze", "aosp_analyze", "aosp rca", "analyze logs", "crash analyze", "aosp 分析"
- User provides a directory path containing extracted Android log files
- User wants to correlate Android system logs with AOSP source code
</Use_When>

<Do_Not_Use_When>
- Logs are from iOS or non-Android platforms
- User wants to fetch logs from JIRA — use jira-analyze instead
- User wants interactive conversational analysis — this produces a static report
- User wants a code modification plan or implementation steps — use aosp-plan instead (aosp-plan outputs action plans; aosp-analyze outputs RCA reports)
</Do_Not_Use_When>

<Steps>

## Phase 1: Initialize

1. **Parse `{{ARGUMENTS}}`** to extract the input path and optional flags:

   - `--project <value>` (pattern `--project\s+(\S+)`): Store as project override (or null if absent). Strip the flag from arguments.
   - `--title <value>` (pattern `--title\s+(.+?)(?:\s+--|\s*$)`): Store as user-provided issue description. Strip the flag.
   - `--dir <path>`: Directory containing extracted Android log files.
   - `--fresh` (boolean flag): Force clean start. Strip from arguments.

   **Input path resolution**:
   1. If `--dir <path>` is provided and the path exists: use as the log directory. Set `analysis_mode = "log-based"`.
   2. If the first positional argument (after stripping flags) is a valid path to a directory: treat as `--dir`. Set `analysis_mode = "log-based"`.
   3. If no valid log directory found but `--title` is provided: Set `analysis_mode = "no-log"`. No log directory needed.
   4. If no valid log directory AND no `--title`: abort with:
      ```
      No log directory or issue description provided. Provide one of:
        --dir <path>          Directory of extracted Android logs (log-based analysis)
        --title <description> Problem description (no-log source analysis)
        <path>                Shorthand for --dir
      ```

1b. **Resume check** (after input parsing, before slug generation):
   - If `--fresh` flag is present: remove `.granada/aosp-analyze-state.json`; remove `/tmp/aosp-analyze-<slug>` only after validating `slug` matches `^[A-Za-z0-9._-]{1,40}$`, contains no `..` or path separators, and the resolved target starts with `/tmp/aosp-analyze-`. Quote the target and use `rm -rf -- "$target"`, then proceed as fresh run.
   - Otherwise, read existing state: `Read .granada/aosp-analyze-state.json`
   - If state exists AND `active == true` AND `state.input_path` matches current input (or `state.slug` matches derived slug):
     - Display: "检测到未完成的分析 (phase: <current_phase>)。从断点恢复..."
     - Validate temp directory exists: `ls /tmp/aosp-analyze-<slug>`
     - Validate phase artifacts before skipping:
       - Skip to Phase 3: verify `/tmp/aosp-analyze-<slug>/extracted/` has files
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
   - If state exists but input does NOT match: clear old state, start fresh
   - If no state exists: start fresh (normal flow)

2. **Generate a slug** from the input for naming temp files and reports:
   - Log-based mode: slug = basename of the directory (lowercase, special chars → hyphens)
   - No-log mode: slug = first 40 chars of `--title` (lowercase, Chinese → pinyin initials or keep as-is, special chars → hyphens)
   - Max 40 chars, truncate if needed.

3. **MCP health check**:
   - AOSP: call `sourcepilot(tool="list_tools")` — if fails, abort with "sourcepilot MCP unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."

4. **Display active AOSP project**:
   - If `--project` override was provided: display `**AOSP Project: <name> (命令行指定)**` and use this value for all subsequent phases. Skip reading `.granada/aosp-config.json`.
   - Otherwise, read `.granada/aosp-config.json`:
     - If configured: display `**AOSP Project: <project_name>**` prominently
     - If not configured: display `**未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

5. **Initialize state**:
```
Write JSON to .granada/aosp-analyze-state.json with, active=true, current_phase="initialize", state={
  "slug": "<slug>",
  "temp_dir": "/tmp/aosp-analyze-<slug>",
  "analysis_mode": "log-based|no-log",
  "input_path": "<absolute path to log directory>|null",
  "issue_title": "<user-provided title or null>",
  "log_file_types": "{}",
  "anomaly_count": "0",
  "hypothesis_count": "0",
  "report_path": null,
  "project_override": "<name>|null"
})
```

6. **Create temp directory**:
```bash
mkdir -p /tmp/aosp-analyze-<slug>/extracted
```

## Phase 2: Log Collection (via aosp-log-collector Agent)

> **Mode gate:** If `analysis_mode == "no-log"`, skip Phase 2 and Phase 3 entirely. Update state: `current_phase: "parsed"`, then proceed directly to Phase 4.

Delegate all local log directory copying/linking, file organization, and file classification to `aosp-log-collector`.

1. **Spawn the aosp-log-collector agent**:

```
Agent(
  subagent_type="zaku:aosp-log-collector",
  model="sonnet",
  prompt="Collect Android logs for analysis <slug>.

Mode: Local directory
Input path: <input_path>
Temp directory: /tmp/aosp-analyze-<slug>/
Extracted directory: /tmp/aosp-analyze-<slug>/extracted/
Classification manifest: /tmp/aosp-analyze-<slug>/file-classification.json

Populate the extracted directory from the input path and generate the classification manifest. Report collection summary, per-type counts, and Collection status."
)
```

2. **Verify collection output**: After the agent completes, check that `/tmp/aosp-analyze-<slug>/extracted/` contains files and `/tmp/aosp-analyze-<slug>/file-classification.json` exists. If the collector reports FAILED or either artifact is missing, abort with "Log collection failed — extracted logs or classification manifest missing."

3. **Update state**: `current_phase: "data-collected"`, persist `log_file_types` from the collector summary.

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-3 -->
## Phase 3: Log Parsing and Timeline Construction (via aosp-log-parser Agent)

Delegate all log parsing to a single `aosp-log-parser` agent. This agent reads the collector-generated file classification, runs all 4 log type parsers, and performs the merge/synthesis step internally.

1. **Spawn the aosp-log-parser agent**:

```
Agent(
  subagent_type="zaku:aosp-log-parser",
  model="sonnet",
  prompt="Parse Android log files for analysis <slug>.

Temp directory: /tmp/aosp-analyze-<slug>/
Source files directory: /tmp/aosp-analyze-<slug>/extracted/
Classification manifest: /tmp/aosp-analyze-<slug>/file-classification.json

Read the collector-generated classification manifest first, parse each listed log type, then merge into unified timeline.md and anomalies.md. Abort if the manifest is missing or inconsistent with the extracted directory.

Report the total anomaly count at the end of your response."
)
```

2. **Verify output**: After the agent completes, check that `/tmp/aosp-analyze-<slug>/timeline.md` and `/tmp/aosp-analyze-<slug>/anomalies.md` exist. If not, abort with "Log parsing failed — timeline or anomalies output missing."

3. **Update state**: `current_phase: "parsed"`, `anomaly_count: <N>` (from the agent's summary).

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-4 -->
## Phase 4: AOSP Source Context Analysis

Before hypothesis investigation, perform a dedicated AOSP source search based on crash signatures extracted from anomalies (log-based mode) or from the problem description (no-log mode). This phase is **mandatory**.

### Extract Search Targets

**Log-based mode (`analysis_mode == "log-based"`):**

Read `/tmp/aosp-analyze-<slug>/anomalies.md` and extract:
- Java/native class names from stack traces (e.g., `SurfaceFlinger`, `ActivityManagerService`, `InputDispatcher`)
- Native library names (e.g., `libsurfaceflinger.so`, `libbinder.so`)
- Kernel subsystem identifiers (e.g., `mm/slub.c`, `drivers/gpu/`)
- Signal/error patterns (e.g., `SIGSEGV`, `SIGABRT`, specific error messages)

**No-log mode (`analysis_mode == "no-log"`):**

Spawn an analyst subagent to extract structured search targets from the problem description:

```
Agent(
  subagent_type="zaku:analyst",
  model="sonnet",
  prompt="从以下 Android 系统问题描述中提取 AOSP 源码搜索目标。

问题描述: <issue_title>

提取以下信息:
1. Android 组件/服务名 (如 SurfaceFlinger, WindowManagerService, ActivityManagerService)
2. 可能涉及的 native 库 (如 libsurfaceflinger.so, libbinder.so)
3. 可能相关的子系统 (如 display, input, power, audio)
4. 建议的搜索关键词 (基于问题描述中的技术术语)

输出 JSON 格式:
{\"components\": [...], \"libraries\": [...], \"subsystems\": [...], \"keywords\": [...]}

保存到 /tmp/aosp-analyze-<slug>/search-targets.json"
)
```

Read the generated `/tmp/aosp-analyze-<slug>/search-targets.json` and use its contents as search targets for the AOSP investigator agents below.

### Parallel AOSP Search (via Subagents)

Group search targets into 2-3 clusters by subsystem, then spawn one aosp-investigator per cluster **in parallel**:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="sonnet",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL sourcepilot search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Search AOSP source code for the following crash-related classes/functions from analysis <slug>.

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

- Merge all AOSP investigator results into `/tmp/aosp-analyze-<slug>/aosp-context.md`
- This file feeds into both hypothesis investigation (Phase 5) and the final report (Section 4)
- If AOSP search returns no results for a target, note it as a gap — do not silently omit

Update state: `current_phase: "aosp-searched"`.

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-5 -->
## Phase 5: Hypothesis Generation and Parallel Investigation

### Hypothesis Generation (via Subagent)

Spawn an analyst subagent to generate hypotheses:

**Log-based mode:**

```
Agent(
  subagent_type="zaku:analyst",
  model="sonnet",
  prompt="Analyze Android crash anomalies for analysis <slug> and generate root-cause hypotheses.

Read the anomalies file: /tmp/aosp-analyze-<slug>/anomalies.md
Read the timeline file: /tmp/aosp-analyze-<slug>/timeline.md
Read the AOSP context file: /tmp/aosp-analyze-<slug>/aosp-context.md (use AOSP findings to inform and strengthen hypotheses)

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

Save output to /tmp/aosp-analyze-<slug>/hypotheses.md in this format:

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

**No-log mode:**

```
Agent(
  subagent_type="zaku:analyst",
  model="sonnet",
  prompt="基于 AOSP 源码分析结果和问题描述，生成可能的根因假设。

问题描述: <issue_title>
Read the AOSP context file: /tmp/aosp-analyze-<slug>/aosp-context.md

注意: 本次分析无日志输入，假设基于源码结构推断而非日志证据。所有假设的置信度上限为"中"。

Generate 2-3 root-cause hypotheses. Each hypothesis must have:
- Title (one-line description)
- Reasoning (基于 AOSP 源码中发现的哪些代码路径/错误处理缺陷推断)
- Relevant AOSP source context (which AOSP code paths are involved)
- **Covered by Phase 4 context:** list aosp-context.md sections already searched for this hypothesis
- **New investigation targets:** code paths NOT in aosp-context.md that need further searching
- Confidence: 低/中 (无日志模式下不允许标注"高"置信度)

Save output to /tmp/aosp-analyze-<slug>/hypotheses.md in this format:

## Hypothesis 1: <title>
**Reasoning:** <基于源码的推断逻辑>
**AOSP source context:** <相关代码路径>
**Confidence:** 中/低

## Hypothesis 2: ...
(repeat ch hypothesis)"
)
```

Read the generated hypotheses from `/tmp/aosp-analyze-<slug>/hypotheses.md`.

### Parallel Investigation via Agent Tool

Spawn one agent per hypothesis (max 3). Each agent receives Phase 4 context to avoid redundant searches:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="sonnet",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL sourcepilot search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Investigate this Android crash hypothesis for analysis <slug>:

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
- Save to `/tmp/aosp-analyze-<slug>/investigation-<N>.md`
- If an agent fails or times out, mark that hypothesis as "investigation incomplete" — do not fail the entire skill
- Update state: `current_phase: "investigated"`, `hypothesis_count: <N>`

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-6 -->
## Phase 6: Synthesis and Report

1. **Read investigation results** from `/tmp/aosp-analyze-<slug>/investigation-*.md` and `/tmp/aosp-analyze-<slug>/aosp-context.md`

2. **Rank hypotheses** by confidence (from investigation results)

3. **Determine the report title**:
   - If `--title` was provided: use it as the issue description
   - Otherwise, derive from the most severe anomaly (e.g., "SIGSEGV in SurfaceFlinger")
   - Format: `{slug} — {derived_or_provided_description}`

4. **Build the 7-section Chinese report** and save to `.granada/specs/aosp-analyze-{slug}.md` after redacting common secrets from all included log excerpts and issue text (authorization headers, bearer tokens, API keys, passwords, access/refresh/id tokens, cookies, session IDs, private keys, and signed URL token/key/signature query values):

```markdown
# 根因分析报告: {slug} — {issue_title}

**生成时间:** {date}
**分析模式:** {log-based: "日志驱动分析" | no-log: "无日志源码分析（基于问题描述推断）"}
**输入目录:** {input_path or "无（无日志模式）"}
**分析项目:** {project_name or "未限定"}

## 1. 问题概述
{issue_description_summary — derived from anomalies or --title}

## 2. 事件时间线
{log-based mode:}
| 时间 | 来源 | 严重程度 | 事件 |
|------|------|----------|------|
| {timestamp} | {logcat/tombstone/ANR/kernel} | {INFO/WARN/ERROR/FATAL} | {description} |

{no-log mode:}
> 本次分析未提供日志文件，无事件时间线。以下分析基于问题描述和 AOSP 源码结构推断。

## 3. 关键异常/错误
{log-based mode:}
### 异常 1: {title}
- **严重程度:** {FATAL/ERROR/WARN}
- **来源:** {file}:{line}
- **堆栈信息:**
  {stack_trace}

{no-log mode:}
> 本次分析未提供日志文件，无异常提取。以下根因假设基于 AOSP 源码分析推断，而非日志证据。

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

> **无日志模式约束:** 当 `analysis_mode == "no-log"` 时，所有假设的置信度上限为"中"，不允许标注"高"。报告中应注明"本分析基于源码推断，未经日志证据验证"。

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

5. **Finalize state and cleanup**:
   - On success: `Bash: rm -f .granada/aosp-analyze-state.json` — terminal exit
   - On error-abort: `Write {"active": false, current_phase="error"} to .granada/aosp-analyze-state.json` — preserves state for debugging
   - Announce report location to user

</Steps>

<Error_Handling>
Embed these handlers throughout all phases:

- **AOSP MCP unreachable** → abort with "sourcepilot MCP unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."
- **Input path does not exist** → abort with "Path not found: <path>"
- **Input path is not a directory** → abort with "Path is not a directory: <path>. Provide a directory containing extracted Android logs."
- **No Android log files found** → abort with "No Android log files found in the directory. Supported types: logcat, tombstone, ANR traces, kernel logs."
- **Log parsing failed** → abort with "Log parsing failed — timeline or anomalies output missing. Check aosp-log-parser agent output."
- **AOSP search returns no results** → note "no AOSP source found" in report, do not fail
- **Agent timeout/failure** → mark hypothesis as "investigation incomplete", continue with others
- **All hypotheses fail investigation** → report with "insufficient evidence" conclusion
</Error_Handling>

<State_Schema>
```json
{
  "mode": "aosp-analyze",
  "active": true,
  "current_phase": "initialize | data-collected | parsed | aosp-searched | investigated | complete | error",
  "state": {
    "slug": "string",
    "temp_dir": "/tmp/aosp-analyze-<slug>",
    "analysis_mode": "log-based | no-log",
    "input_path": "string | null",
    "issue_title": "string | null",
    "log_file_types": "{\"filename\": \"logcat|tombstone|anr|kernel|other\"} | null",
    "anomaly_count": "0",
    "hypothesis_count": "0",
    "report_path": "string | null",
    "project_override": "string | null"
  }
}
```

State is lightweight (<10KB). Parsed data lives in temp files (`/tmp/aosp-analyze-<slug>/`), not in state.

Update state at each phase boundary for resumability. On resume, read state via `Read .granada/aosp-analyze-state.json` and continue from `current_phase`.
</State_Schema>

<Tool_Usage>
- `sourcepilot` — search AOSP source for crash-related code (always, not conditional)
- `Write` / `Read` / `Bash rm` — phase persistence via .granada/aosp-analyze-state.json
- `Agent(subagent_type="zaku:aosp-log-collector", model="sonnet")` — local log directory preparation and classification manifest generation (Phase 2)
- `Agent(subagent_type="zaku:aosp-log-parser", model="sonnet")` — log parsing and timeline construction from the collector-generated classification manifest (Phase 3)
- `Agent(subagent_type="zaku:analyst", model="sonnet")` — hypothesis generation (Phase 5)
- `Agent(subagent_type="zaku:aosp-investigator", model="sonnet")` — AOSP context search (Phase 4) + parallel hypothesis investigation (Phase 5)
- `Write` — save final report
</Tool_Usage>

<Examples>
<Good>
```
User: /aosp-analyze --dir /tmp/crash-logs --title "SystemUI crash after OTA"

[Phase 1] Input: directory /tmp/crash-logs. Slug: crash-logs. AOSP MCP health check pass.
          AOSP Project: android-14 (from .granada/aosp-config.json)
[Phase 2] Spawned aosp-log-collector agent.
          Collection complete → 8 files classified: 2 logcat, 1 tombstone, 1 ANR, 0 kernel, 4 other.
[Phase 3] Spawned aosp-log-parser agent.
          Completed → 312 timeline events, 7 anomalies.
          Top anomalies: SIGSEGV in libsurfaceflinger.so, ANR in SystemUI.
[Phase 4] AOSP Source Context: Spawned 2 aosp-investigator agents in parallel.
          Cluster 1 (SurfaceFlinger): Found SurfaceFlinger::onMessageReceived null check gap.
          Cluster 2 (SystemUI): Found SystemUI binder thread pool config in ActivityManagerService.
          Saved aosp-context.md with 5 AOSP source findings.
[Phase 5] Spawned analyst subagent → generated 2 hypotheses:
          H1: SurfaceFlinger null pointer dereference (FATAL, earliest)
          H2: SystemUI ANR from binder thread exhaustion (ERROR)
          Spawned 2 aosp-investigator agents in parallel.
          H1: HIGH confidence — found matching code path in SurfaceFlinger::onMessageReceived
          H2: MEDIUM — thread pool config matches but no direct evidence
[Phase 6] Report saved to .granada/specs/aosp-analyze-crash-logs.md (Chinese, 7 sections).
```
Why good: All exploration delegated to subagents. Clear input (--dir). AOSP project configured. Full pipeline executed with aosp-log-parser agent handling parallel parsing.
</Good>

<Good>
```
User: /aosp-analyze --title "SurfaceFlinger 在旋转屏幕时崩溃"

[Phase 1] 无日志模式 (no-log). Slug: surfaceflinger-rotate-crash. MCP 健康检查通过。
          AOSP Project: android-14 (from .granada/aosp-config.json)
[Phase 2] 跳过（无日志模式）
[Phase 3] 跳过（无日志模式）
[Phase 4] Spawned analyst → 从问题描述提取搜索目标: SurfaceFlinger, display rotation, WindowManagerService
          Spawned 2 aosp-investigator agents in parallel.
          Cluster 1 (SurfaceFlinger): Found SurfaceFlinger::setTransactionState rotation handling.
          Cluster 2 (WindowManager): Found DisplayRotation::rotateDisplay lock ordering.
          Saved aosp-context.md with 4 AOSP source findings.
[Phase 5] Spawned analyst subagent → generated 2 hypotheses (置信度上限: 中):
          H1: SurfaceFlinger rotation transaction race condition (中)
          H2: DisplayRotation lock inversion during config change (中)
          Spawned 2 aosp-investigator agents in parallel.
[Phase 6] Report saved to .granada/specs/aosp-analyze-surfaceflinger-rotate-crash.md (Chinese, 7 sections).
```
Why good: No-log mode correctly skips Phase 2/3. Search targets extracted from --title by analyst. Confidence capped at "中". Full 7-section report generated with sections 2/3 noting absence of log evidence.
</Good>

<Good>
```
User: /aosp-analyze /home/user/bugreport-logs

[Phase 1] Input: directory /home/user/bugreport-logs. Slug: bugreport-logs. AOSP MCP health check pass.
          No AOSP project configured — searching all projects.
[Phase 2] aosp-log-collector classified 15 files → 4 logcat, 3 tombstone, 2 ANR, 1 kernel, 5 other.
[... rest of pipeline ...]
```
Why good: Positional path shorthand works. No project configured — searches all projects with clear warning.
</Good>

<Bad>
```
User: /aosp-analyze --sn ABC123456
[Phase 1] No valid log directory found.
```
Why bad: Does not support --sn. User should extract logs first or use the directory path directly.
</Bad>

<Bad>
```
User: /aosp-analyze /path/to/nonexistent
[Phase 1] Path not found: /path/to/nonexistent. Abort.
```
Why good: Correctly aborts early when path doesn't exist.
</Bad>
</Examples>

<Guardrails>
**Must have:**
- sourcepilot for AOSP source (always, not conditional) — **Phase 4 AOSP 源码分析是必选阶段**，除非十分确认问题与 AOSP 源码完全无关才可跳过
- aosp-investigator subagent for both Phase 4 (AOSP context) and Phase 5 (hypothesis investigation)
- Lightweight state (<10KB, file paths not data)
- All 7 report sections (in Chinese)
- Report saved to `.granada/specs/aosp-analyze-{slug}.md`
- All exploration/analysis delegated to subagents (file classification, log parsing, timeline merge, hypothesis generation, AOSP investigation)
- Lead only orchestrates: MCP calls, state management, subagent spawning, report assembly

**Must NOT have:**
- JIRA MCP dependency (no jira_get_issue, jira_download_attachments, jira_add_comment)
- zip/sn input modes (only --dir / directory path, not --zip or --sn)
- log-unboxer dependency
- Interactive/conversational mode (produces static report)
- iOS or non-Android log parsing
- Binary attachment processing (images, videos)
- Guessing of issue context — derive strictly from logs and --title
</Guardrails>
