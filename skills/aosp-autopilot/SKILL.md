---
description: AOSP multi-repository execution engine that parses cross-repository change plans produced by aosp-plan and runs them in parallel
argument-hint: <aosp-plan plan file path or query>
model: opus
artifacts-dirs: [.granada/aosp-autopilot-report]
---

# AOSP Autopilot Skill

AOSP multi-repository execution engine. It parses repository-grouped change plans produced by aosp-plan, creates prefixed topic branches for each repository in a repo-managed AOSP source tree, dispatches agents in parallel to apply changes, verifies the results through diff checks, and uses the git-commit skill to commit changes according to each repository's historical commit style.

## Usage

```
/zaku:aosp-plan "query" -> produces plan -> /zaku:aosp-autopilot .granada/plans/aosp-<slug>.md
/zaku:aosp-autopilot .granada/plans/aosp-xxx.md
/zaku:aosp-autopilot --max-retries 5 .granada/plans/aosp-xxx.md
```

## When to use

- aosp-plan produced a cross-repository change plan that needs automated execution
- The user says "aosp autopilot", "execute aosp plan", or "aosp execute"
- An existing `.granada/plans/aosp-*.md` plan file is available and the plan spans multiple AOSP sub-repositories
- Multiple repositories need branches, edits, and commits created in parallel

## When not to use

- The plan only touches one repository — use `ralph` or an executor agent directly
- No plan from aosp-plan exists yet — run `/zaku:aosp-plan` first
- The current context is not an AOSP source tree managed by `repo` with a `.repo/` directory — use standard `autopilot` or `ralph`
- The user only wants to inspect the plan rather than execute it — use `aosp-plan` only

## Flags

- `--max-retries N`: Maximum retries per repository (default: 3)
- `--dry-run`: Only parse the plan and create branches; do not execute changes
- `--no-commit`: Execute changes but do not commit; leave modifications in the working tree

## Prerequisites

- An AOSP source tree managed by the `repo` tool, with a `.repo/` directory
- A plan file produced by aosp-plan, such as `.granada/plans/aosp-*.md`

## Protocol


### Step 1: Environment detection

**1a. Locate the AOSP root path**

First read `.granada/aosp-config.json`. If its `repoPath` points to an existing `.repo` directory, set that directory's parent as `AOSP_ROOT`.

If `repoPath` does not exist, is empty, or is invalid, search upward from the current working directory for a `.repo/` directory:

```bash
path=$(pwd)
while [ "$path" != "/" ]; do
  if [ -d "$path/.repo" ]; then
    echo "$path"
    break
  fi
  path=$(dirname "$path")
done
```

If `.repo/` is still not found, report the error and exit:

```
AOSP source tree not detected (.repo/ directory not found). Run /zaku:aosp-project detect-repo first, or confirm that the current directory is inside a repo-managed AOSP source tree.
```

Set the configured or detected path as `AOSP_ROOT`; all subsequent repository paths are relative to it.

**1b. Verify repository availability**

Check whether repository directories referenced by the aosp-plan exist under `AOSP_ROOT`:

```bash
ls -d $AOSP_ROOT/frameworks/base $AOSP_ROOT/hardware/interfaces ...
```

If a repository directory is missing, record it and mark it in the final report.

### Step 2: Parse the plan

Read the plan file produced by aosp-plan (`.granada/plans/aosp-*.md`) and extract the following structure:

**2a. Extract the repository task list**

From the plan's "Evidence-Based Plan" section, prefer each step's `**Repo:**` field to group steps into a repo-task list. If an older plan lacks `**Repo:**`, infer the repository from the second-level path prefix in `**AOSP files:**`. Each repo-task contains:

```json
{
  "repo_path": "frameworks/base",
  "branch_name": "feat/<slug>-frameworks-base",
  "steps": [
    {
      "action": "change description",
      "change_type": "source",
      "files": ["path/to/file1.java", "path/to/file2.java"],
      "evidence": "investigation evidence reference",
      "executor_instructions": "specific edit instructions",
      "acceptance": "acceptance criteria",
      "verification": "build, test, or runtime verification method"
    }
  ],
  "depends_on": ["hardware/interfaces"]
}
```

**2b. Infer dependencies**

The Evidence-Based Plan from aosp-plan is ordered by step number; the step order implies dependencies. Use these rules:

1. Process steps in ascending step-number order. For each step, prefer explicit dependencies from `**Dependencies:**`; if missing, extract the repositories involved in the step, preferring `**Repo:**` and otherwise deriving them from `**AOSP files:**` path prefixes.
2. If `**Dependencies:**` is `none`, treat the step as having no explicit dependency.
3. If an older plan lacks `**Dependencies:**`, and a repository first appears in step N while other repositories appeared in earlier steps, that repository depends on all repositories that appeared in earlier steps.
4. Multiple repositories in the same step are considered to be in the same dependency layer, with no dependency on one another.

