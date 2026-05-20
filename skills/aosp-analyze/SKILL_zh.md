---
name: aosp-analyze
description: 通过 AOSP 源码搜索对 Android 系统问题进行根因分析，支持可选的本地日志文件以进行证据驱动的分析。报告用中文撰写并保存在本地。
argument-hint: '[<日志目录路径>] [--project <名称>] --title <描述>'
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
自动执行 Android 系统问题的根因分析。支持两种模式：
- **基于日志模式** (完整版): 接收已提取的 Android 系统日志（logcat、tombstone、ANR traces、内核日志）所在的目录。将日志解析为按时间顺序排列的时间线，搜索 AOSP 源码以获取与崩溃相关的上下文，并行生成和调查假设，并生成包含 7 个部分的结构化中文 RCA 报告。
- **无日志模式** (无日志版): 接收问题的文本描述（通过 `--title`）。从描述中提取搜索目标，直接搜索 AOSP 源码，根据源码分析生成假设，并生成相同的 7 部分报告结构（其中第 2 和第 3 部分注明缺少日志证据）。

两种模式都会将报告保存到 `.granada/specs/` 中。
</Purpose>

<Use_When>
- 用户在本地目录中存有 Android 崩溃日志（logcat、tombstone、ANR、kernel）并希望进行根因分析
- 用户描述了 Android 系统问题并希望在无日志的情况下进行 AOSP 源码级的分析
- 用户说 "aosp analyze", "aosp_analyze", "aosp rca", "analyze logs", "crash analyze", "aosp 分析"
- 用户提供包含已提取 Android 日志文件的目录路径
- 用户希望将 Android 系统日志与 AOSP 源码进行关联
</Use_When>

<Do_Not_Use_When>
- 日志来自 iOS 或非 Android 平台
- 用户希望从 JIRA 获取日志——此时应使用 `jira-analyze` 技能
- 用户希望进行交互式对话分析——本技能生成的是静态报告
- 用户希望获得代码修改计划或实现步骤——此时应使用 `aosp-plan` 技能（`aosp-plan` 输出行动计划；`aosp-analyze` 输出 RCA 报告）
</Do_Not_Use_When>

<Steps>

## 阶段 1：初始化

1. **解析 `{{ARGUMENTS}}`** 以提取输入路径和可选的标志 (flags)：

   - `--project <值>` (模式 `--project\s+(\S+)`): 存储为项目覆盖（如果缺省则为 null）。从 arguments 中剥离该标志。
   - `--title <值>` (模式 `--title\s+(.+?)(?:\s+--|\s*$)`): 存储为用户提供的问题描述。剥离该标志。
   - `--dir <路径>`: 包含已提取 Android 日志文件的目录。
   - `--fresh` (布尔标志): 强制全新启动。从 arguments 中剥离。

   **输入路径解析**：
   1. 如果提供了 `--dir <路径>` 且该路径存在：用作日志目录。设置 `analysis_mode = "log-based"`。
   2. 如果第一个位置参数（剥离标志后）是目录的有效路径：将其视为 `--dir`。设置 `analysis_mode = "log-based"`。
   3. 如果未找到有效的日志目录但提供了 `--title`：设置 `analysis_mode = "no-log"`。不需要日志目录。
   4. 如果既没有有效的日志目录也没有 `--title`：中止并提示：
      ```
      No log directory or issue description provided. Provide one of:
        --dir <path>          Directory of extracted Android logs (log-based analysis)
        --title <description> Problem description (no-log source analysis)
        <path>                Shorthand for --dir
      ```

