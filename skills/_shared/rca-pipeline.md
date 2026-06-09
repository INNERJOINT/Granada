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
  model="sonnet",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL mcp__plugin_zaku_sourcepilot__* search calls. Do NOT read `.granada/aosp-config.json`.]

Search AOSP source code for this RCA target cluster from search-targets.json:
<cluster with subsystem, components, libraries, functions, keywords, and error_patterns>

For each target:
1. Use the mcp__plugin_zaku_sourcepilot__* tools (see Tool_Selection_Matrix in the investigator agent)
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
  prompt="Generate possible root-cause hypotheses based on AOSP source analysis results and the problem description.

Problem description: <issue_title>
Read the AOSP context file: <TEMP_DIR>aosp-context.md

Note: This analysis has no log input; hypotheses are inferred from source structure rather than log evidence. Every hypothesis confidence is capped at medium.

Generate 2-3 root-cause hypotheses. Each hypothesis must have:
- Title (one-line description)
- Reasoning (which code paths or error-handling gaps found in AOSP source support the inference)
- Relevant AOSP source context (which AOSP code paths are involved)
- **Covered by Phase 4 context:** <list of already-searched targets>
- **New investigation targets:** <list of targets NOT in aosp-context.md>
- Confidence: low/medium (no-log mode must not assign high confidence)

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
  model="sonnet",
  prompt="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL mcp__plugin_zaku_sourcepilot__* search calls.]

Investigate this Android crash hypothesis for <MODE_NAME> analysis <ANALYSIS_ID>:

Hypothesis: <hypothesis_title>

## Pre-existing AOSP Context (from Phase 4 — DO NOT re-search these)

The following AOSP source findings are already available. Use them directly as evidence.
Only perform NEW mcp__plugin_zaku_sourcepilot__* searches for code paths NOT covered below.

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

---

## Phase 6: Synthesis and Report

1. **Read investigation results** from `<TEMP_DIR>investigation-*.md` and `<TEMP_DIR>aosp-context.md`

2. **Rank hypotheses** by confidence (from investigation results)

3. **Build the 7-section Chinese report** and save to `<REPORT_OUTPUT_PATH>`:

```markdown
# Root Cause Analysis Report: <ANALYSIS_ID> — {issue_title}

**Generated at:** {date}

<!-- MODE-GATE: jira-analyze only — adds JIRA metadata header -->
**Issue link:** {jira_url}
**Status:** {status} | **Assignee:** {assignee} | **Priority:** {priority}
<!-- /MODE-GATE -->
<!-- MODE-GATE: aosp-rca only — adds analysis mode -->
**Analysis mode:** {log-based: "log-based analysis" | no-log: "no-log source analysis based on problem description"}
**Input directory:** {input_path or "none (no-log mode)"}
**Analysis project:** {project_name or "unrestricted"}
<!-- /MODE-GATE -->

## 1. Problem Overview
{issue_description_summary}

## 2. Event Timeline
| Time | Source | Severity | Event |
|------|------|----------|------|
| {timestamp} | {logcat/tombstone/ANR/kernel} | {INFO/WARN/ERROR/FATAL} | {description} |

<!-- MODE-GATE: aosp-rca no-log only -->
> No log files were provided, so there is no event timeline. The following analysis is inferred from the problem description and AOSP source structure.
<!-- /MODE-GATE -->

## 3. Key Exceptions / Errors
### Exception 1: {title}
- **Severity:** {FATAL/ERROR/WARN}
- **Source:** {file}:{line}
- **Stack trace:**
  {stack_trace}

<!-- MODE-GATE: aosp-rca no-log only -->
> No log files were provided, so no exceptions were extracted. The following root-cause hypotheses are inferred from AOSP source analysis rather than log evidence.
<!-- /MODE-GATE -->

## 4. AOSP Source Analysis

### 4.1 Key Code Paths
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

<!-- MODE-GATE: aosp-rca no-log only -->
> **No-log mode constraint:** every hypothesis confidence is capped at medium,must not be marked high.this analysis is based on source inference and has not been verified by log evidence.
<!-- /MODE-GATE -->

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

4. Announce report location to the user.

<!-- MODE-GATE: jira-analyze only — post report as JIRA comment -->
5. **Post report as JIRA comment**: `jira_add_comment(issue_key=<KEY>, body=<redacted_report_content>)` — post the redacted report content as a comment on the JIRA issue. If this fails, warn but do not abort (the local report file is still available).
<!-- /MODE-GATE -->
