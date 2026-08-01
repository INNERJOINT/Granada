---
name: jira-analyze
description: "Android JIRA root-cause analysis via log-first evidence deep dive, 5 Whys, ASCII causal timeline, and conditional lightweight AOSP source validation. Report in Chinese, posted as JIRA comment."
---
## Codex runtime contract

Before executing this workflow, read `../../references/codex-compat.md` completely.
The `delegate(...)` blocks below are declarative workflow notation; translate them to the native Codex collaboration tools described in that reference.
<Purpose>
Automates Android bug root-cause analysis for JIRA issues by fetching issue details via mcp-atlassian, delegating Android log collection to `aosp-log-collector`, parsing logcat/tombstone/ANR/kernel logs with `aosp-log-parser`, then using the parsed logs as the primary evidence source. The skill generates `why-seeds.md`, expands the strongest seed into one evidence-closed 5 Whys chain, renders a plain Markdown/ASCII causal timeline, conditionally validates exactly one mechanism hypothesis through lightweight sourcepilot searches when logs require source semantics, and produces a structured Chinese RCA report posted as a JIRA comment.
</Purpose>

<Steps>

## Phase 1: Initialize

1. **Parse `<skill-arguments>`** as exactly one JIRA URL:
   - Accept only one non-empty argument after trimming whitespace.
   - Reject any extra arguments or flags, direct issue keys, local paths, or free-form text.
   - URL pattern: extract key from `https://<domain>/browse/<KEY>` via regex.
   - Validate the extracted key with `^[A-Z][A-Z0-9_]+-\d+$`.
   - If parsing fails, abort with: "jira-analyze accepts exactly one JIRA URL, for example https://jira.example.com/browse/PROJ-123. Do not pass issue keys, flags, paths, or extra arguments."

2. **JIRA MCP health check**:
   - JIRA: call `mcp__atlassian__jira_get_issue(issue_key=<KEY>, fields="summary,status,assignee,priority,description")` — if it fails, abort with "mcp-atlassian unreachable. Check JIRA_URL and JIRA_PERSONAL_TOKEN env vars."
   - Do **not** call sourcepilot during initialization. Sourcepilot is conditional and is checked only if Phase 5 decides source validation is needed.
   - Do **not** read `.granada/aosp-config.json`; this skill derives the AOSP project from `ro.build.display.id` in collected logs.

3. **Create a unique, fail-closed current-run workspace** only after the issue key is validated and the JIRA health check succeeds:
```bash
issue_key="<KEY>"
temp_dir=$(mktemp -d "/tmp/jira-analyze-${issue_key}.XXXXXX") || exit 1
[[ -n "$temp_dir" && "$temp_dir" == "/tmp/jira-analyze-${issue_key}."* ]] || exit 1
[[ -d "$temp_dir" && ! -L "$temp_dir" ]] || exit 1

extracted_dir="${temp_dir}/extracted"
mkdir -p -- "$extracted_dir" || exit 1
[[ -d "$extracted_dir" && ! -L "$extracted_dir" ]] || exit 1
```

Retain the exact generated `temp_dir` value and substitute it wherever `<temp_dir>` appears in all later phases and subagent prompts. A unique directory prevents stale-artifact reuse and same-issue concurrent-run interference without deleting another run. Preserve this current-run workspace on failure for debugging.

## Phase 2: JIRA Data Collection (via aosp-log-collector Agent)

Delegate all JIRA issue metadata, attachment collection, archive unpacking, fallback log download, file organization, and file classification to `aosp-log-collector`.

1. **Spawn the aosp-log-collector agent**:

```
delegate(
  role="aosp-log-collector",
  reasoning="medium",
  message="Collect Android logs for JIRA issue <KEY>.

Mode: JIRA
Issue key: <KEY>
Temp directory: <temp_dir>/
Extracted directory: <temp_dir>/extracted/
Classification manifest: <temp_dir>/file-classification.json

Fetch issue details with comments excluded, collect log attachments or fallback logs, populate the extracted directory, and generate the classification manifest. Report issue summary, attachment metadata, per-type counts, the chronological Collection attempts ledger, the deduplicated Failure codes observed list, SN fallback outcome, and final Collection status."
)
```

