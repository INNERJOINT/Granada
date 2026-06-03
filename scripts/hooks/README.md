# Claude Code Hooks 文档覆盖矩阵（Input / Control）

## Runtime layout

`hooks/hooks.json` intentionally keeps the stable Claude Code entrypoint at `scripts/hooks/adapters/claude-entry.cjs`. That file is a minimal CommonJS bootstrap which imports the committed ESM runtime at `dist/adapters/claude-entry.js` and calls its exported `main(...)` function. TypeScript source lives under `src/hooks/**` and is compiled with `npm run build:hooks`.

Use `npm run typecheck:hooks`, `npm run build:hooks`, `npm test`, and `npm run verify:hooks-package` before release. The package verification command packs the plugin, extracts it, executes the packed manifest-facing hook entrypoint, and verifies transitive `dist/**` imports work outside the repository tree. Malformed hook input and unknown routes intentionally exit quietly to avoid noisy Claude Code hook warnings.

`.granada/**/*.md` artifact processing is intentionally deferred: `PostToolUse` only enqueues `Write|Edit` candidates into `.granada/.hooks/artifact-queue/**`, and `Stop` drains the queue once per session to timestamp and translate final source content. This avoids repeated timestamp/translation when Claude edits the same Markdown file multiple times in one session. The runtime queue uses append-only JSON entries, collision-safe creation, an atomic drain lock, and stale cleanup defaults of 24h for journal/failure entries and 15m for drain locks. Legacy direct `timestamp-artifact` / `translate-artifact` routes remain available for compatibility/debugging; direct `translate-artifact` continues to honor `translate-dirs`, while the Stop drain path uses the `.granada` runtime artifact policy.

本 README 用于验收：每个 hook event 是否在该文档中**覆盖了事件专属输入字段（input）**以及**控制/输出方式（control/output）**。

说明：
- 下表的“事件专属输入字段”不包含通用字段（例如 `session_id`、`transcript_path`、`cwd`、`permission_mode`、`effort`、`hook_event_name`、`agent_id`、`agent_type` 等）。
- “控制/输出方式”来自事件小节中的 decision control / output 小节，或正文里明确写出的 “no decision control / cannot block”。

## 覆盖矩阵

| 事件 | Matcher（匹配/过滤） | 事件专属输入字段 | 控制 / 输出方式 |
|---|---|---|---|
| `SessionStart` | 会话启动方式（startup/resume/clear/compact） | `model`, `source` | 不可阻止；stdout 或 `hookSpecificOutput.additionalContext` 可注入上下文 |
| `Setup` | CLI 触发方式（init/maintenance） | `trigger` | 不可阻止；`hookSpecificOutput.additionalContext` 可注入上下文 |
| `InstructionsLoaded` | `load_reason` | `file_path`, `memory_type`, `load_reason`, `globs?`, `trigger_file_path?`, `parent_file_path?` | 无决策控制（仅用于观测/副作用） |
| `UserPromptSubmit` | — | `prompt` | 顶层 `decision:"block"`（+ `reason`）可阻止提示词 |
| `UserPromptExpansion` | `command_name` | `expansion_type`, `command_name`, `command_args`, `command_source`, `prompt` | 顶层 `decision:"block"`（+ `reason`）可阻止 slash 命令展开 |
| `PreToolUse` | tool name（Bash/Edit/.../MCP tool） | `tool_name`, `tool_input`, `tool_use_id` | `hookSpecificOutput.permissionDecision` allow/deny/ask/defer（可配 `updatedInput`/`additionalContext`） |
| `PermissionRequest` | tool name（同 PreToolUse） | `tool_name`, `tool_input`, `tool_use_id`, `permission_suggestions` | `hookSpecificOutput.decision.behavior` allow/deny（可 `updatedInput`/applyRules） |
| `PostToolUse` | tool name（同 PreToolUse） | `tool_input`, `tool_response`, `duration_ms` | 顶层 `decision:"block"`（+ `reason`） |
| `PostToolUseFailure` | tool name（同 PreToolUse） | `tool_name`, `tool_input`, `duration_ms`, `error`, `is_interrupt` | 顶层 `decision:"block"`（+ `reason`） |
| `PostToolBatch` | — | `tool_calls` | 顶层 `decision:"block"`（+ `reason`） |
| `PermissionDenied` | tool name（同 PreToolUse） | `tool_name`, `tool_input`, `tool_use_id`, `reason` | `hookSpecificOutput.retry:true` 提示模型“可以尝试重试” |
| `Notification` | `notification_type` | `message`, `title`, `notification_type` | 无决策控制（仅副作用） |
| `SubagentStart` | agent type | `agent_id`, `agent_type` | 无决策控制；可用 `hookSpecificOutput.additionalContext` 给子代理注入上下文 |
| `SubagentStop` | agent type | `stop_hook_active`, `agent_transcript_path`, `last_assistant_message` | 顶层 `decision:"block"`（+ `reason`）可阻止子代理结束 |
| `TaskCreated` | 无 matcher | `task_id`, `task_subject`, `task_description?`, `teammate_name?`, `team_name?` | exit code 2 阻止创建；或 JSON `continue:false` 直接停止 teammate |
| `TaskCompleted` | 无 matcher | `task_id`, `task_subject`, `task_description?`, `teammate_name?`, `team_name?` | exit code 2 阻止完成；或 JSON `continue:false` 直接停止 teammate |
| `Stop` | — | `stop_hook_active`, `last_assistant_message` | 顶层 `decision:"block"`（+ `reason`）可阻止 Claude 停止 |
| `StopFailure` | matcher 按 `error` | `error`, `error_details?`, `last_assistant_message?` | 无决策控制（输出与 exit code 会被忽略） |
| `TeammateIdle` | 无 matcher | `teammate_name`, `team_name` | exit code 2 阻止 idle（teammate 继续工作）；或 JSON `continue:false` 停止 teammate |
| `ConfigChange` | matcher 按 `source` | `source`, `file_path?` | 顶层 `decision:"block"`（+ `reason`）可阻止配置生效（`policy_settings` 例外不可阻止） |
| `CwdChanged` | 无 matcher | `old_cwd`, `new_cwd` | 不可阻止；可返回 `watchPaths` 动态设置 FileChanged 监控列表 |
| `FileChanged` | watch list + filter | `file_path`, `event` | 不可阻止；可返回 `watchPaths` 更新监控列表 |
| `WorktreeCreate` | — | `name` | 特殊：必须输出 worktree 绝对路径（stdout 或 `hookSpecificOutput.worktreePath`）；失败则创建失败 |
| `WorktreeRemove` | — | `worktree_path` | 无决策控制（仅清理/副作用；失败只记录在 debug） |
| `PreCompact` | `manual` / `auto` | `trigger`, `custom_instructions` | exit code 2 或顶层 `decision:"block"` 可阻止 compact |
| `PostCompact` | `manual` / `auto` | `trigger`, `compact_summary` | 无决策控制（仅副作用） |
| `SessionEnd` | — | `reason` | 无决策控制（仅清理/副作用） |
| `Elicitation` | matcher 按 MCP server name | `mcp_server_name`, `message`, `mode?`, `url?`, `elicitation_id?`, `requested_schema?` | `hookSpecificOutput.action` accept/decline/cancel（accept 时带 `content`）；exit 2 拒绝 |
| `ElicitationResult` | matcher 按 MCP server name | `mcp_server_name`, `action`, `mode?`, `elicitation_id?`, `content?` | `hookSpecificOutput.action` accept/decline/cancel（可覆盖 `content`）；exit 2 阻止响应 |
