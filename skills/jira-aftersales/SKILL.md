---
description: Convert technical jira-analyze RCA reports into customer-friendly aftersales scripts in Chinese. Posted as JIRA comment for customer service agents.
argument-hint: <JIRA URL or issue key>
model: opus
triggers:
  - "jira aftersales"
  - "jira_aftersales"
  - "aftersales jira"
  - "售后话术"
  - "jira 售后"
handoff: .granada/specs/jira-aftersales-{issue_key}.md
level: 3
---

<Purpose>
Converts technical jira-analyze RCA (Root Cause Analysis) reports into customer-friendly aftersales scripts that customer service agents can copy-paste directly to end users. The skill reads an existing jira-analyze report (from local file or JIRA comments), transforms developer-oriented analysis into a 4-section Chinese template (问题现象 / 原因分析 / 解决方案 / 注意事项), enforces terminology filtering via deterministic grep post-processing, and posts the result as a JIRA comment.
</Purpose>

<Use_When>
- User wants a customer-facing summary of a jira-analyze technical report
- User says "售后话术", "jira aftersales", "jira 售后"
- Customer service agent needs a copy-paste response for an end user about a bug
- A jira-analyze report exists (locally or in JIRA comments) and needs to be translated to plain language
</Use_When>

<Do_Not_Use_When>
- No jira-analyze report exists yet — run `/zaku:jira-analyze <KEY>` first
- User wants the full technical RCA report — use `jira-analyze` directly
- User wants interactive conversation about the bug — this produces a static script
- Issue is not Android-related — jira-analyze only handles Android logs
- User wants to parse logs or search AOSP source — this skill is a consumer, not a producer
</Do_Not_Use_When>

<Steps>

## Phase 1: Initialize

1. **Parse `{{ARGUMENTS}}`** to extract the issue key:
   - URL pattern: extract key from `https://<domain>/browse/<KEY>` via regex
   - Direct key pattern: validate `^[A-Z][A-Z0-9_]+-\d+$`
   - If neither matches, abort with: "无法解析 JIRA issue key。请提供 URL (https://jira.example.com/browse/PROJ-123) 或 key (PROJ-123)。"

2. **MCP health check**: `jira_get_issue(issue_key=<KEY>, fields="summary")` — if fails, abort with "mcp-atlassian 不可用。请检查 JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN 环境变量。"

3. **Create temp directory**:
```bash
mkdir -p /tmp/jira-aftersales-<KEY>
```

## Phase 2: Detect Existing Report (3-tier fallback)

### Tier 1: Local file (primary — most reliable, no API dependency)

- Read `.granada/specs/jira-analyze-{KEY}.md` using Read tool
- If file exists and contains `# 根因分析报告:` — use this as the report text
- Proceed to Phase 3

### Tier 2: JIRA comments (secondary — works across machines)

- If local file not found: call `jira_get_issue(issue_key=<KEY>, comment_limit=50)`
- Scan each comment body for line starting with `# 根因分析报告:`
- If multiple matches: use the one with the latest timestamp (parse from comment metadata, not array position — comment ordering is not guaranteed)
- Extract the full comment body as raw report text
- Proceed to Phase 3

### Tier 3: User instruction (fallback — no report available)

- If neither local file nor JIRA comment contains a report:
- Display: "未找到 jira-analyze 分析报告。请先运行 `/zaku:jira-analyze <KEY>` 生成分析报告，然后重新运行本 skill。"
- Abort gracefully.

<!-- Design note: We intentionally do NOT auto-invoke jira-analyze via Skill() mid-execution.
     Instructing the user to run jira-analyze first keeps this workflow single-purpose and predictable. -->

## Phase 3: Check for Duplicate Aftersales Scripts

- If comments were already fetched in Tier 2, reuse them. Otherwise fetch: `jira_get_issue(issue_key=<KEY>, comment_limit=50)`
- Scan each comment body for line starting with `# 售后话术:`
- If found: warn user "该问题已存在售后话术评论。将重新生成并覆盖。"
- Proceed to Phase 4 regardless (regeneration is allowed)

## Phase 4: Transform to Aftersales Script

### 4a: Report completeness check

- Verify presence of key section markers in the report text:
  - `## 1. 问题概述` — problem overview (required)
  - `## 5. 根因假设排名` — root cause hypotheses (important)
  - `## 7. 建议修复方案` — fix recommendations (important)
- If `## 5.` is missing: mark as partial, note in transformation prompt that root cause hypotheses are unavailable
- If `## 7.` is missing: mark as partial, note in transformation prompt that fix recommendations are unavailable
- If both `## 1.` and `## 5.` are missing: abort with "分析报告不完整，缺少问题概述和根因假设，无法生成话术。"

### 4b: Transformation subagent

Spawn an executor subagent:

```
Agent(
  subagent_type="zaku:executor",
  model="sonnet",
  prompt="你是一个售后话术转换专家。将技术性的根因分析报告转换为客服人员可以直接复制粘贴给用户的售后话术。

**输入：** 以下是一份技术性根因分析报告：
---
{full_report_text}
---

{partial note if applicable: ⚠ 该报告不完整，缺少以下章节：{missing_sections}。请基于现有内容生成话术，对于缺失部分使用\"需进一步排查\"代替猜测。}

**输出要求：** 严格按照以下4个章节输出售后话术：

# 售后话术: {issue_key} — {issue_title}

## 问题现象
用用户能理解的语言描述问题表现。例如：使用某个功能时应用会闪退、设备会重启、画面卡住不动等。不要使用任何技术术语。

## 原因分析
用通俗语言解释为什么会发生这个问题。将技术根因翻译成日常类比或简单因果关系。

## 解决方案
给出用户可以执行的具体操作步骤。每一步都要明确、可操作。

## 注意事项
提醒用户如何避免类似问题再次发生，以及什么情况下需要进一步联系售后。

**术语转换示例（必须参照这些示例的转换风格）：**
- \"SurfaceFlinger crash\" → \"画面显示功能遇到了问题\"
- \"binder IPC failure\" → \"系统内部通信出现异常\"
- \"null pointer dereference\" → \"程序遇到了无法处理的数据\"
- \"memory leak / oom\" → \"程序占用了过多资源\"
- \"ANR (Application Not Responding)\" → \"应用没有响应，画面卡住不动\"
- \"kernel panic\" → \"系统遇到了严重错误并自动重启\"

**严格禁止使用的术语（绝对不能出现在输出中）：**
ANR, NullPointerException, tombstone, 空指针, 死锁, SIGSEGV, SIGABRT, stack trace, 堆栈, backtrace, kernel panic, slab corruption, binder, SurfaceFlinger, ActivityManagerService, oom, out of memory, 内存溢出, crash log, logcat, dmesg, kmsg, native crash, JNI, segfault, memory leak, 内存泄漏, 以及任何其他开发者术语

**允许使用的基础名词：** 闪退, 崩溃, 重启, 卡顿, 版本, 更新, 设备, 应用, 功能, 数据, 系统, 画面, 操作

**自检要求：** 生成话术后，必须逐字检查输出，确认没有任何禁止术语出现。如果发现，立即替换为通俗表达后重新输出。

保存输出到 /tmp/jira-aftersales-<KEY>/aftersales-script.md"
)
```

### 4c: Deterministic grep post-processing

After receiving subagent output:

1. Read `/tmp/jira-aftersales-<KEY>/aftersales-script.md`
2. Run forbidden term grep (word boundaries for short English terms to avoid false positives):
```bash
grep -iE '\bANR\b|NullPointerException|tombstone|空指针|死锁|\bSIGSEGV\b|\bSIGABRT\b|stack.?trace|堆栈|backtrace|kernel.?panic|slab.?corruption|binder|SurfaceFlinger|ActivityManagerService|\bOOM\b|out.?of.?memory|内存溢出|crash.?log|logcat|dmesg|kmsg|native.?crash|\bJNI\b|segfault|memory.?leak|内存泄漏' /tmp/jira-aftersales-<KEY>/aftersales-script.md
```
3. If any violations found:
   - Re-invoke subagent with same prompt + added section: "⚠ 上一版输出中包含以下禁止术语：{violations}。请严格替换这些术语后重新生成。"
   - Re-grep after second invocation
   - If violations persist after 2 attempts: append warning to output: "\n\n---\n⚠ 此话术可能包含技术术语，请人工审核后使用。"

## Phase 5: Post and Finalize

1. Read the aftersales script from `/tmp/jira-aftersales-<KEY>/aftersales-script.md`

2. **Post as JIRA comment**: `jira_add_comment(issue_key=<KEY>, body=<script_content>)` — if this fails, warn but do not abort (the local copy is still available).

3. **Save local copy** to `.granada/specs/jira-aftersales-{issue_key}.md`

4. Announce completion: "售后话术已生成并发布到 JIRA 评论。本地副本保存在 .granada/specs/jira-aftersales-{KEY}.md"

</Steps>

<Error_Handling>
- **MCP unreachable** → abort with "mcp-atlassian 不可用。请检查 JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN 环境变量。"
- **No jira-analyze report found (all 3 tiers)** → instruct user to run `/zaku:jira-analyze <KEY>` first, abort gracefully
- **Report too incomplete for transformation** → abort with message explaining which sections are missing: "分析报告不完整，缺少{sections}，无法生成话术。"
- **Transformation produces forbidden terms after 2 attempts** → append warning "⚠ 此话术可能包含技术术语，请人工审核后使用。", proceed with output
- **Duplicate aftersales script detected** → warn user, proceed with regeneration
- **JIRA comment post fails** → warn user, provide local file path as fallback: "JIRA 评论发布失败，本地副本已保存在 .granada/specs/jira-aftersales-{KEY}.md"
</Error_Handling>


