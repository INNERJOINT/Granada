---
name: aosp-feature-import
description: Import an exported AOSP feature element report into a different AOSP project, mapping source code locations to target and producing an executable import plan
argument-hint: '"<path-to-export-report>" [--target <project>] [--depth shallow|deep] [--execute]'
model: opus
pipeline: [aosp-feature-import, aosp-autopilot]
level: 3
---

# AOSP Feature Import Skill

Takes an exported feature element report (功能元报告, produced by `aosp-feature-export`) and ports it to a different AOSP codebase. Parses the export report to extract vendor modification points, searches BOTH the source AOSP project (from the report) and the target AOSP project (current config or `--target`) in parallel, maps code locations across projects, identifies API/module gaps, and produces a structured import guide saved to `.granada/aosp-imports/`.

**Key distinction from aosp-feature-export:** The export skill discovers what vendor code touches in ONE AOSP tree. The import skill maps those touch points to a DIFFERENT AOSP tree, identifying where the same vendor modifications should be applied and what adaptations are needed.

## Usage

```
/zaku:aosp-feature-import .granada/aosp-exports/public-dns.md
/zaku:aosp-feature-import .granada/aosp-exports/fingerprint-unlock.md --target rk3588_android14
/zaku:aosp-feature-import .granada/aosp-exports/usb-audio-routing.md --depth shallow
/zaku:aosp-feature-import .granada/aosp-exports/public-dns.md --execute
```

## Flags

- `--target <project>`: Override the target AOSP project (default: reads from `.granada/aosp-config.json`)
- `--depth shallow|deep`: Controls investigation depth (default: `deep`)
  - `shallow`: Phase 2 runs 1 round only, no convergence check. Useful for quick feasibility assessment.
  - `deep`: Phase 2 runs up to 4 rounds with convergence-based termination.
- `--execute`: After producing the import guide, automatically generate an `aosp-autopilot`-compatible plan and hand off for execution.
- `--skip-source-verify`: Trust the export report without verifying against the source project. Reduces sourcepilot calls by ~50% but risks stale mappings.

## When to Use

- You have an `aosp-feature-export` report and need to apply the same vendor feature to a different AOSP project/SoC tree
- Porting vendor customizations between Android versions (e.g., Android U to Android 14 AOSP)
- Porting vendor customizations between SoC platforms (e.g., MT8781 to RK3588)
- User says "aosp import", "feature import", "功能导入", "移植功能"

## When NOT to Use

- No export report exists yet — run `/zaku:aosp-feature-export` first
- Source and target are the same project — the export report already has all the information
- The feature is an AOSP built-in (not a vendor customization) — use `aosp-plan` instead

## Protocol

### Step 0: State Initialization

```
Write JSON to .granada/aosp-feature-import-state.json with, active=true, task_description="Import: <report_filename>")
```

### Step 1: Health Check and Project Resolution

**1a. MCP Health Check**

Call `sourcepilot` with `tool: "list_tools"` to verify MCP server reachability.

On failure:
```
Bash: rm -f .granada/aosp-feature-import-state.json
```
Abort with: `AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.`

**1b. Resolve Target Project**

Determine the target AOSP project:
1. If `--target <project>` flag provided: use that value
2. Otherwise: read `.granada/aosp-config.json` for the active project
3. If neither available: abort with `未指定目标 AOSP 项目。使用 --target <project> 或运行 /zaku:aosp-project 设置。`

**1c. Parse Export Report**

Read the export report file. Extract:
- `source_project`: from the "AOSP项目" field in the report's 概览 section
- `feature_name`: from the report title
- `feature_description`: from the 功能 field in 概览
- `vendor_modifications`: from the Vendor修改概述 section
- `key_interfaces[]`: from the 关键接口 section (interface name, file path, type, code snippet)
- `project_table[]`: from the 相关AOSP项目 table (project path, layer, relationship)
- `code_paths{}`: from the 各项目代码路径 section (grouped by project prefix)
- `architecture_overview`: from the 架构总览 section
- `dependencies[]`: from the 依赖关系 section