1b. **恢复检查**（在输入解析之后，slug 生成之前）：
   - 如果存在 `--fresh` 标志：删除 `.granada/aosp-analyze-state.json`；仅在验证 `slug` 匹配 `^[A-Za-z0-9._-]{1,40}$`、不含 `..` 或路径分隔符，且解析的目标目录以 `/tmp/aosp-analyze-` 开头之后，再删除 `/tmp/aosp-analyze-<slug>`。使用引号包裹目标路径并使用 `rm -rf -- "$target"`，然后作为全新运行继续。
   - 否则，读取现有状态：`Read .granada/aosp-analyze-state.json`
   - 如果状态存在且 `active == true` 且 `state.input_path` 与当前输入匹配（或 `state.slug` 与导出的 slug 匹配）：
     - 显示："检测到未完成的分析 (phase: <current_phase>)。从断点恢复..."
     - 验证临时目录存在：`ls /tmp/aosp-analyze-<slug>`
     - 在跳过前验证阶段工件 (artifacts)：
       - 跳过至阶段 3：验证 `/tmp/aosp-analyze-<slug>/extracted/` 下有文件
       - 跳过至阶段 4：验证 `anomalies.md` 包含至少一个 `### Anomaly` 或 `### Rank` 标题
       - 跳过至阶段 5：验证 `aosp-context.md` 包含至少一个 `###` 章节标题
       - 跳过至阶段 6：验证 `hypotheses.md` 包含至少一个 `## Hypothesis` 标题且至少一个 `investigation-*.md` 包含 `**Confidence:**` 行
     - 从 `current_phase` 的下一阶段恢复：
       - `initialize` → 开始阶段 2
       - `data-collected` → 开始阶段 3
       - `parsed` → 开始阶段 4
       - `aosp-searched` → 开始阶段 5
       - `investigated` → 开始阶段 6
     - 如果临时目录缺失或工件验证失败：从失败的阶段重启（而非阶段 1）
   - 如果状态存在但输入不匹配：清除旧状态，重新开始
   - 如果没有状态存在：重新开始（正常流程）

2. **生成 slug**：基于输入生成一个 slug 用于临时文件和报告的命名：
   - 基于日志模式：slug = 目录的基名 (basename)（小写，特殊字符 → 连字符）
   - 无日志模式：slug = `--title` 的前 40 个字符（小写，中文 → 拼音首字母缩写或保持原样，特殊字符 → 连字符）
   - 最多 40 个字符，如有需要进行截断。

3. **MCP 健康检查**：
   - AOSP：调用 `sourcepilot(tool="list_tools")` ——如果失败，则中止并提示 "sourcepilot MCP unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."

