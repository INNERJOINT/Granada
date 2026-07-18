# Granada repository guidance

Granada is the source repository for the `@zeonic/zaku` Claude Code plugin and the generated `zaku@zeonic-local` Codex plugin. Keep both host surfaces compatible whenever workflow behavior changes.

## Source-of-truth boundaries

- Canonical skills live in `skills/<name>/SKILL.md`; Claude Code invokes them as `/zaku:<name>`.
- Canonical specialist roles live in `agents/*.md`.
- Canonical hook source lives in `src/hooks/**`; compile it to `dist/**` with `npm run build:hooks`.
- `hooks/hooks.json` and `scripts/hooks/adapters/claude-entry.cjs` are the Claude Code hook surface.
- `references/codex-compat.md` defines how generated workflows map Claude notation to Codex tools.
- `plugins/zaku/**` is the generated lightweight Codex plugin bundle. Never hand-edit it.
- `.codex/agents/*.toml` files beginning with `# Granada Codex agent:` are generated project-scoped roles. Never hand-edit them; preserve any unrelated user-owned TOML files in that directory.

## Codex conventions

- Codex invokes a generated workflow as `$zaku:<name>`, for example `$zaku:aosp-rca`; never retain Claude's `/zaku:<name>` form or an unqualified `$<name>` handoff in generated skill text.
- SourcePilot, Atlassian, and GitLab tools use `mcp__sourcepilot__*`, `mcp__atlassian__*`, and `mcp__gitlab__*` in Codex.
- Treat generated `delegate(...)` blocks as declarative instructions for Codex collaboration tools, not as literal tool calls.
- Resolve workflow paths against the user's active workspace. Treat `.granada/**` as workflow state and artifacts, not plugin-cache state.
- Codex plugin manifests do not install custom native agents. Generated skills use project `.codex/agents` when available and bundled `agents/*.md` prompts with generic delegation otherwise.

## Regeneration and verification

Use Node.js 20 or newer.

```bash
npm run build:hooks
npm run sync:codex
npm run verify:codex
npm run typecheck:hooks
npm test
npm run verify:hooks-package
npm run verify:codex-package
```

`npm run sync:codex` regenerates both `plugins/zaku` and Granada-owned `.codex/agents`; `npm run sync:codex-plugin` updates only the plugin bundle. `npm run verify:codex` is read-only and fails if either generated surface is missing or stale.

For documentation-only changes that do not feed the generated bundle, do not regenerate unrelated artifacts. Preserve user changes and avoid destructive Git or filesystem operations.

## Runtime behavior to preserve

- Both hosts enqueue eligible `.granada/**/*.md` edits during `PostToolUse` and drain the final paths once on `Stop`.
- The Codex adapter must split multi-file `apply_patch` input into added, updated, or moved file candidates and ignore deletions.
- Codex translation uses an ephemeral read-only `codex exec` child with hooks disabled; Claude Code uses its non-persistent print command.
- Codex MCP configuration inherits named environment variables with `env_vars`; do not add `${ENV}` interpolation to the generated `.mcp.json`.
- The Codex SourcePilot bridge must remain self-contained and runnable from the plugin cache without repository `node_modules`.