2. **Enforce the parser handoff gate** before spawning any parser:
   - Require the collector's final status to be `SUCCESS` or `PARTIAL`. A `FAILED` result is terminal and must surface the collector's reason, Collection attempts, Failure codes observed, and retained current-run directory.
   - Without following symlinks, require `<temp_dir>` and `<temp_dir>/extracted/` to be real directories (not symlinks), and `<temp_dir>/file-classification.json` to be a real regular file (not a symlink).
   - Read and parse the manifest. It must be a non-empty flat JSON object whose keys and values are strings; arrays, scalars, and nested values are invalid.
   - Require every value to be one of `logcat`, `tombstone`, `anr`, `kernel`, or `other`, with at least one `logcat|tombstone|anr|kernel` entry.
   - Validate every key before reading it: reject empty keys, absolute paths, backslashes, NUL characters, and empty/`.`/`..` path segments. Resolve it beneath `extracted/` and require containment inside that directory.
   - Without following symlinks, require every manifest target to be a regular file. Enumerate every extracted regular file recursively and require exact manifest-to-disk and disk-to-manifest set equality.
   - On any failure, abort with `Log collection handoff invalid — <specific reason>`, preserve the current-run workspace, and do not spawn the parser, call Sourcepilot, generate Why seeds/RCA, or post a JIRA comment.

Execute this deterministic validator with the exact current-run `temp_dir`; do not replace it with an informal visual check:

```bash
TEMP_DIR="$temp_dir" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`Log collection handoff invalid — ${message}`);
  process.exit(1);
}

function safeLstat(target, label) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    fail(`${label} is missing: ${error.message}`);
  }
  if (stat.isSymbolicLink()) fail(`${label} must not be a symlink`);
  return stat;
}

const tempDir = process.env.TEMP_DIR;
if (!tempDir || !path.isAbsolute(tempDir)) fail('TEMP_DIR must be an absolute current-run path');
const tempStat = safeLstat(tempDir, 'current-run directory');
if (!tempStat.isDirectory()) fail('current-run path is not a directory');

const extractedDir = path.join(tempDir, 'extracted');
const extractedStat = safeLstat(extractedDir, 'extracted directory');
if (!extractedStat.isDirectory()) fail('extracted path is not a directory');

const manifestPath = path.join(tempDir, 'file-classification.json');
const manifestStat = safeLstat(manifestPath, 'classification manifest');
if (!manifestStat.isFile()) fail('classification manifest is not a regular file');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`classification manifest is invalid JSON: ${error.message}`);
}
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  fail('classification manifest must be a flat JSON object');
}

const entries = Object.entries(manifest);
if (entries.length === 0) fail('classification manifest is empty');
const allowed = new Set(['logcat', 'tombstone', 'anr', 'kernel', 'other']);
const manifestKeys = [];
let parseable = 0;

for (const [key, value] of entries) {
  if (typeof value !== 'string' || !allowed.has(value)) fail(`invalid classification type for ${key}`);
  if (value !== 'other') parseable += 1;
  if (!key || path.isAbsolute(key) || key.includes('\\') || key.includes(String.fromCharCode(0))) {
    fail(`unsafe classification manifest key: ${key}`);
  }

  const segments = key.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    fail(`unsafe classification manifest key: ${key}`);
  }

  let cursor = extractedDir;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    const stat = safeLstat(cursor, `manifest target ${key}`);
    if (index < segments.length - 1 && !stat.isDirectory()) fail(`manifest parent is not a directory: ${key}`);
    if (index === segments.length - 1 && !stat.isFile()) fail(`manifest target is not a regular file: ${key}`);
  }

  const resolved = path.resolve(extractedDir, ...segments);
  const relative = path.relative(path.resolve(extractedDir), resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`unsafe classification manifest key: ${key}`);
  }
  manifestKeys.push(segments.join('/'));
}

if (parseable === 0) fail('classification manifest contains no parseable Android logs');

const diskFiles = [];
function walk(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    const fullPath = path.join(directory, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const stat = safeLstat(fullPath, `extracted entry ${relativePath}`);
    if (stat.isDirectory()) walk(fullPath, relativePath);
    else if (stat.isFile()) diskFiles.push(relativePath);
    else fail(`unsupported extracted entry type: ${relativePath}`);
  }
}
walk(extractedDir);

manifestKeys.sort();
diskFiles.sort();
if (JSON.stringify(manifestKeys) !== JSON.stringify(diskFiles)) {
  fail('classification manifest and extracted regular-file sets differ');
}

console.log(JSON.stringify({ status: 'VALID', files: diskFiles.length, parseable }));
NODE
```