Example:
```
Step 1 AOSP files: hardware/interfaces/nfc/...  -> layer 0
Step 2 AOSP files: frameworks/base/core/...     -> depends on hardware/interfaces -> layer 1
Step 3 AOSP files: packages/apps/Settings/...   -> depends on frameworks/base -> layer 2
```

If a step's `**AOSP files:**` references files from multiple repositories, assign those repositories to the same layer.

**2c. Generate branch names**

Branch naming rule: `{prefix}/{feature-slug}-{repo-slug}`

- `prefix`: Defaults to `feat`, inferred from the plan title or user arguments
- `feature-slug`: Generated from the plan title, lowercased, spaces converted to hyphens, and special characters removed
- `repo-slug`: Short form of the repository path, such as `frameworks/base` -> `frameworks-base`

Examples:
- `feat/add-nfc-hal-frameworks-base`
- `feat/add-nfc-hal-hardware-interfaces`

### Step 3: Create branches

Create a topic branch for each repository task. Execute repositories by dependency layer; create branches for repositories with no dependency in parallel.

**3a. Check impact from existing `feat` branches**

Before creating the target branch, check existing local branches with the `feat` prefix in the target repository:

```bash
git -C "$AOSP_ROOT/<repo_path>" for-each-ref --format='%(refname:short)' refs/heads/feat
```

If any `feat` branches exist, evaluate each branch's changes relative to the current baseline to determine whether they affect the files planned for this execution:

```bash
git -C "$AOSP_ROOT/<repo_path>" diff --name-only <base>...<feat-branch>
git -C "$AOSP_ROOT/<repo_path>" diff <base>...<feat-branch> -- <planned-file1> <planned-file2> ...
```

Evaluation rules:

1. If an existing `feat` branch does not modify any planned files, record it as no impact and continue creating the target branch.
2. If an existing `feat` branch modifies planned files but the changed regions do not semantically overlap with this plan, record it as a potential impact and include that context in the agent prompt.
3. If an existing `feat` branch modifies the same function, interface, HAL/API definition, or configuration item in the same planned file, treat it as impacting the plan; pause and ask the user whether to continue from that branch, create a new branch while including its diff context, or cancel execution for that repository.
4. If the impact cannot be determined, treat it as impacting the plan; do not continue silently.

**3b. Create the target branch**

```bash
cd $AOSP_ROOT/<repo_path> && repo start <branch_name>
```

If the target branch already exists, first evaluate that branch's changes using the rules in 3a, then ask the user whether to switch to the existing branch or create a new branch name.

**Verify that branch creation succeeded:**

```bash
cd $AOSP_ROOT/<repo_path> && git branch --show-current
```

Confirm that the current branch is the expected topic branch.

### Step 4: Parallel execution

Dispatch executor agents in parallel by topological dependency layer.

**4a. Build execution layers**

Group repo-tasks into layers by dependency relationship:

```
Layer 0 (no dependencies): [hardware/interfaces, system/bt]
Layer 1 (depends on layer 0): [frameworks/base]
Layer 2 (depends on layer 1): [packages/apps/Settings]
```

**4b. Dispatch each layer in parallel**

For each layer, dispatch agents for all repositories in that layer at the same time:

```
Agent(
  subagent_type="zaku:executor",
  prompt="Apply the following changes in the AOSP repository:

Working directory: $AOSP_ROOT/<repo_path>
Current branch: <branch_name>

Important: All file operations must use absolute paths prefixed with $AOSP_ROOT/<repo_path>/...

Change steps:
<detailed step descriptions, including complete file paths, expected changes, acceptance criteria>

Instructions:
- Only modify the specified files
- Follow AOSP code style
- Do not commit after finishing the changes; the main flow handles commits
"
)
```

After one layer completes, proceed to the next layer. Agents within the same layer run fully in parallel.

**4c. Collect execution results**

After each agent completes, collect:
- Which files were modified
- Whether errors occurred
- Any issues requiring human confirmation

### Step 5: Diff verification

After each repository's agent finishes, run diff checks to verify that the changes landed correctly:

```bash
cd $AOSP_ROOT/<repo_path> && git diff --stat
cd $AOSP_ROOT/<repo_path> && git diff
```

**Verification logic:**

1. Check that `git diff --stat` includes all files specified in the plan.
2. Check that `git diff` contains the expected changes through keyword or code-snippet matching.
3. If files are missing or modifications are incomplete, mark the repository as "partial" and record the gap.

**Verification result categories:**

