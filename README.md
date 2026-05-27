<p align="center">
  <img src="https://raw.githubusercontent.com/INNERJOINT/Granada/master/assets/Granada_0080.webp" alt="Granada" width="300"/>
</p>

<h1 align="center">Granada</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/INNERJOINT/Granada/master/assets/MS-06C_Zaku_II.webp" alt="Zeonic Zaku" width="120"/>
</p>

<p align="center">
  <strong>@zeonic/zaku</strong> — 量産型開発支援兵器
</p>

<p align="center">
  <a href="https://github.com/INNERJOINT/Granada/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"/></a>
  <a href="https://www.npmjs.com/package/@zeonic/zaku"><img src="https://img.shields.io/npm/v/@zeonic/zaku.svg" alt="npm version"/></a>
</p>

---

Mass-production dev weapon for Claude Code — AOSP recon, JIRA elimination, Git ammo supply.

Granada is Zeonic's orbital fortress—where Zaku mobile suits are mass-produced before they sortie into combat. This project is a Claude Code plugin for Android platform developers: AOSP source search, JIRA-driven root-cause analysis, and Git workflow automation.

## Installation

```bash
npx skills add @zeonic/zaku
```

Or clone and install locally:

```bash
git clone https://github.com/INNERJOINT/Granada.git
cd Granada && claude plugin install .
```

## Features

| Skill | Description |
|-------|-------------|
| `aosp-analyze` | General AOSP module/function/feature technical report |
| `aosp-rca` | Android crash/issue root-cause analysis via AOSP source search |
| `aosp-plan` | Investigation-driven AOSP planning with parallel code search |
| `aosp-autopilot` | Multi-repo automatic execution engine |
| `aosp-feature-export` | Export AOSP feature element documentation |
| `aosp-feature-import` | Import AOSP features across projects |
| `jira-analyze` | JIRA-driven Android bug RCA with parallel hypothesis investigation |
| `jira-aftersales` | Convert RCA reports to customer-facing scripts |
| `git-commit` | Generate commit messages following repo conventions |

## Tools

### sourcepilot (MCP)

Proxies requests to a remote AOSP MCP server for code search across multiple Android projects. When loaded via the `zaku` plugin, tools are exposed under the `mcp__plugin_zaku_sourcepilot__*` namespace.

Available tools: `mcp__plugin_zaku_sourcepilot__list_projects`, `mcp__plugin_zaku_sourcepilot__search_code`, `mcp__plugin_zaku_sourcepilot__search_symbol`, `mcp__plugin_zaku_sourcepilot__search_file`, `mcp__plugin_zaku_sourcepilot__search_regex`, `mcp__plugin_zaku_sourcepilot__get_file_content`

## Agents

| Agent | Description |
|-------|-------------|
| `aosp-investigator` | AOSP code investigation specialist |
| `aosp-analyst` | AOSP search target extraction and RCA hypothesis synthesis specialist |
| `aosp-log-collector` | Android log collector (JIRA/local logs, extraction, classification) |
| `aosp-log-parser` | Android log parser (logcat, tombstone, ANR, kernel) |

## License

[MIT](LICENSE)