**1c-validate. Format Validation**

After parsing, verify that the export report contains the mandatory sections. Check for the presence of at least 3 of these 5 required sections:
- `概览` (with `AOSP项目` field)
- `Vendor修改概述`
- `关键接口` OR `各项目代码路径` (at least one must exist)
- `相关AOSP项目`
- `架构总览`

If fewer than 3 are found, abort with:
```
导出报告格式不兼容或缺少必要章节: {missing_sections}。请使用最新版 aosp-feature-export 重新导出。
```

If `概览` section exists but `AOSP项目` field is missing or empty, abort with:
```
导出报告缺少源 AOSP 项目信息。请确认报告由 aosp-feature-export 生成。
```

**1d. Validate Projects**

- If `source_project` == target project: abort with `源项目与目标项目相同 (<project>)。无需导入。`
- Display prominently:
  ```
  **功能导入配置:**
  - 源 AOSP 项目: <source_project> (来自导出报告)
  - 目标 AOSP 项目: <target_project>
  - 功能: <feature_name>
  - 关键接口数: <count>
  - 涉及AOSP项目数: <count>
  ```

### Step 2: Component Extraction

From the parsed export report, build a component list for investigation. Each component represents a discrete mapping task:

```json
{
  "components": [
    {
      "id": "comp-1",
      "name": "<interface or module name>",
      "source_paths": ["<path1>", "<path2>"],
      "layer": "HAL|Framework|System|App",
      "interfaces": ["<interface names>"],
      "keywords": ["<search terms derived from code snippets and descriptions>"],
      "priority": "critical|important|optional"
    }
  ]
}
```

**Priority assignment:**
- `critical`: Components in the 依赖关系 section or marked as entry points in Vendor修改概述
- `important`: Components in the 关键接口 section
- `optional`: Components only appearing in 各项目代码路径 without interface significance

Cap at 10 components. If the export report contains more, merge related components (same second-level prefix) and prioritize by criticality. When merging components of different priorities, the merged component inherits the highest priority (e.g., merging a `critical` with an `optional` produces a `critical` component).

### Step 3: Phase 1 — Parallel Dual-Project Investigation

For each `critical` and `important` component (up to 6), spawn paired `aosp-investigator` subagents — one searching the source project, one searching the target project. All pairs run in parallel.

**Source investigator** (verify/enrich export context):

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Verify and enrich AOSP code context for a VENDOR feature import.

  **AOSP Project Override:** Use project '<source_project>' for ALL sourcepilot search calls. Do NOT read .granada/aosp-config.json — the project has been specified explicitly by the orchestrator.

  Component: <component.name>
  Expected file paths from export report:
  <component.source_paths>

  Expected interfaces:
  <component.interfaces>

  Your mission:
  1. Verify the listed file paths still exist in the source project
  2. For each path found: extract the current code snippet (may differ from export if source was updated)
  3. Identify the exact class signatures, method signatures, and AIDL/HIDL definitions
  4. Note any version-specific annotations (@since, API level guards, @SystemApi)
  5. Document the package/namespace structure

  Report: For each verified path, provide the exact signatures and structural context needed to find the equivalent in another AOSP tree."
)
```

**Target investigator** (find corresponding code):

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Find corresponding AOSP code in the TARGET project for a vendor feature port.

  **AOSP Project Override:** Use project '<target_project>' for ALL sourcepilot search calls. Do NOT read .granada/aosp-config.json — the project has been specified explicitly by the orchestrator.

  Component: <component.name>
  Source project paths (from a different AOSP tree):
  <component.source_paths>

  Interfaces to find equivalents for:
  <component.interfaces>

  Search keywords:
  <component.keywords>

  Your mission:
  1. Search for the same classes/interfaces by name — they may be at different paths
  2. If exact match not found, search by symbol name (class name, method name)
  3. If symbol not found, search by functionality keywords — the target may use a different implementation
  4. For each finding: document the EXACT file path, class signature, and any API differences from the source paths
  5. Note if a module/interface is MISSING entirely from the target project

  Report: For each source path, provide either:
  - FOUND: target path + any signature differences
  - MOVED: target path differs from source path + explanation
  - CHANGED: target has the module but API differs significantly + details
  - MISSING: module/interface does not exist in target + closest alternative (if any)"
)
```