4. **显示当前激活的 AOSP 项目**：
   - 如果提供了 `--project` 覆盖：显示 `**AOSP Project: <name> (命令行指定)**` 并将此值用于后续所有阶段。跳过读取 `.granada/aosp-config.json`。
   - 否则，读取 `.granada/aosp-config.json`：
     - 如果已配置：显著显示 `**🔍 AOSP Project: <project_name>**`
     - 如果未配置：显示 `**⚠ 未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

5. **初始化状态**：
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

6. **创建临时目录**：
```bash
mkdir -p /tmp/aosp-analyze-<slug>/extracted
```

## 阶段 2：日志收集（通过 aosp-log-collector Agent）

> **模式关卡**：如果 `analysis_mode == "no-log"`，完全跳过阶段 2 和阶段 3。更新状态：`current_phase: "parsed"`，然后直接进入阶段 4。

将所有本地日志目录的复制/软链接、文件组织以及文件分类工作委托给 `aosp-log-collector`。

1. **启动 aosp-log-collector agent**：

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

2. **验证收集输出**：在 Agent 执行完毕后，检查 `/tmp/aosp-analyze-<slug>/extracted/` 目录中是否含有文件，且 `/tmp/aosp-analyze-<slug>/file-classification.json` 是否存在。如果收集器报告失败（FAILED）或有任意工件缺失，则中止并提示 "Log collection failed — extracted logs or classification manifest missing."

3. **更新状态**：将 `current_phase` 更新为 `"data-collected"`，持久化来自收集器摘要的 `log_file_types`。

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-3 -->
## 阶段 3：日志解析与时间线构建（通过 aosp-log-parser Agent）

将所有日志解析工作委托给单个 `aosp-log-parser` agent。该 Agent 读取收集器生成的文件分类清单，运行所有 4 种日志类型的解析器，并在内部执行合并/综合步骤。

1. **启动 aosp-log-parser agent**：

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

2. **验证输出**：在 Agent 执行完毕后，检查 `/tmp/aosp-analyze-<slug>/timeline.md` 和 `/tmp/aosp-analyze-<slug>/anomalies.md` 是否存在。如果不存在，则中止并提示 "Log parsing failed — timeline or anomalies output missing."

3. **更新状态**：将 `current_phase` 更新为 `"parsed"`，`anomaly_count` 更新为 `<N>`（来自 Agent 的摘要）。

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-4 -->
## 阶段 4：AOSP 源码上下文分析

在进行假设调查之前，基于从异常中提取的崩溃特征（基于日志的模式）或基于问题描述（无日志模式）执行专门的 AOSP 源码搜索。此阶段是**强制性的**。

### 提取搜索目标

**基于日志模式 (`analysis_mode == "log-based"`)：**

读取 `/tmp/aosp-analyze-<slug>/anomalies.md` 并提取：
- 堆栈轨迹中的 Java/native 类名（例如：`SurfaceFlinger`、`ActivityManagerService`、`InputDispatcher`）
- Native 库名称（例如：`libsurfaceflinger.so`、`libbinder.so`）
- 内核子系统标识符（例如：`mm/slub.c`、`drivers/gpu/`）
- 信号/错误模式（例如：`SIGSEGV`、`SIGABRT`，以及特定的错误消息）

**无日志模式 (`analysis_mode == "no-log"`)：**

启动一个 analyst 子 Agent 从问题描述中提取结构化的搜索目标：

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

读取生成的 `/tmp/aosp-analyze-<slug>/search-targets.json`，并将其内容作为搜索目标分配给下方的 AOSP investigator 调查员。

### 并行 AOSP 搜索（通过子 Agent）

按子系统将搜索目标分为 2-3 个群组，然后**并行**为每个群组启动一个 aosp-investigator 调查员：

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

### 收集 AOSP 上下文

- 将所有 AOSP investigator 的调查结果合并至 `/tmp/aosp-analyze-<slug>/aosp-context.md`。
- 此文件将作为假设调查（阶段 5）和最终报告（第 4 部分）的数据来源。
- 如果 AOSP 搜索未能返回某个目标的任何结果，将其记录为缺口（gap）——绝不能静默忽略。

更新状态：将 `current_phase` 更新为 `"aosp-searched"`。

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-5 -->
## 阶段 5：假设生成与并行调查

### 假设生成（通过子 Agent）

启动一个 analyst 子 Agent 生成假设：

**基于日志模式：**

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

**无日志模式：**

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

从 `/tmp/aosp-analyze-<slug>/hypotheses.md` 中读取生成的假设。

### 并行调查（通过子 Agent）

为每个假设启动一个 Agent（最多 3 个）。每个 Agent 都会接收阶段 4 的上下文，以避免重复搜索：

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

**重要说明**：并行启动所有假设调查 Agent（它们彼此独立）。

### 收集结果

- 等待所有 Agent 执行完毕。
- 将每个 Agent 的发现解析为结构化格式。
- 保存至 `/tmp/aosp-analyze-<slug>/investigation-<N>.md`。
- 如果某个 Agent 失败或超时，将该假设标记为 "investigation incomplete"（调查未完结）——不要因此使整个技能失败。
- 更新状态：将 `current_phase` 更新为 `"investigated"`，`hypothesis_count` 更新为 `<N>`。

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-6 -->
## 阶段 6：综合与报告

1. **读取调查结果**：从 `/tmp/aosp-analyze-<slug>/investigation-*.md` 和 `/tmp/aosp-analyze-<slug>/aosp-context.md` 中读取数据。

2. **对假设进行排名**：根据置信度（源自调查结果）对各根因假设进行排序。

3. **确定报告标题**：
   - 如果提供了 `--title`：将其用作问题描述。
   - 否则，根据最严重的异常（例如，"SIGSEGV in SurfaceFlinger"）导出。
   - 格式为：`{slug} — {derived_or_provided_description}`

4. **构建包含 7 个部分的中文报告**，脱敏过滤日志片段和问题文本中的常见敏感信息（授权头部、Bearer 令牌、API 密钥、密码、access/refresh/id token、cookies、会话 ID、私钥以及已签名 URL 中的 token/key/signature 查询参数值），最后保存到 `.granada/specs/aosp-analyze-{slug}.md`。

```markdown
# 根因分析报告: {slug} — {issue_title}

