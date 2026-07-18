# Codex runtime compatibility

This file defines how the generated Zaku skills translate Claude-era workflow notation onto Codex. Follow it before executing any generated skill.

## Skill invocation

- Plugin skills are namespaced by the plugin manifest. Invoke another generated workflow as `$zaku:<skill-name>`; for example, `$zaku:aosp-plan` and `$zaku:aosp-autopilot`.
- Treat examples that name a skill as workflow handoffs, not as shell commands.
- `<skill-arguments>` means the text supplied with the current skill invocation or, for implicit activation, the relevant arguments in the user's request.
- When a workflow names another `$skill`, execute that installed skill according to Codex's skill rules; do not look for a literal `Skill(...)` tool.
- Do not shorten generated handoffs to `$<skill-name>`: unqualified names refer to non-plugin skills and will not resolve this plugin reliably.

## Delegation

`delegate(...)` is declarative notation, not a literal tool name.

- Use the native Codex collaboration surface (`spawn_agent`, `wait_agent`, `send_message`, and related tools) when it is available.
- If `spawn_agent` exposes `agent_type`, use the requested `role` as `agent_type`.
- If `agent_type` is unavailable, read `<plugin-root>/agents/<role>.md` completely, prepend that role guidance to the delegation message, and spawn a generic agent with a concrete snake_case `task_name`.
- Treat declarative `reasoning` values as requested effort only when the active collaboration tool exposes a compatible field; otherwise omit them rather than inventing an argument.
- Use `fork_turns: "none"` when the role prompt and task message are self-contained. Use a bounded recent-turn fork only when the task genuinely depends on conversation context.
- Parallelize independent lanes within the active concurrency limit, then wait for every required result before synthesis.
- Preserve the workflow's read-only/write boundaries when delegating.

## Tool vocabulary

Translate conceptual tool names to the tools actually exposed in the current Codex session:

- `Read` -> filesystem reads or a read-only terminal command.
- `Write` / `Edit` -> `apply_patch` for repository files.
- `Bash` -> the available terminal execution tool.
- `Grep` / `Glob` -> `rg` / `rg --files` through the terminal.
- `update_plan` -> the native plan tracker when available.
- `request_user_input` -> the structured question tool when exposed; otherwise ask one concise plain-text question only when the answer is blocking.
- `MCP tool discovery` -> inspect the MCP tools actually exposed in the session; Codex has no Claude `ToolSearch` call to emulate literally.
- `available web search tooling` / `available web browsing tooling` -> use the web or browser capability actually exposed in the session; if none is available, report that limitation.

Never invent a tool that is not present in the current session.

## MCP naming

- SourcePilot tools use `mcp__sourcepilot__<tool>`.
- Atlassian tools use `mcp__atlassian__<tool>`.
- GitLab tools use `mcp__gitlab__<tool>`.

Use the exact registered tool names shown by Codex. If a required server or operation is unavailable, report the missing capability and the relevant environment variables instead of guessing an alternative name.

## Files and state

- Resolve all relative paths against the user's active workspace, not the installed plugin cache.
- Treat `.granada/**` as workflow state/artifacts owned by Granada.
- Preserve unrelated user changes and avoid destructive Git or filesystem operations unless the user explicitly authorizes them.
- Generated plugin files under `plugins/zaku/` are read-only at runtime; canonical sources live in the repository root.
