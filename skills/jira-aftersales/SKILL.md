---
description: Convert technical jira-analyze RCA reports into customer-friendly aftersales scripts in Chinese. Posted as JIRA comment for customer service agents.
argument-hint: <JIRA URL or issue key>
model: opus
---

<Purpose>
Converts technical jira-analyze RCA (Root Cause Analysis) reports into customer-friendly aftersales scripts that customer service agents can copy-paste directly to end users. The skill reads an existing jira-analyze report (from local file or JIRA comments), transforms developer-oriented analysis into a 4-section Chinese template (Problem Symptoms / Cause Analysis / Solution / Notes), enforces terminology filtering via deterministic grep post-processing, and posts the result as a JIRA comment.
</Purpose>

<Use_When>
- User wants a customer-facing summary of a jira-analyze technical report
- User says "Aftersales Script", "jira aftersales", "jira aftersales"
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
   - If neither matches, abort with: "Could not parse the JIRA issue key. Provide a URL (https://jira.example.com/browse/PROJ-123) or key (PROJ-123)."

2. **MCP health check**: `jira_get_issue(issue_key=<KEY>, fields="summary")` — if fails, abort with "mcp-atlassian is unavailable. Check the JIRA_URL, JIRA_USERNAME, and JIRA_API_TOKEN environment variables."

3. **Create temp directory**:
```bash
mkdir -p /tmp/jira-aftersales-<KEY>
```

## Phase 2: Detect Existing Report (3-tier fallback)

### Tier 1: Local file (primary — most reliable, no API dependency)

- Read `.granada/specs/jira-analyze-{KEY}.md` using Read tool
- If file exists and contains `# Root Cause Analysis Report:` — use this as the report text
- Proceed to Phase 3

### Tier 2: JIRA comments (secondary — works across machines)

- If local file not found: call `jira_get_issue(issue_key=<KEY>, comment_limit=50)`
- Scan each comment body for line starting with `# Root Cause Analysis Report:`
- If multiple matches: use the one with the latest timestamp (parse from comment metadata, not array position — comment ordering is not guaranteed)
- Extract the full comment body as raw report text
- Proceed to Phase 3

### Tier 3: User instruction (fallback — no report available)

- If neither local file nor JIRA comment contains a report:
- Display: "No jira-analyze report found. Run `/zaku:jira-analyze <KEY>` to generate the report, then rerun this skill."
- Abort gracefully.

<!-- Design note: We intentionally do NOT auto-invoke jira-analyze via Skill() mid-execution.
     Instructing the user to run jira-analyze first keeps this workflow single-purpose and predictable. -->

## Phase 3: Check for Duplicate Aftersales Scripts

- If comments were already fetched in Tier 2, reuse them. Otherwise fetch: `jira_get_issue(issue_key=<KEY>, comment_limit=50)`
- Scan each comment body for line starting with `# Aftersales Script:`
- If found: warn user "An aftersales script comment already exists for this issue. It will be regenerated and overwritten."
- Proceed to Phase 4 regardless (regeneration is allowed)

## Phase 4: Transform to Aftersales Script

### 4a: Report completeness check

- Verify presence of key section markers in the report text:
  - `## 1. Problem Overview` — problem overview (required)
  - `## 5. Root-Cause Hypothesis Ranking` — root cause hypotheses (important)
  - `## 7. Recommended Fix Plan` — fix recommendations (important)
- If `## 5.` is missing: mark as partial, note in transformation prompt that root cause hypotheses are unavailable
- If `## 7.` is missing: mark as partial, note in transformation prompt that fix recommendations are unavailable
- If both `## 1.` and `## 5.` are missing: abort with "The analysis report is incomplete and lacks the problem overview and root-cause hypotheses, so an aftersales script cannot be generated."

### 4b: Transformation subagent

Spawn an executor subagent:

```
Agent(
  subagent_type="zaku:executor",
  model="sonnet",
  prompt="You are an aftersales-script conversion expert. Convert the technical root-cause analysis report into a customer-service script that support agents can copy and paste directly to users.

**Input:** The following is a technical root-cause analysis report:
---
{full_report_text}
---

{partial note if applicable: This report is incomplete and is missing these sections: {missing_sections}. Generate the script from available content; use "needs further investigation" for missing parts instead of guessing.}

**Output requirements:** Output the aftersales script strictly in the following four sections:

# Aftersales Script: {issue_key} — {issue_title}

## Problem Symptoms
Describe the symptom in user-friendly language, such as an app closing unexpectedly while using a feature, a device restarting, or the screen freezing. Do not use technical terms.

## Cause Analysis
Explain why the issue happens in plain language. Translate the technical root cause into an everyday analogy or simple causal relationship.

## Solution
Give specific steps the user can perform. Every step must be clear and actionable.

## Notes
Tell the user how to avoid similar issues and when to contact support again.

**Terminology conversion examples; follow this style:**
- \"SurfaceFlinger crash\" → \"the display function encountered a problem\"
- \"binder IPC failure\" → \"internal system communication encountered an exception\"
- \"null pointer dereference\" → \"the program encountered data it could not handle\"
- \"memory leak / oom\" → \"the program used too many resources\"
- \"ANR (Application Not Responding)\" → \"the app did not respond and the screen froze\"
- \"kernel panic\" → \"the system encountered a serious error and restarted automatically\"

**Strictly forbidden terms that must never appear in the output:**
ANR, NullPointerException, tombstone, null pointer terminology, deadlock terminology, SIGSEGV, SIGABRT, stack trace terminology, backtrace, kernel panic, slab corruption, binder, SurfaceFlinger, ActivityManagerService, oom, out of memory, memory overflow terminology, crash log, logcat, dmesg, kmsg, native crash, JNI, segfault, memory leak terminology, and any other developer-facing terms. The deterministic check below includes Unicode escapes for equivalent Chinese technical terms without embedding Chinese prose in this skill file.

**Allowed basic terms:** unexpected app exit, crash, reboot, lag, version, update, device, app, feature, data, system, screen, operation

**Self-check requirement:** After generating the script, inspect the output word by word and confirm that no forbidden term appears. If one is found, replace it with plain language and output again.

Save output to /tmp/jira-aftersales-<KEY>/aftersales-script.md"
)
```