A `PARTIAL` collector result may continue only when this command exits zero. Artifact existence alone is never sufficient.

## Phase 3: Log Parsing and Timeline Construction (via aosp-log-parser Agent)

Delegate all log parsing to a single `aosp-log-parser` agent. This agent reads the collector-generated file classification, runs all 4 log type parsers, and performs the merge/synthesis step internally.

### Spawn aosp-log-parser Agent

```
delegate(
  role="aosp-log-parser",
  reasoning="medium",
  message="Parse Android log files for JIRA issue <KEY>.

Temp directory: <temp_dir>/
Source files directory: <temp_dir>/extracted/
Classification manifest: <temp_dir>/file-classification.json

Read the collector-generated classification manifest first, parse each listed log type using parallel tool calls where possible, then merge into unified timeline.md and anomalies.md. Abort if the manifest is missing or inconsistent with the extracted directory.

Report the total anomaly count at the end of your response."
)
```

### Verify Output

After the agent completes, check that `<temp_dir>/timeline.md` and `<temp_dir>/anomalies.md` exist. If not, abort with "Log parsing failed — timeline or anomalies output missing."

`timeline.md` and `anomalies.md` are now the first evidence gate for the RCA. Do not perform source search before reading and evaluating these two log-derived artifacts.

### Extract AOSP Project Keyword from Logs

Before Phase 4, inspect collected and parsed logs for `ro.build.display.id`:

1. Search `<temp_dir>/extracted/`, `<temp_dir>/timeline.md`, and `<temp_dir>/anomalies.md` for lines containing `ro.build.display.id`.
2. Extract the property value exactly as the **project keyword**. Examples:
   - `ro.build.display.id=...`
   - `[ro.build.display.id]: [...]`
   - `ro.build.display.id: ...`
3. If multiple values exist, choose the most frequent value; if tied, choose the value closest to the key anomaly timestamp and note the ambiguity.
4. Save the result to `<temp_dir>/project-keyword.md`:

```markdown
# Sourcepilot Project Keyword for <KEY>

- **Property:** ro.build.display.id
- **Keyword:** <extracted value or unknown>
- **Evidence:** <file:line or artifact reference>
- **Ambiguity:** <none or competing values>
```

If the property is absent, write `Keyword: unknown`. Do not ask the user for a project name and do not read `.granada/aosp-config.json`.

## Phase 4: Log Evidence Deep Dive and Why Seeds

Perform a log-first evidence deep dive from `<temp_dir>/timeline.md` and `<temp_dir>/anomalies.md`. At this point the skill must stay within parsed log evidence; sourcepilot is considered later only if Phase 5 identifies a concrete evidence gap or source-only mechanism question.

### Evidence Threshold

Evaluate whether the logs establish all of the following:

1. **Exception / anomaly chain** — a coherent sequence connecting user-visible symptom to fatal/error/anomaly events.
2. **Key timestamps** — timestamps for symptom onset, earliest relevant anomaly, decisive failure, and aftermath.
3. **Related process / module / component** — process names, Android subsystem names, native libraries, Java classes, kernel subsystem, or service names.
4. **Explainable trigger condition** — a log-backed condition that plausibly triggered the chain, such as lifecycle transition, binder transaction, watchdog timeout, resource pressure, state transition, driver error, or repeated retry/failure pattern.