**If `--skip-source-verify` is set:** Skip source investigators entirely. Only spawn target investigators, using the export report data as-is for source context.

### Step 3b: Post-Phase-1 Validation

After all Phase 1 agents complete, perform a lightweight cross-check to detect project override failures:

1. For each source investigator result: verify that reported file paths are consistent with the source project (not the target). Check that at least one finding references a path or repo name that differs from what the target investigator found.
2. For each target investigator result: verify findings reference the target project context.
3. If any agent appears to have searched the wrong project (e.g., a "source" investigator reports paths identical to target findings with target-specific markers), flag it and re-spawn that single agent with reinforced override instructions.

This step adds minimal cost (reading existing agent output) while catching the most dangerous failure mode of prompt-level project override.

### Step 4: Phase 2 — Gap Analysis and Expansion

**Depth gate:** If `--depth shallow`, execute exactly 1 round with 2 target-only agents focused on gaps. Skip convergence check and proceed to Step 5.

After Phase 1, categorize all components by mapping status:
- **MAPPED**: Both source verified and target found (exact or moved)
- **DIVERGED**: Target has the module but with significant API changes
- **MISSING**: Target lacks the module entirely
- **UNVERIFIED**: Source verification failed (path not found in source)

For DIVERGED and MISSING components, spawn additional target investigators (up to 4 rounds, max 12 total agents across all phases):

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="Deep investigation for a MISSING/DIVERGED component in target AOSP project.

  **AOSP Project Override:** Use project '<target_project>' for ALL sourcepilot search calls. Do NOT read .granada/aosp-config.json — the project has been specified explicitly by the orchestrator.

  Component: <component.name>
  Status: <DIVERGED|MISSING>
  
  Source context (from the other AOSP tree):
  - Paths: <source_paths>
  - Interfaces: <interfaces>
  - Architecture role: <from export report>

  What we know about the target:
  <findings from Phase 1 target investigator>

  Your mission:
  - For DIVERGED: Find the exact API differences. Document what changed (added/removed methods, changed signatures, different base classes). Identify adaptation points.
  - For MISSING: Search broadly for alternative implementations. Check if the functionality was:
    a) Moved to a different module/package
    b) Replaced by a newer API
    c) Removed entirely (check git history if available)
    d) Implemented differently (different class hierarchy)
  
  Report the adaptation strategy: what code changes are needed to bridge the gap."
)
```

**Convergence check:** After each round, count the number of new adaptation points discovered (new target paths, new API differences, new alternative implementations). If a round produces zero new adaptation points across all investigated components, stop. A component remaining DIVERGED/MISSING is NOT sufficient to continue — only genuinely new information justifies another round.

**Progress reporting:** After each round:
```
Phase 2 Round N: 调查 X 个差异组件, 新发现 Y 个适配点 (MAPPED: A, DIVERGED: B, MISSING: C)
```

### Step 5: Synthesis — Import Guide Generation

Merge all investigator findings into a structured import guide:

1. **Build mapping table:** For each component, create a source→target path mapping with status and adaptation notes
2. **Identify adaptation patterns:** Group DIVERGED components by type of divergence (API level, module restructure, implementation change)
3. **Generate modification instructions:** For each MAPPED component, describe what vendor code changes are needed at the target path. For DIVERGED components, describe the adaptation required.
4. **Risk assessment:** Flag components where the port is high-risk (MISSING dependencies, major API changes, architectural differences)
5. **Dependency ordering:** Based on the export report's 依赖关系 section and the mapping results, determine the order in which components should be ported
6. **Generate the import guide** in Chinese using the output template below

### Step 6: Plan Generation (if `--execute`)

If `--execute` flag is set, additionally generate an `aosp-autopilot`-compatible plan:

**6a. Pre-check: Verify AOSP source tree availability**

Before generating the execution plan, verify that a `repo`-managed AOSP source tree is accessible:

```bash
path=$(pwd)
while [ "$path" != "/" ]; do
  if [ -d "$path/.repo" ]; then echo "$path"; break; fi
  path=$(dirname "$path")
