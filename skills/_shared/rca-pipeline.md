# RCA Pipeline — Canonical Reference (NOT EXECUTED)

> **This file is the maintenance reference for shared Phase 3-6 logic between
> `skills/jira-analyze/SKILL.md` and `skills/aosp-analyze/SKILL.md`.**
>
> It is NEVER executed by the skill runtime. Changes here must be manually
> synced to both SKILL.md files. Run `scripts/lint-rca-sync.sh` to detect drift.

## Identifiers

| Placeholder | jira-analyze | aosp-analyze |
|-------------|-------------|--------------|
| `<ANALYSIS_ID>` | `<KEY>` (JIRA issue key) | `<slug>` (directory basename) |
| `<TEMP_DIR>` | `/tmp/jira-analyze-<KEY>/` | `/tmp/aosp-analyze-<slug>/` |
| `<MODE_NAME>` | `jira-analyze` | `aosp-analyze` |
| `<ANALYSIS_MODE>` | always `log-based` | `log-based` or `no-log` |
| `<REPORT_OUTPUT_PATH>` | `.plugin-state/specs/jira-analyze-{issue_key}.md` | `.plugin-state/specs/aosp-analyze-{slug}.md` |

---

## Phase 3: Log Parsing and Timeline Construction (via aosp-log-parser Agent)

<!-- MODE-GATE: log-based only. aosp-analyze skips Phase 3 entirely when analysis_mode=="no-log" -->

Delegate all log parsing to a single `aosp-log-parser` agent. This agent handles file classification (if needed), all 4 log type parsers, and the merge/synthesis step internally.

### Spawn aosp-log-parser Agent

```
Agent(
  subagent_type="zaku:aosp-log-parser",
  prompt="Parse Android log files for <MODE_NAME> analysis <ANALYSIS_ID>.

Temp directory: <TEMP_DIR>
Source files directory: <TEMP_DIR>extracted/

Classify files if needed (generate file-classification.json if missing), then follow your Parsing Protocol: read the classification, parse each log type using parallel tool calls where possible, then merge into unified timeline.md and anomalies.md.

Report the total anomaly count at the end of your response."
)
```

### Verify Output

After the agent completes, check that `<TEMP_DIR>timeline.md` and `<TEMP_DIR>anomalies.md` exist. If not, abort with "Log parsing failed — timeline or anomalies output missing."

Update state: `current_phase: "parsed"`, `anomaly_count: <N>` (from the agent's summary).

---

## Phase 4: AOSP Source Context Analysis

Before hypothesis investigation, perform a dedicated AOSP source search based on crash signatures extracted from anomalies. This phase is **mandatory** — skip only if absolutely certain the issue has zero relevance to AOSP code.

### Extract Search Targets (log-based mode)

Read `<TEMP_DIR>anomalies.md` and extract:
- Java/native class names from stack traces (e.g., `SurfaceFlinger`, `ActivityManagerService`, `InputDispatcher`)
- Native library names (e.g., `libsurfaceflinger.so`, `libbinder.so`)
- Kernel subsystem identifiers (e.g., `mm/slub.c`, `drivers/gpu/`)
- Signal/error patterns (e.g., `SIGSEGV`, `SIGABRT`, specific error messages)

<!-- MODE-GATE: aosp-analyze no-log only — this section replaces the above in no-log mode -->
### Extract Search Targets (no-log mode — aosp-analyze only)

Spawn an analyst subagent to extract structured search targets from the problem description:

```
Agent(
  subagent_type="zaku:analyst",
  prompt="从以下 Android 系统问题描述中提取 AOSP 源码搜索目标。

问题描述: <issue_title>

提取以下信息:
1. Android 组件/服务名 (如 SurfaceFlinger, WindowManagerService, ActivityManagerService)
2. 可能涉及的 native 库 (如 libsurfaceflinger.so, libbinder.so)
3. 可能相关的子系统 (如 display, input, power, audio)
4. 建议的搜索关键词 (基于问题描述中的技术术语)

输出 JSON 格式:
{\"components\": [...], \"libraries\": [...], \"subsystems\": [...], \"keywords\": [...]}

保存到 <TEMP_DIR>search-targets.json"
)
```
<!-- /MODE-GATE -->

### Parallel AOSP Search (via Subagents)

Group search targets into 2-3 clusters by subsystem, then spawn one aosp-investigator per cluster **in parallel**:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL sourcepilot search calls. Do NOT read `.plugin-state/aosp-config.json`.]

Search AOSP source code for the following crash-related classch targets:
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

- Merge all AOSP investigator results into `<TEMP_DIR>aosp-context.md`
- This file feeds into both hypothesis investigation (Phase 5) and the final report (Section 4)
- If AOSP search returns no results for a target, note it as a gap — do not silently omit

Update state: `current_phase: "aosp-searched"`.

---

## Phase 5: Hypothesis Generation and Parallel Investigation

### Hypothesis Generation (log-based mode)

