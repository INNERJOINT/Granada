---
description: List and select the active AOSP project and local .repo path for sourcepilot-based skills
argument-hint: '[list | set <project-name> | detect-repo]'
model: haiku
triggers:
  - "aosp project"
  - "aosp_project"
  - "set aosp project"
  - "选择aosp项目"
level: 1
---

# AOSP Project Selection Skill

List available AOSP projects from the remote MCP server, select one as the active project, and discover the local AOSP checkout's `.repo` directory. The selection is saved to `.granada/aosp-config.json` and used by all `mcp__plugin_zaku_sourcepilot__*`-based skills (`aosp-feature-export`, `aosp-plan`, `jira-analyze`) and the `aosp-investigator` agent.

## Usage

```
/zaku:aosp-project
/zaku:aosp-project list
/zaku:aosp-project set <project-name>
/zaku:aosp-project detect-repo
```

- **No arguments / `list`**: Show available projects from the MCP server, the currently active project, and the recorded `.repo` path
- **`set <project-name>`**: Set the active project directly without listing
- **`detect-repo`**: Discover and record the nearest local `.repo` directory without changing the active project

## Protocol

### Step 1: Show Current Config

Read `.granada/aosp-config.json` via `Read` tool.

- If file exists and contains a `project` value, display:
  ```
  **当前 AOSP 项目:** <project_name>
  ```
- If file does not exist or has no `project` field, display:
  ```
  **当前未配置 AOSP 项目** — 搜索将不限定项目范围
  ```
- If file exists and contains a `repoPath` value, display:
  ```
  **当前 .repo 路径:** <repo_path>
  ```
- If file does not exist or has no `repoPath` field, display:
  ```
  **当前未记录 .repo 路径**
  ```

### Step 2: Discover Local .repo Directory

Discover and record the nearest local AOSP checkout by checking, in order:

1. Current working directory: `.repo/`
2. Parent directories up to filesystem root: `<ancestor>/.repo/`
3. If none is found, and the working tree contains likely AOSP markers (`build/make/core/main.mk`, `frameworks/base`, or `system/core`), report that `.repo` was not found for this checkout.

Use `Bash` with `pwd` and a bounded parent-directory loop, or another safe local filesystem check. Do not scan the whole filesystem.

- If found, set `repoPath` to the absolute path of the `.repo` directory and display:
  ```
  **发现 .repo 路径:** <absolute_repo_path>
  ```
- If not found, preserve any existing `repoPath` from config and display:
  ```
  **未发现本地 .repo 路径** — 将保留现有记录（如有）
  ```

If arguments are exactly `detect-repo`, skip MCP project listing and go directly to Step 6 to save the discovered `repoPath` together with the existing `project` value.

### Step 3: MCP Health Check + Fetch Projects

Call `mcp__plugin_zaku_sourcepilot__list_projects()` to verify the MCP server is reachable and fetch the project list in a single round trip.

On failure (network error, auth error, or the tool is not registered), abort with:
```
AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.
```

If the call returns an empty list, abort with:
```
AOSP MCP server returned no projects. You can set the project manually:
Write {"project": "<project-name>"} to .granada/aosp-config.json
```

### Step 4: Display Projects

Display as a numbered list:

```
## 可用 AOSP 项目

1. project-a
2. project-b
3. project-c
...

当前选中: project-b (或 "未配置")
```

**Validation:** If the currently configured project does not appear in the server's project list, display a warning:
```
⚠ 当前配置的项目 "<project_name>" 在服务器中不存在，建议重新选择。
```

### Step 5: User Selection

If arguments contain `set <project-name>`, use that value directly.

Otherwise, use `AskUserQuestion` to let the user pick from the project list. Include a "Keep current" option if a project is already configured, and a "Clear (search all)" option.

### Step 6: Save Config

Use the `Write` tool to save the selection and discovered `.repo` path to `.granada/aosp-config.json`:

```json
{
  "project": "<selected_project_name>",
  "repoPath": "<absolute_repo_path>"
}
```

If no `.repo` directory was discovered, preserve the existing `repoPath` value. If there is no existing value, write `null`.

If the user chose "Clear (search all)", write:

```json
{
  "project": null,
  "repoPath": "<absolute_repo_path_or_existing_value_or_null>"
}
```

For `detect-repo`, keep the existing `project` value unchanged and only update `repoPath`.

Create the `.granada/` directory if it does not exist.

### Step 7: Confirm

Display the result prominently:

```
✅ AOSP 项目已设置为: <project_name 或 未配置>
✅ .repo 路径已记录为: <repo_path 或 未记录>

所有 AOSP 源码搜索将限定在已配置的项目范围内。
本地 AOSP 操作可使用记录的 .repo 路径定位 checkout。
使用 /zaku:aosp-project 可随时更改。
```

## Tool Usage

- `mcp__plugin_zaku_sourcepilot__list_projects`: Lists available AOSP projects from the remote MCP server. Doubles as the MCP health check.
- `Bash`: Discover the nearest local `.repo` directory with a bounded parent-directory check
- `Read`: Read current config from `.granada/aosp-config.json`
- `Write`: Save config to `.granada/aosp-config.json`
- `AskUserQuestion`: Interactive project selection

## Error Handling

- **MCP unreachable**: Abort with env var guidance (Step 3), unless running `detect-repo`
- **No projects returned**: Display "MCP server returned no projects. Check server configuration." (Step 3)
- **No `.repo` found**: Preserve existing `repoPath`; otherwise write `repoPath: null`
- **Stale project**: Warn user if current config points to a project not in the server's list (Step 4)
- **Write failure**: Report the error; user can retry or write manually

## Keyword Triggers

- `"aosp project"`, `"aosp_project"`, `"set aosp project"`, `"选择aosp项目"`
