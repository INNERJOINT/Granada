---
description: Generate a Git commit message from staged changes by first inspecting recent repository commit history and following the dominant local style. Use when the user asks to write a commit message, summarize staged changes, or commit already-staged files without running `git add`.
argument-hint: [--repo <path>] [--commit]
model: sonnet
---

# Git Commit Generator

Generate a commit message from staged changes.

Treat bracketed prefixes as a reference, not a rule. Only `[type]` is a possible fallback. Additional groups such as `[scope]` and `[product]` are optional and should be inferred from recent commit history rather than forced.

Possible subject formats include:

```text
[type] short summary
[type][scope] short summary
[type][scope][product] short summary
plain summary without brackets
other repository-specific styles
```

## Workflow

1. Parse optional `--repo <path>`; for skill-to-skill calls, require an existing absolute path to the target Git worktree.
2. Run all git commands against the selected repository with `git -C "$REPO_PATH"`.
3. Check whether the staged area is empty.
4. Inspect recent commit subjects to detect the dominant repository style.
5. Read the staged diff and determine the message content.
6. If the staged area is empty, stop and tell the user to stage files first.
7. If the staged area is not empty, check the modified code for obvious syntax errors or incomplete edits before generating the commit message.
8. If the repository style differs from the bracketed reference format, tell the user which format the repository appears to use.
9. Generate the commit message in the repository's style.
10. Run `git commit` only if the user explicitly asks to commit or passes `--commit` as delegated commit authorization.

## Commands

When `--repo <path>` is provided, set `REPO_PATH` to that existing Git worktree path and replace `git` with `git -C "$REPO_PATH"` in every command below.

Inspect recent commit subjects:

```bash
git log -n 20 --pretty=format:%s
```

Inspect staged changes:

```bash
git diff --staged --stat
git diff --staged
```

Commit only when explicitly requested or `--commit` is passed:

```bash
git commit -F - <<'EOF'
commit message here
EOF
```

## Decision Rules

- Only inspect staged changes. Never run `git add`.
- `--commit` commits every currently staged change in the selected repository; callers must ensure the staged set contains only intended files.
- Treat `--commit` as delegated authorization from the direct user request or an invoking workflow that already has commit approval; never pass it from dry-run or no-commit modes.
- When `--repo <path>` is provided, do not rely on the shell working directory; use `git -C "$REPO_PATH"` for every git command.
- For skill-to-skill calls, `--repo <path>` must be an existing absolute path to the target Git worktree.
- Default to generating the message only.
- Follow the repository's dominant recent style over any reference format in this skill.
- If recent history is mixed, follow the most common recent pattern and mention the ambiguity.
- If there is no clear local pattern, use the lightest structured fallback: `[type] short summary`.
- Add `[scope]` only when recent history supports it and the changed files point to a clear module or area.
- Add `[product]` only when recent history shows that it is part of the local convention.
- If the repository uses a different vocabulary such as `feat`, `fix`, or plain English summaries, reuse that vocabulary instead of forcing this skill's examples.
- When checking for syntax errors, prefer lightweight repository-native checks when they are obvious and cheap; otherwise inspect the staged diff for incomplete expressions, mismatched delimiters, and broken code structure.
- Keep the first line short, specific, and action-oriented.
- Use concrete verbs such as `add`, `fix`, `refactor`, `remove`, `rename`, or `update`.
- If local history usually uses a one-line subject only, do not force a multi-line body.
- If local history usually uses a body, write concise `what`, `how`, and `why` sections.
- If staged changes look unrelated, recommend splitting them into separate commits.

## Reference Body Format

Use this only when it matches the repository style or when the user explicitly asks for it:

```text
[type][scope][product] short summary

[what] Changes made
- item 1
- item 2

[how] Implementation approach
- item 1
- item 2

[why] Reason for change
- None
```

## Reference Type Vocabulary

Use these labels only when the repository style supports them:

- `feature`: new functionality
- `fix`: bug fix
- `refactor`: restructuring without intended behavior change
- `docs`: documentation updates
- `style`: formatting or non-functional cleanup
- `test`: tests added or updated
- `chore`: tooling, build, dependency, or maintenance work

## Quality Checks

Before generating the message, check for:

- syntax errors or incomplete edits in the staged code
- mixed unrelated changes in the staged diff
- accidental debug code or temporary logs
- conflict markers or obviously broken content
- a clear dominant module or directory when inferring `scope`

## User Notice Template

When the local style differs from the bracketed reference format, say something like:

```text
Recent commits in this repository mostly use <detected format>, not [type][scope][product].
I will follow the repository style for this commit.
```
