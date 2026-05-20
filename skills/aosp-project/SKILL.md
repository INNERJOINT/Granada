---
name: aosp-project
description: List and select the active AOSP project for sourcepilot-based skills
argument-hint: '[list | set <project-name>]'
model: haiku
triggers:
  - "aosp project"
  - "aosp_project"
  - "set aosp project"
  - "选择aosp项目"
level: 1
---

# AOSP Project Selection Skill

List available AOSP projects from the remote MCP server and select one as the active project. The selection is saved to `.granada/aosp-config.json` and used by all sourcepilot-based skills (`aosp-feature-export`, `aosp-plan`, `jira-analyze`) and the `aosp-investigator` agent.

## Usage

```
/zaku:aosp-project
/zaku:aosp-project list
/zaku:aosp-project set <project-name>
```

- **No arguments / `list`**: Show available projects from the MCP server and the currently active project
- **`set <project-name>`**: Set the active project directly without listing

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

### Step 2: MCP Health Check

Call `sourcepilot(tool: "list_tools")` to verify the MCP server is reachable and discover available tool names.

On failure, abort with:
```
AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.
```

### Step 3: Discover Project Listing Tool

From the `list_tools` result, find the tool that lists available projects (expected name: `list_projects`).

If no project-listing tool is found, abort with:
```
AOSP MCP server does not support project listing. You can set the project manually:
Write {"project": "<project-name>"} to .granada/aosp-config.json
```

### Step 4: Fetch and Display Projects

Call `sourcepilot(tool: "<discovered_project_list_tool>", arguments: {})` to fetch all available projects. The `sourcepilot` tool auto-detects whether the remote server requires arguments wrapped in an `inp` object, so always pass flat key-value arguments.

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

Use the `Write` tool to save the selection to `.granada/aosp-config.json`:

```json
{
  "project": "<selected_project_name>"
}
```

If the user chose "Clear (search all)", write:

```json
{
  "project": null
}
```

Create the `.granada/` directory if it does not exist (it should already exist in any OMC-enabled project).

### Step 7: Confirm

Display the result prominently:

```
✅ AOSP 项目已设置为: <project_name>

所有 sourcepilot 搜索将限定在此项目范围内。
使用 /zaku:aosp-project 可随时更改。
```

## Tool Usage

- `sourcepilot`: MCP discovery (`list_tools`) and project listing (`list_projects`). Arguments are automatically wrapped in `inp` by the sourcepilot tool.
- `Read`: Read current config from `.granada/aosp-config.json`
- `Write`: Save config to `.granada/aosp-config.json`
- `AskUserQuestion`: Interactive project selection

## Error Handling

- **MCP unreachable**: Abort with env var guidance (Step 2)
- **No project-listing tool**: Abort with manual config instructions (Step 3)
- **No projects returned**: Display "MCP server returned no projects. Check server configuration."
- **Stale project**: Warn user if current config points to a project not in the server's list (Step 4)
- **Write failure**: Report the error; user can retry or write manually

## Keyword Triggers

- `"aosp project"`, `"aosp_project"`, `"set aosp project"`, `"选择aosp项目"`
