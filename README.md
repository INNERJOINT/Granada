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

Granada is Zeonic's orbital fortress—where Zaku mobile suits are mass-produced before they sortie into combat. This project ships Android platform workflows to Claude Code: AOSP source search, JIRA-driven root-cause analysis, and Git workflow automation.

## Installation

Node.js 20 or newer is required for the bundled MCP bridge and lifecycle hooks.

Install the published skill workflows:

```bash
npx skills add @zeonic/zaku
```

For the complete plugin surface, including agents, hooks, and MCP servers, clone the repository and install it as a Claude Code plugin:

```bash
git clone https://github.com/INNERJOINT/Granada.git
cd Granada && claude plugin install .
```

Claude Code discovers the repository's canonical `skills/`, `agents/`, `hooks/hooks.json`, and `.mcp.json` surfaces directly.

## Invocation

Invoke workflows with the `zaku:` plugin namespace:

```text
/zaku:aosp-plan "trace the Android boot flow"
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
| `aosp-project` | List SourcePilot projects and select the active AOSP project |
| `jira-analyze` | JIRA-driven Android bug RCA with parallel hypothesis investigation |
| `jira-aftersales` | Convert RCA reports to customer-facing scripts |
| `gitlab-info` | Extract repository, commit, changed files, and diffs from GitLab URLs |
| `git-commit` | Generate commit messages following repo conventions |

## Tools

### SourcePilot (MCP)

Claude Code connects to a remote AOSP MCP server over HTTP through `.mcp.json`. Set `SOURCEPILOT_URL` and, when required, `SOURCEPILOT_KEY` in the environment that starts Claude Code.

For package contexts that need a self-contained launcher, `bridge/mcp-server.cjs` forwards MCP requests to the same HTTP endpoint using only Node.js built-ins. It discovers the remote tool schema when available and exposes a stable fallback schema when the server is not configured or discovery fails.

| Server | Claude Code namespace | Environment |
| --- | --- | --- |
| SourcePilot | `mcp__plugin_zaku_sourcepilot__*` | `SOURCEPILOT_URL`, `SOURCEPILOT_KEY` |
| Atlassian | `mcp__plugin_zaku_atlassian__*` | `JIRA_URL`, `JIRA_PERSONAL_TOKEN`, `CONFLUENCE_URL`, `CONFLUENCE_PERSONAL_TOKEN` |
| GitLab | `mcp__plugin_zaku_gitlab__*` | `GITLAB_PERSONAL_ACCESS_TOKEN`, `GITLAB_API_URL` |

The optional Atlassian and GitLab stdio servers also require `uvx` and `npx`, respectively, on `PATH`.

### log-unboxer

JIRA serial-number fallback and `.tgz` / `.tar.gz` attachment processing require working `log-unboxer` and `bwrap` executables on `PATH`. `bwrap` (Bubblewrap) provides the fail-closed Linux sandbox around untrusted downloaded bundles. Install `log-unboxer` from the upstream GitLab repository with pipx, then verify the entry point before running `jira-analyze`:

```bash
pipx install "git+ssh://git@gitlab.gz.cvte.cn/XBS_OS_SOFTWARE/tools/log_unboxer.git"
log-unboxer --version
```

The collector uses extraction-filter checks as defense in depth, then confines every archive/SN operation with Bubblewrap and merges only validated regular files from a private stage. `bwrap` is required for these operations on Linux; when unavailable, the collector fails closed while direct `.txt` / `.log` collection remains usable. Python 3.12.13+ is recommended. The collector deliberately does not install, upgrade, or repair external dependencies. If an old editable pipx installation points to a deleted source checkout, replace it from the upstream URL rather than using `pipx reinstall`, which reuses the original install source and options.

The fallback SourcePilot surface includes `list_projects`, `list_repos`, `search_code`, `search_symbol`, `search_file`, `search_regex`, `get_file_content`, and `resolve_project_by_keyword` under the Claude Code namespace above.

## Hooks

Claude Code defers processing of Markdown artifacts under `.granada/**`: `PostToolUse` enqueues the latest eligible source path, and the session `Stop` hook timestamps and optionally translates the final content once. See [scripts/hooks/README.md](scripts/hooks/README.md) for runtime, queue, and environment details.

## Agents

| Agent | Description |
|-------|-------------|
| `aosp-investigator` | AOSP code investigation specialist |
| `aosp-analyst` | AOSP search target extraction and RCA hypothesis synthesis specialist |
| `aosp-planner` | Pending-approval implementation plan synthesizer |
| `aosp-architect` | AOSP architecture and feasibility reviewer |
| `aosp-critic` | Closed-verdict plan quality gate |
| `aosp-log-collector` | Android log collector (JIRA/local logs, extraction, classification) |
| `aosp-log-parser` | Android log parser (logcat, tombstone, ANR, kernel) |
| `executor` | Approved multi-repository implementation executor |

Claude Code discovers the canonical Markdown agents under `agents/`.

## License

[MIT](LICENSE)