**生成时间:** {日期}
**分析模式:** {log-based: "日志驱动分析" | no-log: "无日志源码分析（基于问题描述推断）"}
**输入目录:** {input_path 或 "无（无日志模式）"}
**分析项目:** {project_name 或 "未限定"}

## 1. 问题概述
{问题描述摘要 —— 衍生自异常情况或 --title}

## 2. 事件时间线
{基于日志的模式:}
| 时间 | 来源 | 严重程度 | 事件 |
|------|------|----------|------|
| {时间戳} | {logcat/tombstone/ANR/kernel} | {INFO/WARN/ERROR/FATAL} | {描述} |

{无日志模式:}
> 本次分析未提供日志文件，无事件时间线。以下分析基于问题描述和 AOSP 源码结构推断。

## 3. 关键异常/错误
{基于日志的模式:}
### 异常 1: {标题}
- **严重程度:** {FATAL/ERROR/WARN}
- **来源:** {文件}:{行号}
- **堆栈信息:**
  {堆栈轨迹}

{无日志模式:}
> 本次分析未提供日志文件，无异常提取。以下根因假设基于 AOSP 源码分析推断，而非日志证据。

## 4. AOSP 源码分析
{从 Phase 4 AOSP 源码上下文分析阶段收集的完整源码分析结果}

### 4.1 关键代码路径
{针对每个崩溃相关的类/函数，列出 AOSP 源码路径、代码片段和功能说明}

#### {类或函数名} — {aosp_文件路径}
- **源码位置:** `{aosp/path/to/file.java}:{行号范围}`
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
| 1 | {标题} | {高/中/低} | {证据摘要} |

### 假设 1: {标题} (置信度: {级别})

> **无日志模式约束:** 当 `analysis_mode == "no-log"` 时，所有假设的置信度上限为"中"，不允许标注"高"。报告中应注明"本分析基于源码推断，未经日志证据验证"。

**支持证据:**
- {要点}
**反对证据:**
- {要点}
**AOSP 上下文:** {相关的源码搜索发现}

## 6. 受影响组件图
{显示受影响 Android 子系统及其关系的 ASCII 图}