### 4c: Deterministic grep post-processing

After receiving subagent output:

1. Read `/tmp/jira-aftersales-<KEY>/aftersales-script.md`
2. Run forbidden term grep (word boundaries for short English terms to avoid false positives):
```bash
python3 - <<'PY' /tmp/jira-aftersales-<KEY>/aftersales-script.md
import re, sys
path = sys.argv[1]
text = open(path, encoding='utf-8', errors='ignore').read()
technical_terms = [
    r'\bANR\b', 'NullPointerException', 'tombstone', '\u7a7a\u6307\u9488',
    '\u6b7b\u9501', r'\bSIGSEGV\b', r'\bSIGABRT\b', 'stack.?trace',
    '\u5806\u6808', 'backtrace', 'kernel.?panic', 'slab.?corruption',
    'binder', 'SurfaceFlinger', 'ActivityManagerService', r'\bOOM\b',
    'out.?of.?memory', '\u5185\u5b58\u6ea2\u51fa', 'crash.?log',
    'logcat', 'dmesg', 'kmsg', 'native.?crash', r'\bJNI\b', 'segfault',
    'memory.?leak', '\u5185\u5b58\u6cc4\u6f0f',
]
pattern = re.compile('|'.join(technical_terms), re.I)
for match in pattern.finditer(text):
    print(match.group(0))
PY
```
3. If any violations found:
   - Re-invoke subagent with same prompt + added section: "The previous output contained these forbidden terms: {violations}. Strictly replace these terms and regenerate."
   - Re-grep after second invocation
   - If violations persist after 2 attempts: append warning to output: "\n\n---\n⚠ This script may contain technical terms; manually review it before use."

## Phase 5: Post and Finalize

1. Read the aftersales script from `/tmp/jira-aftersales-<KEY>/aftersales-script.md`

2. **Post as JIRA comment**: `jira_add_comment(issue_key=<KEY>, body=<script_content>)` — if this fails, warn but do not abort (the local copy is still available).

3. **Save local copy** to `.granada/specs/jira-aftersales-{issue_key}.md`

4. Announce completion: "The aftersales script has been generated and posted to JIRA comments. A local copy is saved at .granada/specs/jira-aftersales-{KEY}.md"

</Steps>

<Error_Handling>
- **MCP unreachable** → abort with "mcp-atlassian is unavailable. Check the JIRA_URL, JIRA_USERNAME, and JIRA_API_TOKEN environment variables."
- **No jira-analyze report found (all 3 tiers)** → instruct user to run `/zaku:jira-analyze <KEY>` first, abort gracefully
- **Report too incomplete for transformation** → abort with message explaining which sections are missing: "The analysis report is incomplete and missing {sections}; the aftersales script cannot be generated."
- **Transformation produces forbidden terms after 2 attempts** → append warning "⚠ This script may contain technical terms; manually review it before use.", proceed with output
- **Duplicate aftersales script detected** → warn user, proceed with regeneration
- **JIRA comment post fails** → warn user, provide local file path as fallback: "JIRA comment posting failed; the local copy has been saved at .granada/specs/jira-aftersales-{KEY}.md"
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
[Phase 4] Report completeness: partial (missing ## 7. Recommended Fix Plan).
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
         Tier 3: "No jira-analyze report found. Run /zaku:jira-analyze SPFB-700 to generate the analysis report, then rerun this skill."
```
Why good: Cleanly instructs user to run jira-analyze first. Does not attempt mid-execution Skill() invocation.
</Good>

<Bad>
```
[Phase 4] Output contains: "This issue is caused by an ANR from abnormal binder communication in the SurfaceFlinger process..."
```
Why bad: Contains developer terminology (SurfaceFlinger, binder, ANR). Should be: "The issue happened because the system encountered an internal communication problem while processing display content, causing the app to stop responding and the screen to freeze."
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
- Fixed Chinese output in the 4-section template (Problem Symptoms / Cause Analysis / Solution / Notes)
- Forbidden terminology list with deterministic grep post-processing
- Few-shot transformation examples (6 examples) in the subagent prompt
- Duplicate aftersales script detection via `# Aftersales Script:` signature
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