| Status | Meaning | Next action |
|--------|---------|-------------|
| PASS | All specified files were modified and the diff content matches expectations | Proceed to Step 6 (commit) |
| PARTIAL | Some files were modified, or expected changes are missing | Enter the retry flow |
| FAIL | No changes were produced, or changes are completely inconsistent with the plan | Enter the retry flow |

### Step 6: Commit

For repositories that pass verification, use the git-commit skill to generate and create the commit.

Before committing, check whether the target repository already has staged content to avoid mixing unrelated user-staged changes into the automatic commit:

```bash
git -C "$AOSP_ROOT/<repo_path>" diff --staged --name-only
```

If the output is non-empty, confirm that those files belong entirely to the planned files for the current repo-task. Otherwise, pause and ask the user how to proceed; do not continue committing.

Stage only files specified in the plan to avoid accidentally including generated files or IDE configuration:

```bash
git -C "$AOSP_ROOT/<repo_path>" add <file1> <file2> ...
```

The file list comes from `repo-task.steps[].files` parsed in Step 2a. Before invoking git-commit, the staged file set must contain only those planned files.

Then invoke the git-commit skill. The git-commit skill detects the target repository's commit history style and generates a matching commit message:

```
Skill("git-commit", "--repo $AOSP_ROOT/<repo_path> --commit")
```

Note: The target repository path must be passed explicitly through `--repo $AOSP_ROOT/<repo_path>`. Do not rely on a previous `cd` command or persistent shell working directory.

**Note:** If `--no-commit` was specified, skip this step and leave changes in the working tree.

### Step 7: Retry loop

For repositories with PARTIAL or FAIL results, run a retry loop similar to the ralph mechanism:

**7a. Retry policy**

- Maximum retries: specified by `--max-retries` (default: 3)
- On each retry, pass the previous run's failure information and diff gaps back to the agent
- On retry, the agent re-executes all modification steps for that repository, not an incremental subset

**7b. Enhanced retry agent prompt**

On retry, append this to the agent prompt:

```
This is retry N. Previous execution result:

Missing files: <file list>
Gap description: <specific gap>
Full diff: <git diff output>

Re-execute all modification steps and pay special attention to the missing files and gaps above.
```

**7c. Verify after retry**

After each retry, rerun the Step 5 diff verification. If it passes, proceed to Step 6 commit.

**7d. Retries exhausted**

If the repository still does not pass after the maximum retry count, mark that repository as failed, record the failure reason, and continue processing other repositories.

### Step 8: Summary report

After all repositories are processed, regardless of success or failure, generate a summary report:

```markdown
## AOSP Autopilot Execution Report

**Plan:** <plan file path>
**AOSP root:** <AOSP_ROOT>
**Execution time:** <timestamp>

### Execution results

| Repository | Branch | Status | Retry count | Notes |
|------------|--------|--------|-------------|-------|
| frameworks/base | feat/xxx-frameworks-base | PASS | 0 | - |
| hardware/interfaces | feat/xxx-hardware-interfaces | PASS | 1 | First diff was incomplete |
| packages/apps/Settings | feat/xxx-packages-apps-Settings | FAIL | 3 | File not found |

### Statistics
- Total repositories: N
- Succeeded: X
- Failed: Y
- Total retries: Z

### Failed repository details
<List the specific failure reason and git diff output for each failed repository>
```

Save the report to `.granada/aosp-autopilot-report/<timestamp>-<task-name>.md`.

**Report path rules:**

- Directory: `.granada/aosp-autopilot-report/`; create it automatically if it does not exist
- Filename format: `<YYYYMMDD-HHmmss>-<task-name>.md`
  - `timestamp`: Execution start time in `YYYYMMDD-HHmmss` format, such as `20260515-143022`
  - `task-name`: Short task name extracted from the plan title, lowercased, spaces converted to hyphens, special characters removed, truncated to 50 characters
- Example: `.granada/aosp-autopilot-report/20260515-143022-add-nfc-hal.md`



## Integration with aosp-plan

aosp-autopilot is the downstream execution skill for aosp-plan. Typical workflow:

```
/zaku:aosp-plan "AOSP query"
  -> investigation -> plan generation -> save to .granada/plans/aosp-<slug>.md
  -> after user approval
/zaku:aosp-autopilot .granada/plans/aosp-<slug>.md
  -> parse -> branch creation -> parallel execution -> verification -> commit -> report
```

The `--interactive` mode of aosp-plan can invoke aosp-autopilot directly as the follow-up skill in Step 7, execution approval.

## Parsing aosp-plan plan file format

aosp-autopilot parses the Evidence-Based Plan section from aosp-plan. The aosp-plan output format is:

```markdown
## Evidence-Based Plan

### Step 1: <action>
- **Repo:** hardware/interfaces
- **Change type:** source
- **Dependencies:** none
- **Evidence:** E1, E3
- **AOSP files:** hardware/interfaces/nfc/1.0/INfc.hal, hardware/interfaces/nfc/1.0/default/Nfc.cpp
- **Executor instructions:** [specific edit instructions]
- **Acceptance criteria:** [acceptance criteria]
- **Verification:** [build, test, or runtime verification method]

### Step 2: <action>
- **Repo:** frameworks/base
- **Change type:** source
- **Dependencies:** hardware/interfaces
- **Evidence:** E4
- **AOSP files:** frameworks/base/core/java/android/nfc/NfcAdapter.java
- **Executor instructions:** [specific edit instructions]
- **Acceptance criteria:** [verification criteria]
- **Verification:** [build, test, or runtime verification method]
```

Parsing rules:
1. Prefer extracting the repository from each step's `**Repo:**`; when an older plan lacks that field, infer it from the second-level directory prefix in `**AOSP files:**`, such as `frameworks/base` or `hardware/interfaces`.
2. Prefer building dependencies from `**Dependencies:**`; when an older plan lacks that field, step-number order implies dependencies: repositories that appear later depend on repositories that appeared earlier. See Step 2b.
3. Each step's `**Executor instructions:**` is the source of agent edit instructions.
4. Each step's `**Acceptance criteria:**` and `**Verification:**` are references for diff and runtime verification.

## Tool usage

- Use `Agent(subagent_type="zaku:executor")` to dispatch modification agents for each repository in parallel, matching the API style used by aosp-plan for aosp-investigator dispatch.
- Use `Skill("git-commit", "--repo <absolute-repo-path> --commit")` to generate a history-style commit for each repository.
- Use the `Bash` tool to execute git operations such as `repo start`, `git diff`, and `git add <files>`.
- Use `AskUserQuestion` for required user decisions, such as branch conflicts.

## Configuration

```jsonc
{
  "aosp-autopilot": {
    "maxRetries": 3,         // Maximum retries per repository
    "branchPrefix": "feat",  // Topic branch prefix
    "dryRun": false,         // Parse only; do not execute
    "noCommit": false        // Do not commit changes
  }
}
```

## Error handling

| Scenario | Handling |
|----------|----------|
| `.repo/` not found | Report an error and exit |
| Plan file cannot be parsed | Report an error and exit |
| Repository directory does not exist | Mark it as missing in the report and skip that repository |
| Target branch already exists | First evaluate the branch impact on planned files, then ask the user whether to switch, rename, or cancel that repository |
| Agent execution times out | Mark as FAIL and enter the retry loop |
| Diff verification is PARTIAL | Enter the retry loop with the previous gap information attached |
| Retries exhausted | Mark as FAIL and continue processing other repositories |
| git commit fails | Mark as FAIL and leave changes in the working tree |
| Unrecoverable exception during execution | Report current progress |

## Examples

### Basic usage

```
/zaku:aosp-plan "Add a new HAL interface for NFC"
  -> output: .granada/plans/aosp-add-nfc-hal.md

/zaku:aosp-autopilot .granada/plans/aosp-add-nfc-hal.md
  -> detect AOSP root: /home/user/aosp
  -> parse plan: 3 repository tasks
    - hardware/interfaces (layer 0, no dependencies)
    - frameworks/base (layer 1, depends on hardware/interfaces)
    - packages/apps/Settings (layer 2, depends on frameworks/base)
  -> layer 0: execute hardware/interfaces in parallel
  -> layer 1: execute frameworks/base
  -> layer 2: execute packages/apps/Settings
  -> diff verification: all PASS
  -> commit: use git-commit skill
  -> report: 3/3 succeeded
```

### Retry scenario

```
/zaku:aosp-autopilot .granada/plans/aosp-add-nfc-hal.md
  -> ...
  -> frameworks/base: diff verification PARTIAL (missing 1 file modification)
  -> retry 1: attach gap information and re-execute
  -> retry 1 verification: PASS
  -> commit succeeded
  -> report: 3/3 succeeded (1 retry)
```

### Dry-run mode

```
/zaku:aosp-autopilot --dry-run .granada/plans/aosp-add-nfc-hal.md
  -> detect AOSP root: /home/user/aosp
  -> parse plan: 3 repository tasks
  -> branch creation:
    - feat/add-nfc-hal-hardware-interfaces
    - feat/add-nfc-hal-frameworks-base
    - feat/add-nfc-hal-packages-apps-Settings
  -> [DRY RUN] do not execute changes
  -> report: plan parsed successfully; 3 repositories are ready
```
