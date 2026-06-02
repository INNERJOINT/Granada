---
description: General AOSP source/module/function technical report — analyze a feature, module, function, or subsystem via AOSP source search and produce a structured Chinese technical report. For crash/ANR/tombstone/log-based root-cause analysis, use aosp-rca instead.
argument-hint: '--title <description> [--query <description>] [--project <name>] [--fresh]'
model: opus
triggers:
  - "aosp analyze"
  - "aosp_analyze"
  - "aosp source analyze"
  - "aosp 分析"
handoff: .granada/specs/aosp-analyze-{slug}.md
level: 3
---

<Purpose>
Produces a structured Chinese technical report about an AOSP module, function, feature, or subsystem. Delegates target extraction to `zaku:aosp-analyst` and source investigation to `zaku:aosp-investigator` subagents, then synthesises findings into a concise report saved to `.granada/specs/`.

This skill does NOT parse logs, generate timelines, produce RCA hypotheses, or output root-cause analysis sections. For crash/ANR/tombstone/log-based root-cause analysis, redirect to `aosp-rca`.
</Purpose>

<Use_When>
- User wants a technical overview of an AOSP class, function, module, or subsystem
- User says "aosp analyze", "aosp_analyze", or "aosp source analyze"
- User asks "how does <component> work in AOSP?" or "explain the <subsystem> architecture"
- User wants to understand call flows, data flows, interfaces, or configuration of AOSP code
- User provides a query about AOSP internals without crash logs
</Use_When>

<Do_Not_Use_When>
- User provides crash logs, tombstone files, ANR traces, or kernel dumps — use aosp-rca instead
- User wants root-cause analysis or hypothesis investigation — use aosp-rca
- User says "aosp rca", "analyze logs", "crash analyze" — these map to aosp-rca
- User wants code modifications or an implementation plan — use aosp-plan
- User wants to export feature documentation across projects — use aosp-feature-export
</Do_Not_Use_When>

<Steps>

## Phase 1: Initialize

1. **Parse `{{ARGUMENTS}}`** to extract flags and positional text:

   - `--title <value>` (pattern `--title\s+(.+?)(?:\s+--|\s*$)`): Required. The report topic description. Strip the flag from arguments.
   - `--query <value>` (pattern `--query\s+(.+?)(?:\s+--|\s*$)`): Optional. Additional search or scope refinement keywords. Strip the flag.
   - `--project <value>` (pattern `--project\s+(\S+)`): Optional AOSP project override. Strip the flag.
   - `--dir <path>`: Directory input is not supported here; use it only for redirecting to `aosp-rca`.
   - `--fresh` (boolean flag): Force clean start. Strip from arguments.
   - Any remaining positional text after flag stripping is appended to the query/title as additional context.

   **Input validation and routing:**
   1. If any remaining positional argument or `--dir` value is an existing directory, abort with: `This skill produces general AOSP technical reports, not crash RCA. Redirecting: use /aosp-rca --dir <path> --title '<title or description>'`.
   2. If the topic text contains explicit RCA/log keywords (`crash`, `ANR`, `tombstone`, `logcat`, `kernel panic`, `root cause`, `RCA`, `崩溃`, `重启`, `日志`, `根因`), abort and redirect to `aosp-rca`.
   3. If `--title` is absent but positional text remains: use the positional text as the title.
   4. If `--title` is absent and no positional text remains: abort with:
      ```
      No topic provided. Provide one of:
        --title <description>    Report topic (required)
        --query <description>    Additional search keywords (optional)
        positional text          Additional context appended to query
      ```

2. **Generate and validate a slug** from the resolved title:
   - Convert all characters outside `[A-Za-z0-9._-]` to `-`.
   - Trim leading `.` or `-`.
   - Truncate to 40 characters.
   - Reject empty slugs.
   - Reject slugs containing `..` or path separators.
   - Require `^[A-Za-z0-9._-]{1,40}$`.
   - Derive `target="/tmp/aosp-analyze-${slug}"` and require the resolved target to start with `/tmp/aosp-analyze-`.

3. **Fresh start cleanup** (after slug and target validation):
   - If `--fresh` flag is present: remove the validated temp directory with `rm -rf -- "$target"` before continuing.

4. **MCP health check**:
   - AOSP: call `mcp__plugin_zaku_sourcepilot__list_projects()` — if fails, abort with "AOSP MCP (sourcepilot) unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."