done
```

If `.repo/` is not found, warn the user and skip plan generation:
```
⚠ 未检测到 AOSP 源码树（未找到 .repo/ 目录）。执行计划需要 repo 管理的源码树。
导入指南仍将保存，但无法自动执行。如需执行，请在 AOSP 源码树中重新运行。
```

**6b. Generate plan**

1. Convert the import guide's modification instructions into the `aosp-plan` Evidence-Based Plan format:
   ```markdown
   ## Evidence-Based Plan

   ### Step 1: <action based on highest-priority MAPPED component>
   - **Evidence:** [Import investigation findings]
   - **AOSP files:** <target_paths>
   - **Acceptance criteria:** [Verifiable outcome]
   ```

2. Save the execution plan to `.granada/plans/aosp-import-<slug>.md`

**6c. Quality Gate — Architect + Critic Review**

Review the generated execution plan for AOSP-specific quality. This step runs automatically when `--execute` is set.

**Sequential enforcement**: Architect MUST complete before Critic starts. Do NOT run both in parallel.

**Architect review** via `Agent(subagent_type="zaku:architect", ...)`:

Review focus:
- Cross-project mapping correctness (source→target path mappings are sound)
- Adaptation strategy validity (DIVERGED components have feasible adaptation plans)
- Dependency ordering correctness (no circular or missing dependencies)
- Treble/HIDL boundary compliance in target project
- Risk assessment completeness (MISSING components properly flagged)
- Steelman antithesis: strongest argument against the proposed port approach

Wait for Architect completion before proceeding to Critic.

**Critic evaluation** via `Agent(subagent_type="zaku:critic", ...)`:

Quality criteria:
- 80%+ plan steps cite investigation findings from Phase 1/2 (no unsupported claims)
- 90%+ acceptance criteria reference verifiable outcomes (build, adb shell, logcat)
- DIVERGED components have concrete adaptation code or guidance (not just "需要适配")
- MISSING components have explicit fallback strategy or are flagged as blockers
- Each step's target file paths were confirmed by target investigators (not copied blindly from source)
- Build system references (Android.bp/mk) included for steps that add/modify modules

Critic MUST reject: unverified target paths (not found by any investigator), acceptance criteria that cannot be mechanically checked, DIVERGED adaptations without code examples, dependency ordering that contradicts investigation findings.

**Re-review loop** (max 2 iterations):
If Critic rejects: collect feedback → revise plan → Architect → Critic → repeat.
If 2 iterations reached without approval: present best version to user with Critic's remaining concerns via `AskUserQuestion`.

**Apply improvements**:
On approval with suggestions: deduplicate, merge into plan, update the saved plan file.

3. Present to user for approval before handoff

### Step 7: Save

1. Generate slug from feature name: lowercase, replace spaces/special chars with hyphens, max 50 chars
2. Create `.granada/aosp-imports/` directory if it doesn't exist
3. Write import guide to `.granada/aosp-imports/<slug>.md`
4. If `--execute` plan was generated, save to `.granada/plans/aosp-import-<slug>.md`
5. Call `Bash: rm -f .granada/aosp-feature-import-state.json`
6. Confirm to user:
   ```
   功能导入指南已保存: .granada/aosp-imports/<slug>.md
   [如有执行计划] 执行计划已保存: .granada/plans/aosp-import-<slug>.md
   ```

### Step 8: Execution Handoff (if `--execute` and user approves)

Use `AskUserQuestion` to present the execution plan with options:
- **执行** — Hand off to `/zaku:aosp-autopilot .granada/plans/aosp-import-<slug>.md`
- **修改后执行** — Return to Step 6 with user feedback
- **仅保留计划** — Stop here, user will execute manually later

On approval: `Write {"active": false} to .granada/aosp-feature-import-state.json` then invoke `Skill("zaku:aosp-autopilot")`.

## Output Template

```markdown
# Vendor功能导入指南: {feature_name}

