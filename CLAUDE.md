# zaku

量产型开发支援兵器 — AOSP 索敌、JIRA 歼灭、Git 弹药补给。

## Installation

```bash
npx skills add @zeonic/zaku
```

Or clone and install locally:
```bash
git clone <repo-url> && cd zaku
claude plugin install .
```

## Tools

### sourcepilot (MCP server)

Proxies requests to a remote AOSP MCP server for code search. Configure via plugin userConfig (prompted at enable time):

- `SOURCEPILOT_URL` — Remote AOSP MCP server endpoint
- `SOURCEPILOT_KEY` — Authentication key (stored securely)

When loaded as the `zaku` plugin, the MCP server is namespaced and each remote operation is exposed as its own tool under `mcp__plugin_zaku_sourcepilot__*`.

Usage: `mcp__plugin_zaku_sourcepilot__search_code({ project: "android", query: "..." })`

Available tools:
- `mcp__plugin_zaku_sourcepilot__list_projects`
- `mcp__plugin_zaku_sourcepilot__list_repos`
- `mcp__plugin_zaku_sourcepilot__search_code`
- `mcp__plugin_zaku_sourcepilot__search_symbol`
- `mcp__plugin_zaku_sourcepilot__search_file`
- `mcp__plugin_zaku_sourcepilot__search_regex`
- `mcp__plugin_zaku_sourcepilot__get_file_content`

Subagent `tools:` frontmatter should grant access via the wildcard `mcp__plugin_zaku_sourcepilot__*`.

## Skills

| Skill | Description |
|-------|-------------|
| `aosp-analyze` | General AOSP module/function/feature technical report |
| `aosp-rca` | Android crash/issue root-cause analysis |
| `aosp-plan` | Investigation-driven AOSP planning with parallel code search |
| `aosp-autopilot` | Multi-repo automatic execution engine |
| `aosp-feature-export` | Export AOSP feature element documentation |
| `aosp-feature-import` | Import AOSP features across projects |
| `aosp-project` | List and select active AOSP project |
| `jira-analyze` | JIRA-driven Android bug RCA |
| `jira-aftersales` | Convert RCA reports to customer-facing scripts |
| `gitlab-info` | Extract repository, commit, changed files, and diffs from GitLab URLs |
| `git-commit` | Generate commit messages from staged changes |

## Agents

| Agent | Description |
|-------|-------------|
| `aosp-investigator` | AOSP code investigation specialist |
| `aosp-analyst` | AOSP search target extraction and RCA hypothesis synthesis specialist |
| `aosp-planner` | AOSP consensus planner for pending-approval implementation plans |
| `aosp-architect` | AOSP architecture reviewer for consensus planning |
| `aosp-critic` | AOSP quality gate critic with closed verdicts |
| `aosp-log-collector` | Android log collector (JIRA/local logs, extraction, classification) |
| `aosp-log-parser` | Android log parser (logcat, tombstone, ANR, kernel) |

## Configuration

- **AOSP project config**: `.granada/aosp-config.json`

## Dependencies

- Node.js 20+ (for MCP server)
- `@modelcontextprotocol/sdk` (MCP server runtime)
- Network access to AOSP MCP server (for sourcepilot tool)