5. **Display active AOSP project**:
   - If `--project` override was provided: display `**AOSP Project: <name> (命令行指定)**` and use this value. Skip reading `.granada/aosp-config.json`.
   - Otherwise, read `.granada/aosp-config.json`:
     - If configured: display `**AOSP Project: <project_name>**`
     - If not configured: display `**未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

6. **Create temp directory**:
```bash
target="/tmp/aosp-analyze-${slug}"
mkdir -p -- "$target"
```

## Phase 2: Target Extraction

Extract structured search targets from the title and query. Spawn an analyst subagent:

```
Agent(
  subagent_type="zaku:aosp-analyst",
  model="opus",
  prompt="从以下 AOSP 技术报告主题中提取结构化的源码搜索目标。

报告主题: <title>
附加查询: <query or "无">

提取以下信息:
1. 核心 AOSP 组件/服务/类名 (如 SurfaceFlinger, AudioFlinger, WindowManagerService)
2. 相关的 native 库 (如 libsurfaceflinger.so, libaudioflinger.so)
3. 涉及的子系统 (如 display, audio, input, power, camera)
4. 关键函数/方法名 (如 onMessageReceived, setTransactionState)
5. 推荐的搜索关键词 (AOSP 模块名、接口名、配置项)

将目标按子系统分组为 2-3 个搜索集群。

输出 JSON 格式保存到 /tmp/aosp-analyze-<slug>/search-targets.json:
{
  \"title\": \"<title>\",
  \"clusters\": [
    {
      \"subsystem\": \"<name>\",
      \"components\": [...],
      \"libraries\": [...],
      \"functions\": [...],
      \"keywords\": [...]
    }
  ]
}"
)
```

Verify `/tmp/aosp-analyze-<slug>/search-targets.json` exists. If not, abort with "Target extraction failed — search-targets.json missing."


## Phase 3: Parallel Source Investigation

Spawn one `zaku:aosp-investigator` per cluster from search-targets.json, **in parallel** (max 3):

```
Agent(
  subagent_type="zaku:aosp-investigator",
  model="sonnet",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL mcp__plugin_zaku_sourcepilot__* search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Investigate AOSP source code for technical report <slug>.

Report topic: <title>
Subsystem cluster: <cluster_subsystem>

Search targets:
- Components: <cluster.components>
- Libraries: <cluster.libraries>
- Functions: <cluster.functions>
- Keywords: <cluster.keywords>

For each target:
1. Use the mcp__plugin_zaku_sourcepilot__* tools (see Tool_Selection_Matrix in the investigator agent)
2. Search for class/function/module definitions in AOSP
3. Trace call flows (callers and callees)
4. Identify data structures, interfaces, and configuration points
5. Find related comments, documentation, and design notes
6. Check for CTS tests or related test coverage

Report for each finding:
- **AOSP file path** and line range
- **Code snippet** (key declarations, interfaces, logic)
- **Functional description**: what this code does
- **Relationships**: how it connects to other components
- **Configuration/extension points**: parameters, hooks, overrides

After each investigator returns, the lead writes that agent's report to /tmp/aosp-analyze-<slug>/source-finding-<N>.md in the format:

## Finding <N>: <component_or_function_name>
- **Source location:** `path/to/file.ext:start-end`
- **Code:**
  ```java
  // key snippet
  ```
- **Description:** <functional description>
- **Relationships:** <callers, callees, connected components>
- **Configuration:** <params, interfaces, extension points>
"
)
```

Wait for all agents to complete. If an agent fails or times out, note the gap but continue.


## Phase 4: Report Synthesis

1. **Read all findings** from `/tmp/aosp-analyze-<slug>/source-finding-*.md` and `/tmp/aosp-analyze-<slug>/search-targets.json`.

2. **Build the 8-section Chinese report** and save to `.granada/specs/aosp-analyze-{slug}.md` after redacting common secrets from all included title/query text, copied issue text, URLs, headers, command output, and source/investigation excerpts (authorization headers, bearer tokens, API keys, passwords, access/refresh/id tokens, cookies, session IDs, private keys, and signed URL token/key/signature query values):

```markdown
# AOSP 技术分析报告: {slug} — {title}

**生成时间:** {date}
**分析项目:** {project_name or "未限定"}
**查询范围:** {query or "未指定"}

## 1. 概述
{简要说明分析的主题、涉及的子系统和核心组件。2-3 句话总结主要发现。}

## 2. 受影响组件图
{ASCII box-drawing diagram showing the analyzed component, its subsystem context, related components, and their data/control relationships}

## 3. 关键源码路径
| 文件 | 路径 | 说明 |
|------|------|------|
| {filename} | `{aosp/repo/path/to/file}` | {简要说明} |

## 4. 核心类/函数
### {class_or_function_name}
- **源码位置:** `{path}:{line_range}`
- **功能说明:** {what it does}
- **关键代码:**
  ```java
  // 核心逻辑摘录
  ```
- **关联组件:** {connected components}

{Repeat for each core class/function}

## 5. 调用/数据流
{Describe the call flow and data flow between components. Use ASCII diagrams for sequence or flow.}

### 调用链
{description of the call chain}

### 数据流
{description of how data moves through the system}

## 6. 接口与配置
{List interfaces, configuration parameters, system properties, build flags, or runtime settings that affect behavior.}

### 关键接口
| 接口 | 位置 | 说明 |
|------|------|------|

### 配置参数
| 参数 | 默认值 | 说明 |
|------|--------|------|

## 7. 扩展点与风险
### 扩展点
{Where and how the code can be extended, overridden, or customized}

### 已知风险/限制
{Known limitations, TODOs, FIXMEs found in source, potential race conditions, or areas needing attention}