## 7. 建议修复方案
1. {修复行动，需指出具体的文件/组件引用}
2. {修复行动}
```

<!-- /SYNC -->

5. **完成状态更新与清理工作**：
   - 运行成功：`Bash: rm -f .granada/aosp-analyze-state.json` —— 终端退出。
   - 出错中止：将 `{"active": false, current_phase="error"}` 写入 `.granada/aosp-analyze-state.json` —— 保留状态以供调试。
   - 向用户通知报告的保存路径。

</Steps>

<Error_Handling>
在所有阶段中嵌入这些错误处理程序：

- **AOSP MCP 不可达** → 中止并提示 "sourcepilot MCP unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."
- **输入路径不存在** → 中止并提示 "Path not found: <path>"
- **输入路径不是目录** → 中止并提示 "Path is not a directory: <path>. Provide a directory containing extracted Android logs."
- **未找到 Android 日志文件** → 中止并提示 "No Android log files found in the directory. Supported types: logcat, tombstone, ANR traces, kernel logs."
- **日志解析失败** → 中止并提示 "Log parsing failed — timeline or anomalies output missing. Check aosp-log-parser agent output."
- **AOSP 搜索未返回结果** → 在报告中注明 "no AOSP source found"（未找到 AOSP 源码），但不导致流程失败
- **Agent 超时/失败** → 将该假设标记为 "investigation incomplete"（调查未完结），并继续其他调查
- **所有假设均调查失败** → 报告以 "insufficient evidence"（证据不足）作为结论
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

状态文件保持轻量（<10KB）。解析后的数据保存在临时文件（`/tmp/aosp-analyze-<slug>/`）中，而不是直接保存在状态中。

在每个阶段的边界更新状态以支持断点恢复。恢复时，通过 `Read .granada/aosp-analyze-state.json` 读取状态并从 `current_phase` 继续。
</State_Schema>

<Tool_Usage>
- `sourcepilot` — 搜索与崩溃相关的 AOSP 源码（始终调用，非条件调用）
- `Write` / `Read` / `Bash rm` — 通过 `.granada/aosp-analyze-state.json` 实现阶段持久化
- `Agent(subagent_type="zaku:aosp-log-collector", model="sonnet")` — 本地日志目录准备与分类清单生成（阶段 2）
- `Agent(subagent_type="zaku:aosp-log-parser", model="sonnet")` — 日志解析以及从收集器生成的分类清单构建时间线（阶段 3）
- `Agent(subagent_type="zaku:analyst", model="sonnet")` — 假设生成（阶段 5）
- `Agent(subagent_type="zaku:aosp-investigator", model="sonnet")` — AOSP 上下文搜索（阶段 4）+ 并行假设调查（阶段 5）
- `Write` — 保存最终报告
</Tool_Usage>

<Examples>
<Good>
```
User: /aosp-analyze --dir /tmp/crash-logs --title "SystemUI crash after OTA"

[Phase 1] 输入：目录 /tmp/crash-logs。Slug：crash-logs。AOSP MCP 健康检查通过。
          AOSP 项目：android-14（来自 .granada/aosp-config.json）
[Phase 2] 已启动 aosp-log-collector Agent。
          收集完成 → 8 个文件已分类：2 logcat、1 tombstone、1 ANR、0 kernel、4 other。
[Phase 3] 已启动 aosp-log-parser Agent。
          已完成 → 312 个时间线事件，7 个异常。
          最关键的异常：libsurfaceflinger.so 中的 SIGSEGV，SystemUI 中的 ANR。
[Phase 4] AOSP 源码上下文：并行启动了 2 个 aosp-investigator Agent。
          群组 1 (SurfaceFlinger)：在 SurfaceFlinger::onMessageReceived 中发现空指针检查缺失。
          群组 2 (SystemUI)：在 ActivityManagerService 中发现 SystemUI binder 线程池配置。
          已保存 aosp-context.md（含 5 个 AOSP 源码搜索发现）。
[Phase 5] 启动 analyst 子 Agent → 生成 2 个假设：
          H1: SurfaceFlinger 空指针解引用 (FATAL, 最早发生)
          H2: SystemUI 因 Binder 线程耗尽导致 ANR (ERROR)
          并行启动了 2 个 aosp-investigator Agent。
          H1: 置信度 高 —— 在 SurfaceFlinger::onMessageReceived 中发现相符的代码路径
          H2: 置信度 中 —— 线程池配置符合，但没有直接证据
[Phase 6] 报告保存至 .granada/specs/aosp-analyze-crash-logs.md（中文，7 个部分）。
```
好的原因：所有探索和分析工作都委托给了子 Agent。输入参数清晰（--dir）。已配置 AOSP 项目。执行了完整流水线，且 aosp-log-parser Agent 妥善处理了并行解析。
</Good>

<Good>
```
User: /aosp-analyze --title "SurfaceFlinger 在旋转屏幕时崩溃"

[Phase 1] 无日志模式 (no-log). Slug: surfaceflinger-rotate-crash. MCP 健康检查通过。
          AOSP 项目：android-14（来自 .granada/aosp-config.json）