<Tool_Usage>
- `Read` tool — check local file `.granada/specs/jira-analyze-{KEY}.md` (primary detection, Tier 1)
- `jira_get_issue` — fetch issue details and comments (mcp-atlassian). Reads comments for report detection (Tier 2) and duplicate check (Phase 3).
- `jira_add_comment` — post aftersales script as comment on JIRA issue (mcp-atlassian)
- `Agent(subagent_type="zaku:executor", model="sonnet")` — transformation subagent (Phase 4b)
- `Bash` — grep post-processing for forbidden terminology (Phase 4c), temp directory management
- `Write` tool — save aftersales script to local file (.granada/specs/)
</Tool_Usage>

<Examples>
<Good>
```
User: /jira-aftersales SPFB-535

[Phase 1] Parsed key: SPFB-535. MCP health check pass.
[Phase 2] Tier 1: Found local file .granada/specs/jira-analyze-SPFB-535.md. Using local report.
[Phase 3] No existing aftersales script in JIRA comments.
[Phase 4] Report completeness: full (all 7 sections present).
         Spawned executor subagent for transformation.
         Grep post-processing: 0 forbidden terms found. Clean output.
[Phase 5] Posted aftersales script as JIRA comment on SPFB-535.
         Local copy saved to .granada/specs/jira-aftersales-SPFB-535.md.
```
Why good: Local file found (fastest path), clean transformation, no terminology leakage.
</Good>

<Good>
```
User: /jira-aftersales https://jira.example.com/browse/SPFB-600

[Phase 1] Parsed key: SPFB-600. MCP health check pass.
[Phase 2] Tier 1: No local file found.
         Tier 2: Found jira-analyze report in JIRA comments (comment #42).
[Phase 3] No existing aftersales script.
[Phase 4] Report completeness: partial (missing ## 7. 建议修复方案).
         Spawned executor with partial report note.
         Grep post-processing: 1 violation found ("binder").
         Re-invoked subagent with violation highlighted.
         Second grep: 0 violations. Clean output.
[Phase 5] Posted aftersales script. Local copy saved.
```
Why good: Falls back to JIRA comments when local file is absent. Handles partial report. Grep catches leaked term and retries.
</Good>

<Good>
```
User: /jira-aftersales SPFB-700

[Phase 1] Parsed key: SPFB-700. MCP health check pass.
[Phase 2] Tier 1: No local file.
         Tier 2: No jira-analyze report in JIRA comments.
         Tier 3: "未找到 jira-analyze 分析报告。请先运行 /zaku:jira-analyze SPFB-700
                  生成分析报告，然后重新运行本 skill。"
```
Why good: Cleanly instructs user to run jira-analyze first. Does not attempt mid-execution Skill() invocation.
</Good>

<Bad>
```
[Phase 4] Output contains: "该问题是由于 SurfaceFlinger 进程的 binder 通信异常导致的 ANR..."
```
Why bad: Contains developer terminology (SurfaceFlinger, binder, ANR). Should be: "该问题是由于系统在处理画面显示时遇到了内部通信异常，导致应用没有响应并卡住不动。"
</Bad>

<Bad>
```
[Phase 3] No report found. Invoking Skill("zaku:jira-analyze", "SPFB-535")...
```
Why bad: Unexpected nested workflow. Must instruct user to run jira-analyze first instead.
</Bad>
</Examples>

<Guardrails>
**Must have:**
- mcp-atlassian for JIRA access (not jira-cli)
- jira-analyze report available (local file or JIRA comment) before transformation
- 3-tier detection: local file → JIRA comment scan → user instruction
- Fixed Chinese output in the 4-section template (问题现象 / 原因分析 / 解决方案 / 注意事项)
- Forbidden terminology list with deterministic grep post-processing
- Few-shot transformation examples (6 examples) in the subagent prompt
- Duplicate aftersales script detection via `# 售后话术:` signature
- Partial report handling with adapted transformation prompt
- Report posted as JIRA comment via jira_add_comment
- Local copy saved to `.granada/specs/jira-aftersales-{KEY}.md`

**Must NOT have:**
- Mid-execution `Skill()` invocation of jira-analyze
- Re-implementation of RCA logic (delegate to jira-analyze)
- Interactive/conversational mode (produces a static aftersales script)
- Direct log file parsing or AOSP source searching
- Developer-facing technical terminology in the output (ANR, tombstone, etc.)
- iOS or non-Android log handling
</Guardrails>