If any field is missing or contradictory, record it as an evidence gap. Evidence gaps are the primary reason to trigger conditional sourcepilot validation in Phase 5.

### Generate why-seeds.md

Create `<temp_dir>/why-seeds.md` containing **1-3 Why seeds**. Each seed must be grounded in the parsed logs and include:

```markdown
# Why Seeds for <KEY>

## Evidence Threshold
| Field | Status | Evidence | Gap |
|-------|--------|----------|-----|
| Exception / anomaly chain | present/missing/contradictory | <timeline/anomaly references> | <gap or none> |
| Key timestamps | present/missing/contradictory | <references> | <gap or none> |
| Related process / module / component | present/missing/contradictory | <references> | <gap or none> |
| Explainable trigger condition | present/missing/contradictory | <references> | <gap or none> |

## Seed Ranking
1. <Seed title> — strength: high/medium/low — rationale: <why this is strongest>
2. ...

## Why Seed 1: <initial why question>
- **Bound log evidence:** <timeline/anomalies references>
- **Evidence strength:** high/medium/low
- **Ranking rationale:** <why this seed should or should not be the main chain>
- **Missing evidence:** <none or concrete gaps>
- **Initial mechanism hypothesis:** <optional claim that may need source validation>
```

Mark exactly one seed as **Strongest seed / selected main chain**. Later phases expand only this strongest seed.

### Compatibility Artifacts

Initialize `<temp_dir>/aosp-context.md` with a status section such as:

```markdown
# Conditional Sourcepilot Context for <KEY>

Status: not triggered yet — pending Phase 5 evidence-gap / mechanism-validation decision.
```

This preserves the existing artifact contract without forcing sourcepilot to run.

## Phase 5: Main 5 Whys Chain and Conditional Sourcepilot Validation

Read `<temp_dir>/why-seeds.md`, choose the strongest seed, and expand only that seed into a single evidence-closed 5 Whys chain.

### Main 5 Whys Chain

Save the chain to `<temp_dir>/hypotheses.md` using this structure:

```markdown
# Main 5 Whys Chain for <KEY>

## Selected Why Seed
- **Seed:** <seed title/question>
- **Reason selected:** <ranking rationale>
- **Bound evidence:** <references>

## Evidence Threshold Decision
- **Satisfied:** yes/no/partial
- **Missing or contradictory fields:** <list>
- **Sourcepilot trigger decision:** triggered/not triggered
- **Trigger reason:** <evidence gap or mechanism hypothesis, or "not needed">

## 5 Whys Main Chain

### Why 1: <question>
- **Answer / cause layer:** <answer>
- **Log evidence:** <timeline/anomaly references>
- **Refutation check:** <counter-evidence or why alternatives are weaker>
- **Next-layer cause:** <next why target or stop reason>
- **Needs source validation:** yes/no — <reason>

### Why 2: ...

<!-- Continue up to at most Why 5. Stop earlier if the root cause is evidence-closed. -->

## Root Cause Candidate
- **Conclusion:** <root cause candidate>
- **Explains user symptom:** yes/no — <evidence>
- **Explains key anomaly chain:** yes/no — <evidence>
- **Remaining uncertainty:** <none or concrete gaps>
```

Rules:
- Expand **one primary chain only**.
- Use at most 5 Why levels.
- Every level must include log evidence and a refutation/counter-evidence check.
- The final root cause candidate must explain both the user-visible problem and the key exception/anomaly chain.
- If evidence is insufficient, state that the chain is not fully closed and name the missing evidence rather than inventing certainty.

### Conditional Sourcepilot Decision

Trigger sourcepilot only when at least one of these is true:

1. The Phase 4 evidence threshold is missing or contradicts one or more required fields.
2. A specific Why step contains a mechanism hypothesis that cannot be validated from logs alone.

Do **not** trigger sourcepilot when the log evidence threshold is satisfied and the 5 Whys chain is already evidence-closed.

### Lightweight Sourcepilot Validation (only if triggered)

If triggered:

