# Granada repository guidance

Granada is the source repository for the `@zeonic/zaku` Claude Code plugin. Keep the canonical Claude Code workflows, agents, hooks, MCP configuration, and committed runtime artifacts aligned.

## Source-of-truth boundaries

- Canonical skills live in `skills/<name>/SKILL.md`; Claude Code invokes them as `/zaku:<name>`.
- Canonical specialist roles live in `agents/*.md`.
- Canonical hook source lives in `src/hooks/**`; compile it to the committed `dist/**` output with `npm run build:hooks`.
- `hooks/hooks.json` and `scripts/hooks/adapters/claude-entry.cjs` define the Claude Code hook surface.
- `.mcp.json` defines the SourcePilot HTTP server and the optional Atlassian and GitLab stdio servers.
- `bridge/mcp-server.cjs` is the package `main` entrypoint. Keep it self-contained and runnable from an npm package cache without repository `node_modules`; it must use only Node.js built-ins while forwarding SourcePilot MCP requests over HTTP.

## Regeneration and verification

Use Node.js 20 or newer.

```bash
npm run typecheck:hooks
npm run build:hooks
npm test
npm run verify:hooks-package
npm pack --dry-run
npm publish --dry-run
```

When hook runtime source changes, run `npm run build:hooks` and include the resulting committed `dist/**` changes. Run the typecheck, test suite, packed-hook verification, package dry run, and release dry run before publishing. Preserve unrelated user changes and avoid destructive Git or filesystem operations.

## Runtime behavior to preserve

- `PostToolUse` enqueues eligible `.granada/**/*.md` edits into the session artifact queue; `Stop` drains the queue once and processes the final source content.
- The queue keeps the latest entry per source path, uses collision-safe JSON entries and an atomic drain lock, and cleans stale journal/failure entries and drain locks.
- Translation remains controlled by `GRANADA_TRANSLATE_LANG`, `GRANADA_TRANSLATE_ENABLE`, and `GRANADA_TRANSLATE_COMMAND`; the default command is `claude -p --model haiku --no-session-persistence`.
- The log collector must keep its fail-closed Bubblewrap behavior for archive and serial-number processing while allowing direct `.txt` and `.log` collection.
- SourcePilot must continue to use its configured direct HTTP endpoint and optional bearer key. Keep the Atlassian and GitLab MCP server environment variables aligned with `.mcp.json`.