```
Agent(
  subagent_type="zaku:analyst",
  prompt="Analyze Android crash anomalies for <MODE_NAME> analysis <ANALYSIS_ID> and generate root-cause hypotheses.

Read the anomalies file: <TEMP_DIR>anomalies.md
Read the timeline file: <TEMP_DIR>timeline.md
Read the AOSP context file: <TEMP_DIR>aosp-context.md (use AOSP findings to inform and strengthen hypotheses)

Generate 2-3 root-cause hypotheses. Each hypothesis must have:
- Title (one-line description)
- Supporting anomaly references (which timeline events support it)
- Relevant AOSP source context (which AOSP code paths are involved, error handling gaps found in Phase 4)
- **Covered by Phase 4 context:** list aosp-context.md sections whose class/function names appear in this hypothesis
- **New investigation targets:** code paths NOT already in aosp-context.md that need searching
- Key stack frames to investigate in AOSP source code

Prioritize hypotheses by:
1. Fatal/crash events over warnings
2. Earliest anomaly in timeline over later ones
3. System-level crashes over app-level

Save ouo <TEMP_DIR>hypotheses.md in this format:

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

<!-- MODE-GATE: aosp-analyze no-log only — replaces the above analyst prompt in no-log mode -->
### Hypothesis Generation (no-log mode — aosp-analyze only)

```
Agent(
  subagent_type="zaku:analyst",
  prompt="基于 AOSP 源码分析结果和问题描述，生成可能的根因假设。

问题描述: <issue_title>
Read the AOSP context file: <TEMP_DIR>aosp-context.md

 本次分析无日志输入，假设基于源码结构推断而非日志证据。所有假设的置信度上限为"中"。

Generate 2-3 root-cause hypotheses. Each hypothesis must have:
- Title (one-line description)
- Reasoning (基于 AOSP 源码中发现的哪些代码路径/错误处理缺陷推断)
- Relevant AOSP source context (which AOSP code paths are involved)
- **Covered by Phase 4 context:** <list of already-searched targets>
- **New investigation targets:** <list of targets NOT in aosp-context.md>
- Confidence: 低/中 (无日志模式下不允许标注"高"置信度)

Save output to <TEMP_DIR>hypotheses.md"
)
```
<!-- /MODE-GATE -->

### Parallel Investigation via Agent Tool

Read the generated hypotheses from `<TEMP_DIR>hypotheses.md`.

Spawn one agent per hypothesis (max 3). Each agent receives Phase 4 context to avoid redundant searches:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL sourcepilot search calls.]

Investigate this Android crash hypothesis for <MODE_NAME> analysis <ANALYSIS_ID>:

Hypothesis: <hypothesis_title>

## Pre-existing AOSP Context (from Phase 4 — DO NOT re-search these)

The following AOSP source findings are already available. Use them directly as evidence.
Only perform NEW sourcepilot searches for code paths NOT covered below.

<For each hypothesis, include aosp-context.md sections whose search target class/function
names appear in the hypothesis's 'Stack frames to investigate' list or 'Supporting anomalies'
references. Filter by string match of class/function names.>

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
- Save to `<TEMP_DIR>investigation-<N>.md`
- If an agent fails or times out, mark that hypothesis as "investigation incomplete" — do not fail the entire skill
- Update state: `current_phase: "investigated"`, `hypothesis_count: <N>`

---

## Phase 6: Synthesis and Report

1. **Read investigation results** from `<TEMP_DIR>investigation-*.md` and `<TEMP_DIR>aosp-context.md`

2. **Rank hypotheses** by confidence (from investigation results)

3. **Build the 7-section Chinese report** and save to `<REPORT_OUTPUT_PATH>`:

```markdown
# 根因分析报告: <ANALYSIS_ID> — {issue_title}

**生成时间:** {date}

<!-- MODE-GATE: jira-analyze only — adds JIRA metadata header -->
**问题链接:** {jira_url}
**状态:** {status} | **经办人:** {assignee} | **优先级:** {priority}
<!-- /MODE-GATE -->
<!-- MODE-GATE: aosp-analyze only — adds analysis mode ->
**分析模式:** {log-based: "日志驱动分析" | no-log: "无日志源码分析（基于问题描述推断）"}
**输入目录:** {input_path or "无（无日志模式）"}
**分析项目:** {project_name or "未限定"}
<!-- /MODE-GATE -->

## 1. 问题概述
{issue_description_summary}

## 2. 事件时间线
| 时间 | 来源 | 严重程度 | 事件 |
|------|------|----------|------|
| {timestamp} | {logcat/tombstone/ANR/kernel} | {INFO/WARN/ERROR/FATAL} | {description} |

<!-- MODE-GATE: aosp-analyze no-log only -->
> 本次分析未提供日志文件，无事件时间线。以下分析基于问题描述和 AOSP 源码结构推断。
<!-- /MODE-GATE -->

## 3. 关键异常/错误
### 异常 1: {title}
- **严重程度:** {FATAL/ERROR/WARN}
- **来源:** {file}:{line}
- **堆栈信息:**
  {stack_trace}

<!-- MODE-GATE: aosp-analyze no-log only -->
> 本次分析未提供日志文件，无异常提取。以下根因假设基于 AOSP 源码分析推断，而非日志证据。
<!-- /MODE-GATE -->

## 4. AOSP 源码分析

### 4.1 关键代码路径
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

<!-- MODE-GATE: aosp-analyze no-log only -->
> **无日志模式约束:** 所有假设的置信度上限为"中"，不允许标注"高"。本分析基于源码推断，未经日志证据验证。
<!-- /MODE-GATE -->

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

4. **Finalize state and cleanup**:
   - On success: `rm state file(mode="<MODE_NAME>")` — terminal exit
   - On error-abort: `Write {"active": false, "current_phase": "error"} to .plugin-state/<MODE_NAME>-state.json` — preserves state for debugging
   - Announce report location to user

<!-- MODE-GATE: jira-analyze only — post report as JIRA comment -->
5. **Post report as JIRA comment**: `jira_add_comment(issue_key=<KEY>, body=<report_content>)` — post the full report content as a comment on the JIRA issue. If this fails, warn but do not abort (the local report file is still available).
<!-- /MODE-GATE -->