1. Read `<temp_dir>/project-keyword.md` and extract the `Keyword` value derived from `ro.build.display.id`.
   - If the keyword is `unknown`, record "mechanism validation unresolved — ro.build.display.id not found in logs" in `<temp_dir>/aosp-context.md` and continue to the report; do not ask the user for a project name.
2. Resolve the sourcepilot project by calling `mcp__sourcepilot__resolve_project_by_keyword({ keyword: "<ro.build.display.id value>" })`.
   - If it returns `project`, use that exact project for all sourcepilot calls and record `matched_keyword` in `aosp-context.md`.
   - If it returns `project: null`, record "mechanism validation unresolved — no sourcepilot project matched ro.build.display.id" and continue to the report; do not fall back to `.granada/aosp-config.json` or a user-provided project.
   - If the resolver call fails, record "mechanism validation unresolved — sourcepilot project resolver unreachable" and continue to the report; do not abort the whole RCA.
3. Define exactly one `MechanismHypothesis` from the selected Why chain.
4. Generate **1-2 precise source queries** only. The query goal is mechanism validation, not broad code audit.
5. Spawn at most one `aosp-investigator` agent:

```
delegate(
  role="aosp-investigator",
  reasoning="medium",
  message="**AOSP Project Resolved From Logs:** Use project `<resolved_project>` for ALL mcp__sourcepilot__* search calls. The project was resolved from `ro.build.display.id=<keyword>` via `mcp__sourcepilot__resolve_project_by_keyword`. Do NOT read `.granada/aosp-config.json` and do NOT ask the user for a project.

Validate this single mechanism hypothesis for JIRA issue <KEY>. This is a lightweight sourcepilot validation, not a broad code audit.

Mechanism hypothesis:
<one concrete claim from the selected 5 Whys chain>

Log evidence that motivated validation:
<timeline/anomalies/why-seeds references>

Search budget:
- Use only 1-2 precise mcp__sourcepilot__* queries.
- Prefer symbol/file/regex lookup that directly validates the mechanism.
- Do not perform broad subsystem review.
- It is acceptable to conclude that source validation is unresolved.

Report:
- Source paths and line numbers if found
- Whether the source validates, weakens, or leaves unresolved the mechanism hypothesis
- Evidence limits and remaining uncertainty"
)
```

5. Save the result to `<temp_dir>/aosp-context.md` and `<temp_dir>/investigation-1.md`.

If not triggered:

- Write `<temp_dir>/aosp-context.md` with `Status: sourcepilot not triggered — log evidence threshold satisfied and no source-only mechanism validation required.`
- Write `<temp_dir>/investigation-1.md` with `Status: no source investigation performed; RCA is based on log evidence and the 5 Whys chain.`

## Phase 6: Synthesis and Report

1. **Read all synthesis inputs**:
   - `<temp_dir>/timeline.md`
   - `<temp_dir>/anomalies.md`
   - `<temp_dir>/project-keyword.md`
   - `<temp_dir>/why-seeds.md`
   - `<temp_dir>/hypotheses.md`
   - `<temp_dir>/aosp-context.md`
   - `<temp_dir>/investigation-*.md`

2. **Redact secrets** from all included log excerpts, issue text, source snippets, and generated explanations: authorization headers, bearer tokens, API keys, passwords, access/refresh/id tokens, cookies, session IDs, private keys, and signed URL token/key/signature query values.

3. **Build the 7-section Chinese report** and save to `.granada/specs/jira-analyze-{issue_key}.md`.

