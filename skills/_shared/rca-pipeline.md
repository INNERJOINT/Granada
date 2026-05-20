# RCA Pipeline — Canonical Reference (NOT EXECUTED)

> **This file is the maintenance reference for shared Phase 3-6 logic between
> `skills/jira-analyze/SKILL.md` and `skills/aosp-rca/SKILL.md`.**
>
> It is NEVER executed by the skill runtime. Changes here must be manually
> synced to both SKILL.md files. Run `scripts/lint-rca-sync.sh` to detect drift.

## Identifiers

| Placeholder | jira-analyze | aosp-rca |
|-------------|-------------|--------------|
| `<ANALYSIS_ID>` | `<KEY>` (JIRA issue key) | `<slug>` (directory basename) |
| `<TEMP_DIR>` | `/tmp/jira-analyze-<KEY>/` | `/tmp/aosp-rca-<slug>/` |
| `<MODE_NAME>` | `jira-analyze` | `aosp-rca` |
| `<ANALYSIS_MODE>` | always `log-based` | `log-based` or `no-log` |
| `<REPORT_OUTPUT_PATH>` | `.granada/specs/jira-analyze-{issue_key}.md` | `.granada/specs/aosp-rca-{slug}.md` |

---

## Phase 3: Log Parsing and Timeline Construction (via aosp-log-parser Agent)

<!-- MODE-GATE: log-based only. aosp-rca skips Phase 3 entirely when analysis_mode=="no-log" -->

Delegate all log parsing to a single `aosp-log-parser` agent. This agent reads the collector-generated file classification, runs all 4 log type parsers, and performs the merge/synthesis step internally.

### Spawn aosp-log-parser Agent

```
Agent(
  subagent_type="zaku:aosp-log-parser",
  prompt="Parse Android log files for <MODE_NAME> analysis <ANALYSIS_ID>.

Temp directory: <TEMP_DIR>
Source files directory: <TEMP_DIR>extracted/
Classification manifest: <TEMP_DIR>file-classification.json

Read the collector-generated classification manifest first, parse each listed log type using parallel tool calls where possible, then merge into unified timeline.md and anomalies.md. Abort if the manifest is missing or inconsistent with the extracted directory.

Report the total anomaly count at the end of your response."
)
```

### Verify Output

After the agent completes, check that `<TEMP_DIR>timeline.md` and `<TEMP_DIR>anomalies.md` exist. If not, abort with "Log parsing failed — timeline or anomalies output missing."

Update state: `current_phase: "parsed"`, `anomaly_count: <N>` (from the agent's summary).

---

## Phase 4: AOSP Source Context Analysis

Before hypothesis investigation, perform a dedicated AOSP source search based on crash signatures extracted from anomalies. This phase is **mandatory** — skip only if absolutely certain the issue has zero relevance to AOSP code.

### Extract Search Targets

Spawn an `aosp-analyst` subagent to extract structured search targets from parsed logs or, for aosp-rca no-log mode, from the problem description:

```
Agent(
  subagent_type="zaku:aosp-analyst",
  prompt="Extract structured AOSP source search targets for <MODE_NAME> analysis <ANALYSIS_ID>.

Analysis mode: <ANALYSIS_MODE>
Issue description: <issue_title or 'none'>

If analysis_mode == log-based:
- Read <TEMP_DIR>anomalies.md
- Read <TEMP_DIR>timeline.md
- Extract Java/native class names, function names, native libraries, kernel subsystem identifiers, signals, and specific error patterns.

If analysis_mode == no-log:
- Use the issue description to infer Android components/services, native libraries, subsystems, and technical keywords.

Group targets into 2-3 subsystem clusters.

Save valid JSON to <TEMP_DIR>search-targets.json with clusters and gaps."
)
```

Read `<TEMP_DIR>search-targets.json` and use its clusters as search targets for the AOSP investigator agents below.

### Parallel AOSP Search (via Subagents)

Group search targets into 2-3 clusters by subsystem, then spawn one aosp-investigator per cluster **in parallel**:

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL sourcepilot search calls. Do NOT read `.granada/aosp-config.json`.]

Search AOSP source code for this RCA target cluster from search-targets.json:
<cluster with subsystem, components, libraries, functions, keywords, and error_patterns>

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
  subagent_type="zaku:aosp-analyst",
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

Save output to <TEMP_DIR>hypotheses.md in this format:

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

<!-- MODE-GATE: aosp-rca no-log only — replaces the above analyst prompt in no-log mode -->
### Hypothesis Generation (no-log mode — aosp-rca only)

```
Agent(
  subagent_type="zaku:aosp-analyst",
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
<!-- MODE-GATE: aosp-rca only — adds analysis mode -->
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

<!-- MODE-GATE: aosp-rca no-log only -->
> 本次分析未提供日志文件，无事件时间线。以下分析基于问题描述和 AOSP 源码结构推断。
<!-- /MODE-GATE -->

## 3. 关键异常/错误
### 异常 1: {title}
- **严重程度:** {FATAL/ERROR/WARN}
- **来源:** {file}:{line}
- **堆栈信息:**
  {stack_trace}

<!-- MODE-GATE: aosp-rca no-log only -->
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

<!-- MODE-GATE: aosp-rca no-log only -->
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
   - On error-abort: `Write {"active": false, "current_phase": "error"} to .granada/<MODE_NAME>-state.json` — preserves state for debugging
   - Announce report location to user

<!-- MODE-GATE: jira-analyze only — post report as JIRA comment -->
5. **Post report as JIRA comment**: `jira_add_comment(issue_key=<KEY>, body=<redacted_report_content>)` — post the redacted report content as a comment on the JIRA issue. If this fails, warn but do not abort (the local report file is still available).
<!-- /MODE-GATE -->
