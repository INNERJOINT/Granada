---
name: aosp-rca
description: "Android crash/issue root-cause analysis via AOSP source search, with optional local log files for evidence-driven analysis. Outputs structured Chinese RCA reports. For crash, restart, ANR, tombstone, or log-based debugging — use this skill."
---
## Codex runtime contract

Before executing this workflow, read `../../references/codex-compat.md` completely.
The `delegate(...)` blocks below are declarative workflow notation; translate them to the native Codex collaboration tools described in that reference.
<Purpose>
Automates Android system issue root-cause analysis. Supports two modes:
- **Log-based mode** (full): Accepts a directory of extracted Android system logs (logcat, tombstone, ANR traces, kernel logs). Parses logs into a chronological timeline, searches AOSP source code for crash-related context, generates and investigates hypotheses in parallel, and produces a structured 7-section Chinese RCA report.
- **No-log mode** (logless): Accepts a text description of the problem (via `--title`). Extracts search targets from the description, searches AOSP source code directly, generates hypotheses based on source analysis, and produces the same 7-section report structure (with sections 2/3 noting the absence of log evidence).

Both modes save the report to `.granada/specs/`.
</Purpose>

<Use_When>
- User has Android crash logs (logcat, tombstone, ANR, kernel) in a local directory and wants root-cause analysis
- User describes an Android system problem and wants AOSP source-level analysis without logs
- User says "aosp rca", "aosp-rca", "aosp_rca", "analyze logs", or "crash analyze"
- User provides a directory path containing extracted Android log files
- User wants to correlate Android system logs with AOSP source code
</Use_When>

<Do_Not_Use_When>
- Logs are from iOS or non-Android platforms
- User wants to fetch logs from JIRA — use jira-analyze instead
- User wants interactive conversational analysis — this produces a static report
- User wants a code modification plan or implementation steps — use aosp-plan instead (aosp-plan outputs action plans; aosp-rca outputs RCA reports)
</Do_Not_Use_When>

<Steps>

## Phase 1: Initialize

1. **Parse `<skill-arguments>`** to extract the input path and optional flags:

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

1b. **Generate and validate a slug** from the input for naming temp files and reports:
   - Log-based mode: start from the directory basename.
   - No-log mode: start from the first 40 characters of `--title`.
   - Convert all characters outside `[A-Za-z0-9._-]` to `-`.
   - Trim leading `.` or `-`.
   - Truncate to 40 characters.
   - Reject empty slugs.
   - Reject slugs containing `..` or path separators.
   - Require `^[A-Za-z0-9._-]{1,40}$`.
   - Derive `target="/tmp/aosp-rca-${slug}"` and require the resolved target to start with `/tmp/aosp-rca-`.

1c. **Fresh start cleanup** (after slug and target validation):
   - If `--fresh` flag is present: remove the validated temp directory with `rm -rf -- "$target"`, then proceed.

2. **MCP health check**:
   - AOSP: call `mcp__sourcepilot__list_projects()` — if fails, abort with "AOSP MCP (sourcepilot) unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."

4. **Display active AOSP project**:
   - If `--project` override was provided: display `**AOSP Project: <name> (specified on the command line)**` and use this value for all subsequent phases. Skip reading `.granada/aosp-config.json`.
   - Otherwise, read `.granada/aosp-config.json`:
     - If configured: display `**AOSP Project: <project_name>**` prominently
     - If not configured: display `**AOSP project is not configured** — Searches will not be limited to a project. Run $zaku:aosp-project to configure a project.`

5. **Create temp directory**:
```bash
target="/tmp/aosp-rca-${slug}"
mkdir -p -- "$target/extracted"
```

## Phase 2: Log Collection (via aosp-log-collector Agent)

> **Mode gate:** If `analysis_mode == "no-log"`, skip Phase 2 and Phase 3 entirely. Proceed directly to Phase 4.

Delegate all local log directory copying/linking, file organization, and file classification to `aosp-log-collector`.

1. **Spawn the aosp-log-collector agent**:

```
delegate(
  role="aosp-log-collector",
  reasoning="medium",
  message="Collect Android logs for analysis <slug>.

Mode: Local directory
Input path: <input_path>
Temp directory: /tmp/aosp-rca-<slug>/
Extracted directory: /tmp/aosp-rca-<slug>/extracted/
Classification manifest: /tmp/aosp-rca-<slug>/file-classification.json

Populate the extracted directory from the input path and generate the classification manifest. Report collection summary, per-type counts, and Collection status."
)
```

2. **Verify collection output**: After the agent completes, check that `/tmp/aosp-rca-<slug>/extracted/` contains files and `/tmp/aosp-rca-<slug>/file-classification.json` exists. If the collector reports FAILED or either artifact is missing, abort with "Log collection failed — extracted logs or classification manifest missing."


<!-- SYNC: skills/_shared/rca-pipeline.md#phase-3 -->
## Phase 3: Log Parsing and Timeline Construction (via aosp-log-parser Agent)

Delegate all log parsing to a single `aosp-log-parser` agent. This agent reads the collector-generated file classification, runs all 4 log type parsers, and performs the merge/synthesis step internally.

1. **Spawn the aosp-log-parser agent**:

```
delegate(
  role="aosp-log-parser",
  reasoning="medium",
  message="Parse Android log files for analysis <slug>.

Temp directory: /tmp/aosp-rca-<slug>/
Source files directory: /tmp/aosp-rca-<slug>/extracted/
Classification manifest: /tmp/aosp-rca-<slug>/file-classification.json

Read the collector-generated classification manifest first, parse each listed log type, then merge into unified timeline.md and anomalies.md. Abort if the manifest is missing or inconsistent with the extracted directory.

Report the total anomaly count at the end of your response."
)
```

2. **Verify output**: After the agent completes, check that `/tmp/aosp-rca-<slug>/timeline.md` and `/tmp/aosp-rca-<slug>/anomalies.md` exist. If not, abort with "Log parsing failed — timeline or anomalies output missing."


<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-4 -->
## Phase 4: AOSP Source Context Analysis

Before hypothesis investigation, perform a dedicated AOSP source search based on crash signatures extracted from anomalies (log-based mode) or from the problem description (no-log mode). This phase is **mandatory**.

### Extract Search Targets

Spawn an `aosp-analyst` subagent to extract structured search targets from parsed logs (log-based mode) or from the problem description (no-log mode):

```
delegate(
  role="aosp-analyst",
  reasoning="xhigh",
  message="Extract structured AOSP source search targets for RCA analysis <slug>.

Analysis mode: <analysis_mode>
Issue description: <issue_title or 'none'>

If analysis_mode == log-based:
- Read /tmp/aosp-rca-<slug>/anomalies.md
- Read /tmp/aosp-rca-<slug>/timeline.md
- Extract Java/native class names, function names, native libraries, kernel subsystem identifiers, signals, and specific error patterns.

If analysis_mode == no-log:
- Use the issue description to infer Android components/services, native libraries, subsystems, and technical keywords.

Group targets into 2-3 subsystem clusters.

Save valid JSON to /tmp/aosp-rca-<slug>/search-targets.json:
{
  \"clusters\": [
    {
      \"subsystem\": \"<name>\",
      \"components\": [...],
      \"libraries\": [...],
      \"functions\": [...],
      \"keywords\": [...],
      \"error_patterns\": [...]
    }
  ],
  \"gaps\": [...]
}"
)
```

Verify `/tmp/aosp-rca-<slug>/search-targets.json` exists. Read it and use its clusters as search targets for the AOSP investigator agents below.

### Parallel AOSP Search (via Subagents)

Group search targets into 2-3 clusters by subsystem, then spawn one aosp-investigator per cluster **in parallel**:

```
delegate(
  role="aosp-investigator",
  reasoning="medium",
  message="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL mcp__sourcepilot__* search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Search AOSP source code for this RCA target cluster from analysis <slug>.

Search target cluster from search-targets.json:
<cluster with subsystem, components, libraries, functions, keywords, and error_patterns>

For each target:
1. Use the mcp__sourcepilot__* tools (see Tool_Selection_Matrix in the investigator agent)
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

- Merge all AOSP investigator results into `/tmp/aosp-rca-<slug>/aosp-context.md`
- This file feeds into both hypothesis investigation (Phase 5) and the final report (Section 4)
- If AOSP search returns no results for a target, note it as a gap — do not silently omit


<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-5 -->
## Phase 5: Hypothesis Generation and Parallel Investigation

### Hypothesis Generation (via Subagent)

Spawn an analyst subagent to generate hypotheses:

**Log-based mode:**

```
delegate(
  role="aosp-analyst",
  reasoning="xhigh",
  message="Analyze Android crash anomalies for analysis <slug> and generate root-cause hypotheses.

Read the anomalies file: /tmp/aosp-rca-<slug>/anomalies.md
Read the timeline file: /tmp/aosp-rca-<slug>/timeline.md
Read the AOSP context file: /tmp/aosp-rca-<slug>/aosp-context.md (use AOSP findings to inform and strengthen hypotheses)

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

Save output to /tmp/aosp-rca-<slug>/hypotheses.md in this format:

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
delegate(
  role="aosp-analyst",
  reasoning="xhigh",
  message="Generate possible root-cause hypotheses based on AOSP source analysis results and the problem description.

Problem description: <issue_title>
Read the AOSP context file: /tmp/aosp-rca-<slug>/aosp-context.md

Note: This analysis has no log input; hypotheses are inferred from source structure rather than log evidence. Every hypothesis confidence is capped at medium.

Generate 2-3 root-cause hypotheses. Each hypothesis must have:
- Title (one-line description)
- Reasoning (which code paths or error-handling gaps found in AOSP source support the inference)
- Relevant AOSP source context (which AOSP code paths are involved)
- **Covered by Phase 4 context:** list aosp-context.md sections already searched for this hypothesis
- **New investigation targets:** code paths NOT in aosp-context.md that need further searching
- Confidence: low/medium (no-log mode must not assign high confidence)

Save output to /tmp/aosp-rca-<slug>/hypotheses.md in this format:

## Hypothesis 1: <title>
**Reasoning:** <source-based inference logic>
**AOSP source context:** <related code paths>
**Confidence:** medium/low

## Hypothesis 2: ...
(repeat for each hypothesis)"
)
```

Read the generated hypotheses from `/tmp/aosp-rca-<slug>/hypotheses.md`.

### Parallel Investigation via Agent Tool

Spawn one agent per hypothesis (max 3). Each agent receives Phase 4 context to avoid redundant searches:

```
delegate(
  role="aosp-investigator",
  reasoning="medium",
  message="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL mcp__sourcepilot__* search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Investigate this Android crash hypothesis for analysis <slug>:

Hypothesis: <hypothesis_title>

## Pre-existing AOSP Context (from Phase 4 — DO NOT re-search these)

The following AOSP source findings are already available. Use them directly as evidence.
Only perform NEW mcp__sourcepilot__* searches for code paths NOT covered below.

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
- Save to `/tmp/aosp-rca-<slug>/investigation-<N>.md`
- If an agent fails or times out, mark that hypothesis as "investigation incomplete" — do not fail the entire skill

<!-- /SYNC -->

<!-- SYNC: skills/_shared/rca-pipeline.md#phase-6 -->
## Phase 6: Synthesis and Report

1. **Read investigation results** from `/tmp/aosp-rca-<slug>/investigation-*.md` and `/tmp/aosp-rca-<slug>/aosp-context.md`

2. **Rank hypotheses** by confidence (from investigation results)

3. **Determine the report title**:
   - If `--title` was provided: use it as the issue description
   - Otherwise, derive from the most severe anomaly (e.g., "SIGSEGV in SurfaceFlinger")
   - Format: `{slug} — {derived_or_provided_description}`

4. **Build the 7-section Chinese report** and save to `.granada/specs/aosp-rca-{slug}.md` after redacting common secrets from all included log excerpts and issue text (authorization headers, bearer tokens, API keys, passwords, access/refresh/id tokens, cookies, session IDs, private keys, and signed URL token/key/signature query values):

```markdown
# Root Cause Analysis Report: {slug} — {issue_title}

**Generated at:** {date}
**Analysis mode:** {log-based: "log-based analysis" | no-log: "no-log source analysis based on problem description"}
**Input directory:** {input_path or "none (no-log mode)"}
**Analysis project:** {project_name or "unrestricted"}

## 1. Problem Overview
{issue_description_summary — derived from anomalies or --title}

## 2. Event Timeline
{log-based mode:}
| Time | Source | Severity | Event |
|------|------|----------|------|
| {timestamp} | {logcat/tombstone/ANR/kernel} | {INFO/WARN/ERROR/FATAL} | {description} |

{no-log mode:}
> No log files were provided, so there is no event timeline. The following analysis is inferred from the problem description and AOSP source structure.

## 3. Key Exceptions / Errors
{log-based mode:}
### Exception 1: {title}
- **Severity:** {FATAL/ERROR/WARN}
- **Source:** {file}:{line}
- **Stack trace:**
  {stack_trace}

{no-log mode:}
> No log files were provided, so no exceptions were extracted. The following root-cause hypotheses are inferred from AOSP source analysis rather than log evidence.

## 4. AOSP Source Analysis
{Complete source analysis collected during Phase 4 AOSP source context analysis}

### 4.1 Key Code Paths
{For each crash-related class/function, list the AOSP source path, code snippet, and functional description}

#### {class_or_function_name} — {aosp_file_path}
- **Source location:** `{aosp/path/to/file.java}:{line_range}`
- **Code snippet:**
  ```java
  // Relevant code excerpt with line numbers
  ```
- **Functional description:** {what this function/class does}
- **Relation to the crash:** {how this code relates to the crash behavior observed in logs}
- **Error handling analysis:** {how this code handles the failure mode and whether there are handling gaps}

### 4.2 Known Issues and Patterns
{Related TODOs, FIXMEs, known limitations, and similar crash patterns found in AOSP source}

### 4.3 Source Search Gaps
{Targets that returned no search results and may require further manual investigation}

## 5. Root-Cause Hypothesis Ranking
| Rank | Hypothesis | Confidence | Key evidence |
|------|------|--------|----------|
| 1 | {title} | {high/medium/low} | {evidence_summary} |

### Hypothesis 1: {title} (Confidence: {level})

> **No-log mode constraint:** When `analysis_mode == "no-log"`, every hypothesis must have a maximum confidence of medium and must not be marked high. The report should state that the analysis is based on source inference and has not been verified by log evidence.

**Supporting evidence:**
- {point}
**Contradicting evidence:**
- {point}
**AOSP context:** {relevant_source_findings}

## 6. Affected Component Diagram
{ASCII diagram showing affected Android subsystems and their relationships}

## 7. Recommended Fix Plan
1. {action with specific file/component reference}
2. {action}
```

<!-- /SYNC -->

5. Announce report location to the user.

</Steps>

<Error_Handling>
Embed these handlers throughout all phases:

- **AOSP MCP unreachable** → abort with "AOSP MCP (sourcepilot) unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."
- **Input path does not exist** → abort with "Path not found: <path>"
- **Input path is not a directory** → abort with "Path is not a directory: <path>. Provide a directory containing extracted Android logs."
- **No Android log files found** → abort with "No Android log files found in the directory. Supported types: logcat, tombstone, ANR traces, kernel logs."
- **Log parsing failed** → abort with "Log parsing failed — timeline or anomalies output missing. Check aosp-log-parser agent output."
- **AOSP search returns no results** → note "no AOSP source found" in report, do not fail
- **Agent timeout/failure** → mark hypothesis as "investigation incomplete", continue with others
- **All hypotheses fail investigation** → report with "insufficient evidence" conclusion
</Error_Handling>


<Tool_Usage>
- `mcp__sourcepilot__*` — search AOSP source for crash-related code (always, not conditional)
- `delegate(role="aosp-log-collector", reasoning="medium")` — local log directory preparation and classification manifest generation (Phase 2)
- `delegate(role="aosp-log-parser", reasoning="medium")` — log parsing and timeline construction from the collector-generated classification manifest (Phase 3)
- `delegate(role="aosp-analyst", reasoning="xhigh")` — hypothesis generation (Phase 5)
- `delegate(role="aosp-investigator", reasoning="medium")` — AOSP context search (Phase 4) + parallel hypothesis investigation (Phase 5)
- `Write` — save final report
</Tool_Usage>

<Examples>
<Good>
```
User: /aosp-rca --dir /tmp/crash-logs --title "SystemUI crash after OTA"

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
[Phase 6] Report saved to .granada/specs/aosp-rca-crash-logs.md (Chinese, 7 sections).
```
Why good: All exploration delegated to subagents. Clear input (--dir). AOSP project configured. Full pipeline executed with aosp-log-parser agent handling parallel parsing.
</Good>

<Good>
```
User: /aosp-rca --title "SurfaceFlinger crashes during screen rotation"

[Phase 1] No-log mode. Slug: surfaceflinger-rotate-crash. MCP health check passed.
          AOSP Project: android-14 (from .granada/aosp-config.json)
[Phase 2] Skipped (no-log mode)
[Phase 3] Skipped (no-log mode)
[Phase 4] Spawned analyst → extracted search targets from problem description: SurfaceFlinger, display rotation, WindowManagerService
          Spawned 2 aosp-investigator agents in parallel.
          Cluster 1 (SurfaceFlinger): Found SurfaceFlinger::setTransactionState rotation handling.
          Cluster 2 (WindowManager): Found DisplayRotation::rotateDisplay lock ordering.
          Saved aosp-context.md with 4 AOSP source findings.
[Phase 5] Spawned analyst subagent → generated 2 hypotheses (confidence capped at medium):
          H1: SurfaceFlinger rotation transaction race condition (medium)
          H2: DisplayRotation lock inversion during config change (medium)
          Spawned 2 aosp-investigator agents in parallel.
[Phase 6] Report saved to .granada/specs/aosp-rca-surfaceflinger-rotate-crash.md (Chinese, 7 sections).
```
Why good: No-log mode correctly skips Phase 2/3. Search targets extracted from --title by analyst. Confidence capped at "medium". Full 7-section report generated with sections 2/3 noting absence of log evidence.
</Good>

<Good>
```
User: /aosp-rca /home/user/bugreport-logs

[Phase 1] Input: directory /home/user/bugreport-logs. Slug: bugreport-logs. AOSP MCP health check pass.
          No AOSP project configured — searching all projects.
[Phase 2] aosp-log-collector classified 15 files → 4 logcat, 3 tombstone, 2 ANR, 1 kernel, 5 other.
[... rest of pipeline ...]
```
Why good: Positional path shorthand works. No project configured — searches all projects with clear warning.
</Good>

<Bad>
```
User: /aosp-rca --sn ABC123456
[Phase 1] No valid log directory found.
```
Why bad: Does not support --sn. User should extract logs first or use the directory path directly.
</Bad>

<Good>
```
User: /aosp-rca /path/to/nonexistent
[Phase 1] Path not found: /path/to/nonexistent. Abort.
```
Why good: Correctly aborts early when path doesn't exist.
</Good>
</Examples>

<Guardrails>
**Must have:**
- mcp__sourcepilot__* for AOSP source (always, not conditional) — **Phase 4 AOSP source analysis is mandatory**,skip only if absolutely certain the issue is completely unrelated to AOSP source
- aosp-investigator subagent for both Phase 4 (AOSP context) and Phase 5 (hypothesis investigation)
- All 7 report sections (in Chinese)
- Report saved to `.granada/specs/aosp-rca-{slug}.md`
- All exploration/analysis delegated to subagents (file classification, log parsing, timeline merge, hypothesis generation, AOSP investigation)
- Lead only orchestrates: MCP calls, subagent spawning, report assembly

**Must NOT have:**
- JIRA MCP dependency (no mcp__atlassian__jira_get_issue, mcp__atlassian__jira_download_attachments, mcp__atlassian__jira_add_comment)
- zip/sn input modes (only --dir / directory path, not --zip or --sn)
- log-unboxer dependency
- Interactive/conversational mode (produces static report)
- iOS or non-Android log parsing
- Binary attachment processing (images, videos)
- Guessing of issue context — derive strictly from logs and --title
</Guardrails>