```markdown
<!-- Downstream dependency: jira-aftersales skill detects reports by this title format. Do not change without updating jira-aftersales. -->
# Root Cause Analysis Report: {issue_key} — {issue_title}

**Generated at:** {date}
**Issue link:** {jira_url}
**Status:** {status} | **Assignee:** {assignee} | **Priority:** {priority}

## 1. 问题概述
{用中文总结 JIRA 描述、影响范围、用户可见症状、日志包概况。}

## 2. 日志证据时间线
| Time | Source | Severity | Event | Evidence |
|------|--------|----------|-------|----------|
| {timestamp} | {logcat/tombstone/ANR/kernel} | {INFO/WARN/ERROR/FATAL} | {description} | {file:line or artifact reference} |

## 3. 关键异常 / 错误与证据门槛
### 3.1 关键异常
- **异常链:** {异常/错误链摘要}
- **关键时间点:** {symptom / first anomaly / decisive failure / aftermath}
- **相关进程/模块:** {process/module/component}
- **触发条件:** {log-backed trigger condition}

### 3.2 证据门槛判定
| Field | Status | Evidence | Gap |
|-------|--------|----------|-----|
| 异常链 | present/missing/contradictory | {references} | {gap or none} |
| 关键时间点 | present/missing/contradictory | {references} | {gap or none} |
| 相关进程/模块 | present/missing/contradictory | {references} | {gap or none} |
| 可解释触发条件 | present/missing/contradictory | {references} | {gap or none} |

## 4. Why Seeds 与主 5 Whys 链
### 4.1 Why Seeds
{列出 1-3 条 why-seeds.md 中的种子、证据强度、排序依据，并标记最强 seed。}

### 4.2 主 5 Whys 链
| Level | Why | Answer / Cause Layer | Log Evidence | Refutation Check |
|-------|-----|----------------------|--------------|------------------|
| 1 | {why question} | {answer} | {references} | {counter-evidence / alternatives} |
| ... | ... | ... | ... | ... |

### 4.3 根因候选
{说明主链是否闭环、根因如何解释用户问题与关键异常链、剩余不确定性。}

## 5. 条件式 Sourcepilot 机制验证
**Trigger decision:** {triggered / not triggered}
**Trigger reason:** {evidence gap / mechanism hypothesis / log evidence sufficient}

{If not triggered: 说明日志证据已满足门槛，且主 5 Whys 链不需要 source-only 机制验证。}

{If triggered: 说明 `ro.build.display.id` 提取结果、`resolve_project_by_keyword` 匹配到的 sourcepilot project / matched_keyword、机制假设、1-2 个精准查询、sourcepilot 结果如何验证/削弱/未能确认该机制。}

## 6. ASCII 因果时间线
```text
{plain Markdown/ASCII causal timeline, for example:}
[用户可见症状]
      |
      v
[最早异常 @ timestamp] -> [关键模块/进程状态] -> [决定性失败]
      |                         |                    |
      | evidence: file:line      | evidence: ...      | evidence: ...
      v                         v                    v
[Why seed] --------------> [主 5 Whys 根因候选] -> [影响结果]
```

## 7. 根因结论与修复建议
### 7.1 Root Cause
{中文根因结论；若证据不足，明确写“当前证据不足以确定唯一根因”。}

### 7.2 Recommended Fix Plan
1. {action with specific file/component reference if available}
2. {action}

### 7.3 Validation / Follow-up
- {recommended validation or additional logs if uncertainty remains}
```

4. **Post report as JIRA comment**: `mcp__atlassian__jira_add_comment(issue_key=<KEY>, body=<redacted_report_content>)` — post the redacted report content as a comment on the JIRA issue. If this fails, warn but do not abort (the local report file is still available).

5. Announce report location to the user.

</Steps>

<Error_Handling>
Embed these handlers throughout all phases:

- **JIRA MCP unreachable** → abort with "mcp-atlassian unreachable. Check JIRA_URL and JIRA_PERSONAL_TOKEN env vars."
- **`ro.build.display.id` missing when source validation is triggered** → record "mechanism validation unresolved — ro.build.display.id not found in logs" in `aosp-context.md` and the final report; do not ask the user for a project name
- **Sourcepilot project resolver returns no match** → record "mechanism validation unresolved — no sourcepilot project matched ro.build.display.id" in `aosp-context.md` and the final report; do not fall back to `.granada/aosp-config.json`
- **Sourcepilot unreachable when source validation is triggered** → record "mechanism validation unresolved — sourcepilot unreachable" in `aosp-context.md` and the final report; do not abort the entire RCA
- **Collector reports FAILED** → hard-stop Phase 2 with the collector's failure reason, attempt ledger, failure codes, and retained current-run workspace
- **Collector reports PARTIAL** → continue only after the complete parser handoff gate passes; artifact existence alone is insufficient
- **Invalid, empty, all-`other`, unsafe, or inconsistent classification manifest** → abort in Phase 2 with `Log collection handoff invalid — <specific reason>`
- **No parseable logs found** → abort with "No Android log files found in collected artifacts"
- **Collector or parser agent timeout/failure** → hard-stop before the next phase; never reuse existing artifacts from an earlier run
- **Log evidence threshold incomplete after successful parsing** → continue into 5 Whys, mark gaps in `why-seeds.md`, and consider conditional sourcepilot validation if the gap is mechanism-related
- **Sourcepilot returns no results** → record "mechanism validation unresolved" as a gap; do not fail
- **Later analysis agent timeout/failure** → mark the affected artifact as incomplete and continue only if current-run parsed log evidence remains sufficient for a cautious RCA
- **5 Whys chain cannot close** → report with "insufficient evidence" conclusion and name the missing evidence
- **JIRA comment post fails** → warn user, do not abort (local report file is still available)
</Error_Handling>

<Tool_Usage>
- `mcp__atlassian__jira_get_issue` — Phase 1 JIRA health check and issue metadata collection (mcp-atlassian)
- `delegate(role="aosp-log-collector", reasoning="medium")` — JIRA issue metadata, log attachment collection, archive handling, extracted directory preparation, and classification manifest generation (Phase 2)
- `delegate(role="aosp-log-parser", reasoning="medium")` — log parsing and timeline construction from the collector-generated classification manifest (Phase 3)
- Main skill orchestration — validated workspace reset, Phase 2 manifest handoff verification, Phase 4 log evidence threshold evaluation, `why-seeds.md` generation, Phase 5 main 5 Whys chain, and Phase 6 report synthesis
- `mcp__sourcepilot__resolve_project_by_keyword` — conditional Phase 5 project resolver. Input is the `ro.build.display.id` value extracted from logs; output `project` is used for sourcepilot searches when present.
- `delegate(role="aosp-investigator", reasoning="medium")` — conditional Phase 5 lightweight sourcepilot validation only after `ro.build.display.id` resolves to a sourcepilot project and evidence gaps or one mechanism hypothesis require validation
- `mcp__sourcepilot__*` — used only by `aosp-investigator` during conditional lightweight source validation with the resolver-returned project; search budget is one mechanism hypothesis and 1-2 precise queries, not broad audit
- `mcp__atlassian__jira_add_comment` — post RCA report as comment on JIRA issue (mcp-atlassian)
</Tool_Usage>

<Examples>
<Good>
```
User: /jira-analyze https://jira.example.com/browse/SPFB-535

[Phase 1] Parsed key: SPFB-535. JIRA MCP health check passed.
[Phase 2] Spawned aosp-log-collector agent.
         Collection complete → 12 files classified: 3 logcat, 2 tombstone, 1 ANR, 1 kernel, 5 other.
[Phase 3] Spawned aosp-log-parser agent.
         Completed → timeline.md and anomalies.md generated.
         Extracted ro.build.display.id into project-keyword.md.
[Phase 4] Log evidence deep dive:
         Evidence threshold: anomaly chain present, key timestamps present,
         related module present, trigger condition partial.
         Saved why-seeds.md with 3 seeds; selected strongest seed:
         "Why did SurfaceFlinger hit SIGSEGV after display hotplug?"
[Phase 5] Expanded one main 5 Whys chain, max 5 levels.
         Why 3 requires source semantics for hotplug state handling.
         Resolved sourcepilot project from ro.build.display.id via resolve_project_by_keyword.
         Triggered lightweight sourcepilot validation with 1 mechanism hypothesis and 2 precise queries.
         Saved aosp-context.md and investigation-1.md.
[Phase 6] Generated Chinese RCA with ASCII causal timeline.
         Report saved to .granada/specs/jira-analyze-SPFB-535.md.
         Posted report as JIRA comment on SPFB-535.
```
Why good: Logs are the first evidence source. Sourcepilot is conditional, narrow, and tied to a single mechanism hypothesis. The report includes Why seeds, one main 5 Whys chain, and an ASCII causal timeline.
</Good>

