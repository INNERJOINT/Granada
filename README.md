<p align="center">
  <img src="https://raw.githubusercontent.com/INNERJOINT/Granada/master/assets/granada.svg" alt="Granada" width="200"/>
</p>

<h1 align="center">Granada</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/INNERJOINT/Granada/master/assets/zaku.svg" alt="Zeonic Zaku" width="120"/>
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

Granada（格拉纳达）是 Zeonic 的宇宙要塞，Zaku 从这里量产出击。本项目是一个 Claude Code 插件，为 Android 系统开发者提供 AOSP 源码搜索、JIRA 问题分析、Git 工作流自动化等能力。

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
| `aosp-analyze` | Android crash/issue root-cause analysis via AOSP source search |
| `aosp-plan` | Investigation-driven AOSP planning with parallel code search |
| `aosp-autopilot` | Multi-repo automatic execution engine |
| `aosp-feature-export` | Export AOSP feature element documentation |
| `aosp-feature-import` | Import AOSP features across projects |
| `jira-analyze` | JIRA-driven Android bug RCA with parallel hypothesis investigation |
| `jira-aftersales` | Convert RCA reports to customer-facing scripts |
| `git-commit` | Generate commit messages following repo conventions |

## Tools

### sourcepilot (MCP)

Proxies requests to a remote AOSP MCP server for code search across multiple Android projects.

Available operations: `list_projects`, `search_code`, `search_symbol`, `search_file`, `search_regex`, `get_file_content`

## Agents

| Agent | Description |
|-------|-------------|
| `aosp-investigator` | AOSP code investigation specialist |
| `aosp-log-parser` | Android log parser (logcat, tombstone, ANR, kernel) |

## License

[MIT](LICENSE)