## 概览
- **功能:** {description}
- **源 AOSP 项目:** {source_project}
- **目标 AOSP 项目:** {target_project}
- **导出报告:** {export_report_path}
- **导入日期:** {date}
- **组件总数:** {total_components}
- **映射状态:** MAPPED: {n}, DIVERGED: {n}, MISSING: {n}
- **调查轮次:** {rounds}
- **预估移植难度:** 低 / 中 / 高

## 映射总览

| 组件 | 源路径 | 目标路径 | 状态 | 适配说明 |
|------|--------|----------|------|----------|
| {name} | {source_path} | {target_path} | MAPPED | 路径一致，可直接应用 |
| {name} | {source_path} | {target_path} | MOVED | 目标中路径不同: {new_path} |
| {name} | {source_path} | {target_path} | DIVERGED | API差异: {summary} |
| {name} | {source_path} | — | MISSING | 目标中不存在，需{替代方案} |

## 适配分析

### API 差异

#### {组件名称}
- **源 API:** {source signature/interface}
- **目标 API:** {target signature/interface}
- **差异类型:** 方法签名变更 / 新增参数 / 接口重构 / API级别不同
- **适配方案:** {具体的代码适配说明}
- **代码示例:**
  ```java
  // 源 (source_project):
  {source code snippet}
  
  // 目标 (target_project) 需要适配为:
  {adapted code snippet or guidance}
  ```

### 缺失模块

#### {模块名称}
- **源中位置:** {source_path}
- **源中作用:** {role in vendor feature}
- **目标中状态:** 不存在 / 已被替代 / 已移除
- **替代方案:** {alternative approach in target}
- **移植影响:** {impact on vendor feature if this module is unavailable}

## 移植步骤

### 步骤 1: {action} [优先级: critical]
- **目标文件:** {target_path}
- **对应源文件:** {source_path}
- **修改内容:** {what vendor code to apply/adapt}
- **适配要点:** {specific adaptations needed for target}
- **验证方式:** {how to verify this step}

### 步骤 2: {action} [优先级: important]
- **目标文件:** {target_path}
- **对应源文件:** {source_path}
- **修改内容:** {description}
- **适配要点:** {adaptations}
- **验证方式:** {verification}

## 风险评估

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|----------|
| {risk description} | 高/中/低 | 高/中/低 | {mitigation} |

## 依赖顺序

```
{dependency graph in text form}
1. {first component to port} (无依赖)
2. {second component} (依赖: 1)
3. {third component} (依赖: 1, 2)
```

## 源项目验证日志

| 组件 | 导出报告路径 | 当前状态 | 备注 |
|------|-------------|----------|------|
| {name} | {path} | 存在/已变更/不存在 | {notes} |

## 目标项目调查日志

| 轮次 | 调查组件 | 状态 | 发现 |
|------|----------|------|------|
| 1 | {component} | MAPPED/DIVERGED/MISSING | {summary} |
| ... | ... | ... | ... |

## 元数据

- **导出报告版本:** {last_verified from export report}
- **源项目搜索次数:** {n}
- **目标项目搜索次数:** {n}
- **总 agent 派发数:** {n}
- **跳过源验证:** {是/否}
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| Export report file not found | `rm -f .granada/*-state.json` + abort with path suggestion |
| Export report unparseable (missing required sections) | `rm -f .granada/*-state.json` + abort listing missing sections |
| Source project unreachable via sourcepilot | Warn, continue with `--skip-source-verify` behavior |
| Target project unreachable via sourcepilot | `rm -f .granada/*-state.json` + abort (target is required) |
| Source == Target project | `rm -f .granada/*-state.json` + abort with explanation |
| No target project configured or specified | `rm -f .granada/*-state.json` + abort with setup instructions |
| >50% of Phase 1 agents fail | Emit partial results with warning, continue with available data |
| All target investigators return MISSING for all components | Complete with "high difficulty" assessment, recommend manual review |
| Partial agent failure in Phase 2 | Continue with successful results, note gaps |