[Phase 2] 跳过（无日志模式）
[Phase 3] 跳过（无日志模式）
[Phase 4] 启动 analyst → 从问题描述提取搜索目标: SurfaceFlinger, display rotation, WindowManagerService
          并行启动了 2 个 aosp-investigator Agent。
          群组 1 (SurfaceFlinger): 发现 SurfaceFlinger::setTransactionState 旋转处理。
          群组 2 (WindowManager): 发现 DisplayRotation::rotateDisplay 锁顺序。
          已保存 aosp-context.md（含 4 个 AOSP 源码搜索发现）。
[Phase 5] 启动 analyst 子 Agent → 生成 2 个假设 (置信度上限: 中):
          H1: SurfaceFlinger 旋转事务竞态条件 (中)
          H2: DisplayRotation 配置更改期间的死锁锁顺序反转 (中)
          并行启动了 2 个 aosp-investigator Agent。
[Phase 6] 报告保存至 .granada/specs/aosp-analyze-surfaceflinger-rotate-crash.md（中文，7 个部分）。
```
好的原因：无日志模式正确跳过了阶段 2/3。由 analyst 从 --title 提取搜索目标。置信度上限被设为"中"。生成了完整的 7 部分报告，第 2 和第 3 部分已注明缺少日志证据。
</Good>

<Good>
```
User: /aosp-analyze /home/user/bugreport-logs

[Phase 1] 输入：目录 /home/user/bugreport-logs。Slug：bugreport-logs。AOSP MCP 健康检查通过。
          未配置 AOSP 项目 —— 搜索所有项目。
[Phase 2] aosp-log-collector 已对 15 个文件进行分类 → 4 logcat, 3 tombstone, 2 ANR, 1 kernel, 5 other。
[... 管道的其余部分 ...]
```
好的原因：支持位置参数的路径简写。在没有配置 AOSP 项目时，能搜索所有项目并给出明确的警告信息。
</Good>

<Bad>
```
User: /aosp-analyze --sn ABC123456
[Phase 1] 未找到有效的日志目录。
```
不好的原因：不支持 `--sn` 参数。用户应当先提取日志，或者直接提供目录路径。
</Bad>

<Bad>
```
User: /aosp-analyze /path/to/nonexistent
[Phase 1] 路径未找到: /path/to/nonexistent。中止。
```
好的原因：在路径不存在时能尽早正确中止。
</Bad>
</Examples>

<Guardrails>
**必须包含 (Must have)：**
- 使用 sourcepilot 搜索 AOSP 源码（始终执行，非条件化执行） —— **阶段 4 AOSP 源码分析是必选阶段**，除非十分确认问题与 AOSP 源码完全无关才可跳过
- 在阶段 4（AOSP 上下文）和阶段 5（假设调查）中均使用 aosp-investigator 子 Agent
- 轻量级状态（<10KB，仅记录文件路径而不记录数据内容）
- 报告必须包含所有 7 个部分（用中文撰写）
- 报告保存到 `.granada/specs/aosp-analyze-{slug}.md`
- 所有探索/分析工作全部委托给子 Agent 执行（文件分类、日志解析、时间线合并、假设生成、AOSP 调查）
- 领队（Lead）仅扮演编排器角色：处理 MCP 调用、状态管理、启动子 Agent 和组装报告

**绝不能包含 (Must NOT have)：**
- JIRA MCP 依赖（即不包含 jira_get_issue、jira_download_attachments、jira_add_comment）
- zip/sn input modes（仅支持 --dir 或目录路径，不支持 --zip 或 --sn）
- 对 log-unboxer 的依赖
- 交互式/对话模式（生成的是静态报告）
- iOS 或非 Android 系统的日志解析
- 对二进制附件的处理（如图片、视频）
- 猜测问题的上下文 —— 必须严格基于日志和 --title 导出
</Guardrails>