### 源码搜索缺口
{Targets that returned no results — may require manual investigation}

## 8. 后续建议
1. {actionable suggestion with specific file/component references}
2. {actionable suggestion}
3. {optional: areas for deeper investigation}
```

## Phase 5: Finalize

4. Announce report location to the user.

</Steps>

<Error_Handling>
- **AOSP MCP unreachable** → abort with "AOSP MCP (sourcepilot) unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."
- **No topic provided** → abort with "No topic provided. Provide --title <description>."
- **Target extraction fails** → abort with "Target extraction failed — search-targets.json missing."
- **AOSP search returns no results** → note "no AOSP source found" in report, do not fail
- **Agent timeout/failure** → mark cluster as "investigation incomplete", continue with others
- **All agents fail** → report with "insufficient source data" conclusion
</Error_Handling>


<Tool_Usage>
- `mcp__plugin_zaku_sourcepilot__*` — search AOSP source for target classes, functions, and modules
- `Agent(subagent_type="zaku:aosp-analyst", model="opus")` — target extraction from title/query (Phase 2)
- `Agent(subagent_type="zaku:aosp-investigator", model="sonnet")` — parallel source investigation (Phase 3)
- `Write` — save final report to `.granada/specs/aosp-analyze-{slug}.md`
</Tool_Usage>

<Examples>
<Good>
```
User: /aosp-analyze --title "SurfaceFlinger display pipeline architecture" --project android-14

[Phase 1] Title: SurfaceFlinger display pipeline architecture. Slug: surfaceflinger-display-pipeline-archit.
          AOSP MCP health check pass. AOSP Project: android-14 (命令行指定)
[Phase 2] Spawned analyst → extracted 3 clusters: SurfaceFlinger core, HWC, DispSync
          Saved search-targets.json.
[Phase 3] Spawned 3 aosp-investigator agents in parallel.
          Cluster 1 (SurfaceFlinger core): Found SurfaceFlinger.cpp, MessageQueue, Layer, DisplayDevice.
          Cluster 2 (HWC): Found HWComposer HAL interface, Composer HAL aidl.
          Cluster 3 (DispSync): Found DispSync.cpp, EventThread, VSYNC scheduling.
          Saved 8 source-finding-*.md files.
[Phase 4] Report saved to .granada/specs/aosp-analyze-surfaceflinger-display-pipeline-archit.md (Chinese, 8 sections).
```
Why good: Clear title, project specified, parallel agents maximized. Report has all 8 sections with ASCII diagrams, call flows, and configuration tables.
</Good>

<Good>
```
User: /aosp-analyze --title "Binder IPC mechanism" --query "driver, ServiceManager, transaction"

[Phase 1] Title: Binder IPC mechanism. Query: driver, ServiceManager, transaction.
          Slug: binder-ipc-mechanism. AOSP MCP health check pass.
          AOSP Project: android-14 (from .granada/aosp-config.json)
[Phase 2] Spawned analyst → extracted 2 clusters: Binder driver/kernel, Binder framework/java.
          Search targets refined by query keywords.
[Phase 3] Spawned 2 aosp-investigator agents in parallel.
          Cluster 1: Found binder.c, binder_internal.h, ioctl interface.
          Cluster 2: Found Binder.java, ServiceManager.java, BpBinder, BBinder.
          Saved 6 source-finding-*.md files.
[Phase 4] Report saved to .granada/specs/aosp-analyze-binder-ipc-mechanism.md (Chinese, 8 sections).
```
Why good: --query refines search scope. Two clusters cover kernel and framework layers.
</Good>

<Bad>
```
User: /aosp-analyze /tmp/crash-logs --title "SystemUI crash"

[Phase 1] Detected directory path in arguments. This is a crash log directory.
          Abort: "This skill produces general AOSP technical reports, not crash RCA.
          Redirecting: use /aosp-rca --dir /tmp/crash-logs --title 'SystemUI crash'"
```
Why good: Correctly detects log directory input and redirects to aosp-rca instead of trying to process logs.
</Bad>

<Bad>
```
User: /aosp-analyze

[Phase 1] No topic provided. Abort: "No topic provided. Provide --title <description>."
```
Why good: Requires a topic — does not silently proceed with empty analysis.
</Bad>
</Examples>

<Guardrails>
**Must have:**
- mcp__plugin_zaku_sourcepilot__* for AOSP source search (always, not conditional)
- aosp-investigator subagents for parallel source investigation (Phase 3)
- analyst subagent for search target extraction (Phase 2)
- All 8 report sections (in Chinese)
- Report saved to `.granada/specs/aosp-analyze-{slug}.md`
- Redirect crash/log-directory inputs to aosp-rca

**Must NOT have:**
- Log parsing, log collection, or timeline construction phases
- Hypothesis generation or root-cause analysis sections
- JIRA MCP dependency
- Crash signature extraction or anomaly detection
- Confidence rankings or evidence evaluation
- log-unboxer, aosp-log-collector, or aosp-log-parser dependencies
</Guardrails>