<Good>
```
[Phase 5] Sourcepilot not triggered: log evidence threshold satisfied and the main 5 Whys chain is evidence-closed.
[Phase 6] Section 5 explains why no source validation was needed.
```
Why good: Sourcepilot is not mandatory. The report explicitly states why logs were sufficient.
</Good>

<Bad>
```
User: /jira-analyze SPFB-535 --some-flag value
```
Why bad: `jira-analyze` accepts exactly one JIRA URL. It must derive the sourcepilot project from `ro.build.display.id` in logs, not from direct issue keys, flags, or extra arguments.
</Bad>

<Bad>
```
[Phase 4] Spawned three aosp-investigator agents for broad AOSP search before reading why-seeds.md.
```
Why bad: Source search is conditional and should not run before log evidence deep dive and 5 Whys mechanism decision.
</Bad>

<Bad>
```
[Phase 5] Expanded all three Why seeds into separate 5 Whys chains.
```
Why bad: The agreed iteration boundary is one primary chain only: expand the strongest seed, at most 5 levels.
</Bad>

<Bad>
```
[Phase 6] Changed the report title to "# Jira RCA".
```
Why bad: `jira-aftersales` detects reports by the exact `# Root Cause Analysis Report:` title format.
</Bad>
</Examples>

<Guardrails>
**Must have:**
- Exactly one JIRA URL as input; reject direct issue keys, flags, paths, and extra arguments
- Unique current-run workspace creation only after the JIRA key and health check are validated
- A complete current-run classification manifest handoff gate before parser delegation
- `ro.build.display.id` extraction from collected logs into `<temp_dir>/project-keyword.md`
- `mcp__sourcepilot__resolve_project_by_keyword` for turning the extracted build display ID into the sourcepilot project when source validation is triggered
- `aosp-log-collector` subagent for JIRA issue metadata, log collection, archive handling, extracted directory preparation, and classification manifest generation
- `aosp-log-parser` subagent for parsing the collector-generated classification manifest, timeline merge, and anomaly merge
- `why-seeds.md` with 1-3 log-backed Why seeds and exactly one strongest selected seed
- One main 5 Whys chain only, at most 5 levels, with log evidence and refutation check at each level
- Conditional sourcepilot validation only when log evidence has a concrete gap or one Why step needs source semantics
- Sourcepilot search budget: one mechanism hypothesis, 1-2 precise queries, no broad code audit
- Plain Markdown/ASCII causal timeline in the Chinese RCA report
- All 7 report sections in Chinese
- Report title format `# Root Cause Analysis Report:` preserved exactly
- Report posted as JIRA comment via `mcp__atlassian__jira_add_comment`
- Lead only orchestrates: MCP calls, subagent spawning, artifact verification, and report assembly

**Must NOT have:**
- Deletion or reuse of any pre-existing JIRA analysis workspace; use only the exact unique `temp_dir` returned by `mktemp` for this run
- Reuse of stale extracted logs, manifests, timelines, anomalies, or reports from an earlier run
- Parser, Sourcepilot, 5 Whys, RCA, or JIRA comment execution before the Phase 2 handoff gate passes
- Interactive/conversational mode (produces static report)
- iOS or non-Android log parsing
- Binary attachment processing (images, videos)
- Inline download, decompression, base64, or attachment-intermediate cleanup details in this skill; those belong in `aosp-log-collector`. Fresh current-run workspace lifecycle remains lead-owned.
- Direct issue-key input, flags, paths, or any extra arguments
- Reading `.granada/aosp-config.json` or asking the user for an AOSP project in this skill
- Falling back to an unverified project when `resolve_project_by_keyword` returns `project: null`
- Mandatory or broad sourcepilot/AOSP search
- Requirement that sourcepilot locate a specific bug line; mechanism validation is sufficient
</Guardrails>
