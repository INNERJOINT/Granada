# newtype

Independent Claude Code plugin providing AOSP code search, JIRA analysis, and git commit utilities.

## Installation

```bash
npx skills add @innerjoint/newtype
```

Or clone and install locally:
```bash
git clone <repo-url> && cd newtype
claude plugin install .
```

## Tools

### sourcepilot (MCP tool)

Proxies requests to a remote AOSP MCP server for code search. Configure via environment variables:

- `AOSP_MCP_URL` — Remote AOSP MCP server endpoint (default: `http://10.23.12.96:8888/mcp`)
- `AOSP_MCP_KEY` — Authentication key (default: `sk-abc123`)

Usage: `sourcepilot { tool: "search_code", arguments: { project: "android", query: "..." } }`

Available remote tools: `list_projects`, `list_repos`, `search_code`, `search_symbol`, `search_file`, `search_regex`, `get_file_content`, `list_tools`

## Skills

| Skill | Description |
|-------|-------------|
| `aosp-analyze` | Android crash log root-cause analysis |
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
| `aosp-log-parser` | Android log parser (logcat, tombstone, ANR, kernel) |

## State Management

This plugin uses native file operations for state persistence (no MCP state tools required):

- **Write state**: `Write` tool → `.plugin-state/<skill>-state.json`
- **Read state**: `Read` tool → `.plugin-state/<skill>-state.json`
- **Clear state**: `Bash: rm -f .plugin-state/<skill>-state.json`
- **AOSP project config**: `.plugin-state/aosp-config.json`

## Dependencies

- Node.js 20+ (for MCP server)
- `@modelcontextprotocol/sdk` (MCP server runtime)
- Network access to AOSP MCP server (for sourcepilot tool)
