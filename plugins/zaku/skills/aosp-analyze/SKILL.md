---
name: aosp-analyze
description: "General AOSP source/module/function/build-artifact technical report — analyze a feature, module, function, generated file, build artifact, or subsystem via AOSP source search and produce a structured technical report."
artifacts-dirs: [.granada/aosp-analyze]
---
## Codex runtime contract

Before executing this workflow, read `../../references/codex-compat.md` completely.
The `delegate(...)` blocks below are declarative workflow notation; translate them to the native Codex collaboration tools described in that reference.
<Purpose>
Produces a structured technical report about an AOSP module, function, feature, generated file, build artifact, or subsystem. Delegates target extraction to `aosp-analyst` and source investigation to `aosp-investigator` subagents, then synthesises findings into a concise report saved to `.granada/aosp-analyze/`.

This skill does NOT parse logs, generate timelines, or output issue-debugging sections.
</Purpose>

<Steps>

## Phase 1: Initialize

1. **Parse `<skill-arguments>`** for an optional analysis topic and optional project selection:

   - `--project <value>` (pattern `--project\s+(\S+)`): Optional AOSP project override. Strip the flag from arguments.
   - Any remaining non-empty `<skill-arguments>` text is the analysis topic. Preserve spaces and punctuation after trimming surrounding whitespace.
   - Also inspect the user's natural-language request before the slash command. If both sources provide topic text, combine them only when they are complementary; otherwise prefer the explicit `<skill-arguments>` topic.

   **Input validation and routing:**
   1. Reject only malformed flags (for example `--project` without a value, unknown `--flag` options, or path-like arguments that appear to be log directories/files). Abort with:
      ```
      Unsupported arguments. aosp-analyze accepts:
        <analysis topic>    AOSP module/function/feature/generated-file/build-artifact/partition-layout/subsystem to analyze
        --project <name>    Optional AOSP project override

      This skill only analyzes AOSP source and build artifacts; log files and crash dumps are outside its scope.
      ```
   2. Resolve `title` from `<skill-arguments>` topic text first, falling back to the user's natural-language request: the AOSP module, function, feature, generated file, build artifact, partition layout, subsystem, or component they want analyzed.
   3. If no clear topic can be resolved, abort with:
      ```
      No topic provided. Describe the AOSP module, function, feature, generated file, build artifact, partition layout, subsystem, or component to analyze.
      Optional usage:
        $zaku:aosp-analyze <analysis topic> [--project <name>]
      ```

2. **Generate and validate a slug** from the resolved title:
   - Convert all characters outside `[A-Za-z0-9._-]` to `-`.
   - Trim leading `.` or `-`.
   - Truncate to 40 characters.
   - Reject empty slugs.
   - Reject slugs containing `..` or path separators.
   - Require `^[A-Za-z0-9._-]{1,40}$`.
   - Derive `target="/tmp/aosp-analyze-${slug}"` and require the resolved target to start with `/tmp/aosp-analyze-`.

3. **MCP health check**:
   - AOSP: call `mcp__sourcepilot__list_projects()` — if fails, abort with "AOSP MCP (sourcepilot) unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."

4. **Display active AOSP project**:
   - If `--project` override was provided: display `**AOSP Project: <name> (specified on the command line)**` and use this value. Skip reading `.granada/aosp-config.json`.
   - Otherwise, read `.granada/aosp-config.json`:
     - If configured: display `**AOSP Project: <project_name>**`
     - If not configured: display `**AOSP project is not configured** — Searches will not be limited to a project. Run $zaku:aosp-project to configure a project.`

5. **Create a clean temp directory** (after slug and target validation):
```bash
target="/tmp/aosp-analyze-${slug}"
rm -rf -- "$target"
mkdir -p -- "$target"
```

## Phase 2: Target Extraction

Extract structured search targets from the resolved title. Spawn an analyst subagent:

```
delegate(
  role="aosp-analyst",
  reasoning="xhigh",
  message="Extract structured source search targets from the following AOSP technical report topic.

Report topic: <title>

Extract the following information:
1. Core AOSP component/service/class names (such as SurfaceFlinger, AudioFlinger, WindowManagerService)
2. Relevant native libraries, generated artifacts, or build outputs (such as libsurfaceflinger.so, libaudioflinger.so, MT6768_Android_scatter.txt)
3. Involved subsystems (such as display, audio, input, power, camera, storage, build, partition layout)
4. Key function/method names (such as onMessageReceived, setTransactionState)
5. Recommended search keywords (AOSP module names, interface names, make/Soong targets, generated file names, and configuration items)

Group targets into 2-3 search clusters by subsystem.

Save JSON output to /tmp/aosp-analyze-<slug>/search-targets.json:
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

Spawn one `aosp-investigator` per cluster from search-targets.json, **in parallel** (max 3):

```
delegate(
  role="aosp-investigator",
  reasoning="medium",
  message="[If --project override is active, prepend: **AOSP Project Override:** Use project `<name>` for ALL mcp__sourcepilot__* search calls. Do NOT read `.granada/aosp-config.json` — the project has been specified explicitly via CLI flag.]

Investigate AOSP source code for technical report <slug>.

Report topic: <title>
Subsystem cluster: <cluster_subsystem>

Search targets:
- Components: <cluster.components>
- Libraries: <cluster.libraries>
- Functions: <cluster.functions>
- Keywords: <cluster.keywords>

For each target:
1. Use the mcp__sourcepilot__* tools (see Tool_Selection_Matrix in the investigator agent)
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

2. **Build the 8-section technical report** and save to `.granada/aosp-analyze/aosp-analyze-{slug}.md` after redacting common secrets from all included topic text, user-provided context, copied issue text, URLs, headers, command output, and source/investigation excerpts (authorization headers, bearer tokens, API keys, passwords, access/refresh/id tokens, cookies, session IDs, private keys, and signed URL token/key/signature query values):

```markdown
# AOSP Technical Analysis Report: {slug} — {title}

**Generated at:** {date}
**Analysis project:** {project_name or "unrestricted"}

## 1. Overview
{Briefly explain the analysis topic, involved subsystems, and core components. Summarize key findings in 2-3 sentences.}

## 2. Affected Component Diagram
{ASCII box-drawing diagram showing the analyzed component, its subsystem context, related components, and their data/control relationships}

## 3. Key Source Paths
| File | Path | Description |
|------|------|------|
| {filename} | `{aosp/repo/path/to/file}` | {brief description} |

## 4. Core Classes / Functions
### {class_or_function_name}
- **Source location:** `{path}:{line_range}`
- **Functional description:** {what it does}
- **Key code:**
  ```java
  // core logic excerpt
  ```
- **Related components:** {connected components}

{Repeat for each core class/function}

## 5. Call / Data Flow
{Describe the call flow and data flow between components. Use ASCII diagrams for sequence or flow.}

### Call Chain
{description of the call chain}

### Data Flow
{description of how data moves through the system}

## 6. Interfaces and Configuration
{List interfaces, configuration parameters, system properties, build flags, or runtime settings that affect behavior.}

### Key Interfaces
| Interface | Location | Description |
|------|------|------|

### Configuration Parameters
| Parameter | Default value | Description |
|------|--------|------|

## 7. Extension Points and Risks
### Extension Points
{Where and how the code can be extended, overridden, or customized}

### Known Risks / Limitations
{Known limitations, TODOs, FIXMEs found in source, potential race conditions, or areas needing attention}

### Source Search Gaps
{Targets that returned no results — may require manual investigation}

## 8. Next Steps
1. {actionable suggestion with specific file/component references}
2. {actionable suggestion}
3. {optional: areas for deeper investigation}
```

## Phase 5: Finalize

4. Announce report location to the user.

</Steps>

<Error_Handling>
- **AOSP MCP unreachable** → abort with "AOSP MCP (sourcepilot) unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY env vars."
- **Unsupported arguments** → abort with "Unsupported arguments. aosp-analyze accepts <analysis topic> and optional --project <name>. This skill only analyzes AOSP source and build artifacts; log files and crash dumps are outside its scope."
- **No topic provided** → abort with "No topic provided. Describe the AOSP module, function, feature, generated file, build artifact, partition layout, subsystem, or component to analyze."
- **Target extraction fails** → abort with "Target extraction failed — search-targets.json missing."
- **AOSP search returns no results** → note "no AOSP source found" in report, do not fail
- **Agent timeout/failure** → mark cluster as "investigation incomplete", continue with others
- **All agents fail** → report with "insufficient source data" conclusion
</Error_Handling>


<Tool_Usage>
- `mcp__sourcepilot__*` — search AOSP source for target classes, functions, and modules
- `delegate(role="aosp-analyst", reasoning="xhigh")` — target extraction from the resolved topic (Phase 2)
- `delegate(role="aosp-investigator", reasoning="medium")` — parallel source investigation (Phase 3)
- `Write` — save final report to `.granada/aosp-analyze/aosp-analyze-{slug}.md`
</Tool_Usage>

<Examples>
<Good>
```
User request: (slash command invoked directly)
<skill-arguments>: SurfaceFlinger display pipeline architecture in AOSP --project android-14

[Phase 1] Topic: SurfaceFlinger display pipeline architecture. Slug: surfaceflinger-display-pipeline-archit.
          AOSP MCP health check pass. AOSP Project: android-14 (specified on the command line)
[Phase 2] Spawned analyst → extracted 3 clusters: SurfaceFlinger core, HWC, DispSync
          Saved search-targets.json.
[Phase 3] Spawned 3 aosp-investigator agents in parallel.
          Cluster 1 (SurfaceFlinger core): Found SurfaceFlinger.cpp, MessageQueue, Layer, DisplayDevice.
          Cluster 2 (HWC): Found HWComposer HAL interface, Composer HAL aidl.
          Cluster 3 (DispSync): Found DispSync.cpp, EventThread, VSYNC scheduling.
          Saved 8 source-finding-*.md files.
[Phase 4] Report saved to .granada/aosp-analyze/aosp-analyze-surfaceflinger-display-pipeline-archit.md (8 sections).
```
Why good: The topic is accepted from `<skill-arguments>`, `--project` is parsed as an option, and parallel agents are maximized. Report has all 8 sections with ASCII diagrams, call flows, and configuration tables.
</Good>

<Good>
```
User request: Analyze the Binder IPC mechanism, focusing on the driver, ServiceManager, and transaction flow.
<skill-arguments>: (empty)

[Phase 1] Topic: Binder IPC mechanism. Slug: binder-ipc-mechanism. AOSP MCP health check pass.
          AOSP Project: android-14 (from .granada/aosp-config.json)
[Phase 2] Spawned analyst → extracted 2 clusters: Binder driver/kernel, Binder framework/java.
          Search targets refined from the request context.
[Phase 3] Spawned 2 aosp-investigator agents in parallel.
          Cluster 1: Found binder.c, binder_internal.h, ioctl interface.
          Cluster 2: Found Binder.java, ServiceManager.java, BpBinder, BBinder.
          Saved 6 source-finding-*.md files.
[Phase 4] Report saved to .granada/aosp-analyze/aosp-analyze-binder-ipc-mechanism.md (8 sections).
```
Why good: No command arguments are needed when project config already exists. The user request carries the analysis scope.
</Good>

<Good>
```
User request: (slash command invoked directly)
<skill-arguments>: 最终编译产物 MT6768_Android_scatter.txt 的来源和作用；想获取 logcat 日志应该回读 scatter 里的哪块区域

[Phase 1] Topic: 最终编译产物 MT6768_Android_scatter.txt 的来源和作用；想获取 logcat 日志应该回读 scatter 里的哪块区域.
          Slug: MT6768_Android_scatter.txt.
          AOSP MCP health check pass.
[Phase 2] Spawned analyst → extracted clusters: scatter generation/build, partition layout, log persistence/storage.
[Phase 3] Spawned 3 aosp-investigator agents in parallel.
          Cluster 1: Found scatter generation scripts/config.
          Cluster 2: Found partition mapping and generated partition attributes.
          Cluster 3: Found log persistence / pstore / userdata-cache related code paths if present.
[Phase 4] Report explains both the build artifact provenance and why live logcat is normally not read from a scatter partition, with source-backed alternatives.
```
Why good: Generated build artifacts and partition-layout questions are valid aosp-analyze topics even when the user asks an operational follow-up. The skill should analyze source/build provenance and clarify storage/log collection concepts, not reject the topic as unsupported arguments.
</Good>

<Bad>
```
User request: 请分析这个 crash log 并找 root cause.
<skill-arguments>: /tmp/logs --project android-14

[Phase 1] Unsupported ARGUMENTS. Abort: "This skill only analyzes AOSP source and build artifacts; log files and crash dumps are outside its scope."
```
Why bad for aosp-analyze: Log directories and crash/RCA requests are outside this general source/build-artifact analysis skill.
</Bad>
</Examples>

<Guardrails>
**Must have:**
- mcp__sourcepilot__* for AOSP source search (always, not conditional)
- aosp-investigator subagents for parallel source investigation (Phase 3)
- analyst subagent for search target extraction (Phase 2)
- All 8 report sections
- Report saved to `.granada/aosp-analyze/aosp-analyze-{slug}.md`

**Must NOT have:**
- Log parsing, log collection, or timeline construction phases
- Issue-debugging hypothesis sections
- JIRA MCP dependency
- Failure signature extraction or anomaly detection
- Confidence rankings or evidence evaluation
- log-unboxer, aosp-log-collector, or aosp-log-parser dependencies
</Guardrails>
