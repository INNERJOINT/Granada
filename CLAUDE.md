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

### sourcepilot (MCP tool)

Proxies requests to a remote AOSP MCP server for code search. Configure via plugin userConfig (prompted at enable time):

- `SOURCEPILOT_URL` — Remote AOSP MCP server endpoint
- `SOURCEPILOT_KEY` — Authentication key (stored securely)

Usage: `sourcepilot { tool: "search_code", arguments: { project: "android", query: "..." } }`

Available remote tools: `list_projects`, `list_repos`, `search_code`, `search_symbol`, `search_file`, `search_regex`, `get_file_content`, `list_tools`

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
| `git-commit` | Generate commit messages from staged changes |

## Agents

| Agent | Description |
|-------|-------------|
| `aosp-investigator` | AOSP code investigation specialist |
| `aosp-analyst` | AOSP search target extraction and RCA hypothesis synthesis specialist |
| `aosp-log-collector` | Android log collector (JIRA/local logs, extraction, classification) |
| `aosp-log-parser` | Android log parser (logcat, tombstone, ANR, kernel) |

## State Management

This plugin uses native file operations for state persistence (no MCP state tools required):

- **Write state**: `Write` tool → `.granada/<skill>-state.json`
- **Read state**: `Read` tool → `.granada/<skill>-state.json`
- **Clear state**: `Bash: rm -f .granada/<skill>-state.json`
- **AOSP project config**: `.granada/aosp-config.json`

## Dependencies

- Node.js 20+ (for MCP server)
- `@modelcontextprotocol/sdk` (MCP server runtime)
- Network access to AOSP MCP server (for sourcepilot tool)