## Error Recovery

On any unrecoverable error after Step 0:
- If investigator data has been collected, write partial results to `.granada/aosp-imports/<slug>-partial.md`
- Call `Bash: rm -f .granada/aosp-feature-import-state.json`
- Report the error to the user

Skill is idempotent — re-running with the same inputs overwrites the output file.

## Configuration

- Output directory: `.granada/aosp-imports/` (fixed)
- Execution plan directory: `.granada/plans/` (fixed, prefix `aosp-import-`)
- Max Phase 1 agent pairs: 6 (12 agents total: 6 source + 6 target)
- Max Phase 2 agents: 8 (target-only, gap investigation)
- Max total agents across all phases: 20 (investigation) + 2 per quality gate iteration (max 4 for architect+critic)
- Quality gate max iterations: 2 (architect + critic per iteration)
- Max Phase 2 rounds: 4
- Convergence threshold: no new findings for DIVERGED/MISSING components
- State mode: `aosp-feature-import`
- Component cap: 10 (merge related components if export has more)

## State Lifecycle

| Scenario | State Operation |
|----------|-----------------|
| On entry | `Write {"active": true} to .granada/aosp-feature-import-state.json` |
| Normal completion (no --execute) | `Bash: rm -f .granada/aosp-feature-import-state.json` |
| Execution handoff (--execute approved) | `Write {"active": false} to .granada/aosp-feature-import-state.json` |
| Export report not found (unrecoverable) | `Bash: rm -f .granada/aosp-feature-import-state.json` |
| MCP unreachable (unrecoverable) | `Bash: rm -f .granada/aosp-feature-import-state.json` |
| User cancels | `/zaku:cancel` calls `rm -f .granada/*-state.json` |

Note: Do not use `rm -f .granada/*-state.json` before launching `aosp-autopilot`. The 30-second cancel signal disables stop-hook enforcement for the newly launched mode. Use `Write JSON with active=false)` instead.

## Tool Usage

- `sourcepilot`: MCP discovery (`list_tools`) and AOSP code search (via `aosp-investigator` subagents with explicit `project` parameter override)
- `Agent(subagent_type="zaku:aosp-investigator")`: Parallel investigation of source and target projects
- `Agent(subagent_type="zaku:architect")`: Architect review in Step 6c quality gate
- `Agent(subagent_type="zaku:critic")`: Critic evaluation in Step 6c quality gate
- `Read`: Parse export report, read `.granada/aosp-config.json`
- `Write`: Save import guide and execution plan
- `Write` / `Bash rm`: Manage execution state via .granada/ files
- `AskUserQuestion`: Execution approval gate (Step 8), quality gate fallback (Step 6c)
- `Skill("zaku:aosp-autopilot")`: Execution handoff

## Keyword Triggers

- `"aosp import"`, `"aosp feature import"`, `"功能导入"`, `"feature import"`, `"移植功能"`

## Design Decision: Dual-Project Search Strategy

This skill uses **interleaved dual-project search** (source verification + target mapping in parallel per component). The rationale:

1. **Why verify source?** Export reports can become stale — AOSP code evolves, paths move, APIs change. Blind trust in the export leads to wrong target mappings.
2. **Why parallel?** Sequential source-then-target doubles wall-clock time. Since each component's source and target searches are independent, parallelism is safe and efficient.
3. **Why not target-only?** Without source verification, we cannot detect when the export report's paths are outdated, leading to false MISSING classifications in the target (the source path was wrong, not the target).
4. **Escape hatch:** `--skip-source-verify` provides the target-only mode for users who trust their export report (e.g., just generated it moments ago).
