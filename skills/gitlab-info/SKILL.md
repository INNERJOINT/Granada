---
description: Extract repository, commit/MR metadata, changed files, and diff summaries from GitLab URLs.
argument-hint: '<gitlab-url...>'
when_to_use: Use when the user provides GitLab MR, commit, file, branch, or compare URLs and wants repository identity, modified files, commit details, or diff summaries.
context: fork
model: sonnet
---

# GitLab URL Info

Extract the information contained in GitLab URLs: repository, object type, commit or MR metadata, changed files, diff scope, and concise modification summaries.

## Use When

- User provides one or more GitLab URLs and asks what they contain.
- User wants to know which repository a URL belongs to.
- User wants changed files, modification content, commit message, author/date, or MR title/description from a GitLab MR or commit URL.
- Another zaku skill needs GitLab URL context before AOSP investigation, feature export, or planning.

## Do Not Use When

- User wants a broad GitLab MCP tool catalog.
- User wants to create/update/delete/approve/merge GitLab objects.
- User only asks for generic GitLab usage unrelated to a concrete URL.

## Safety Policy

1. Use read-only GitLab MCP tools only.
2. Never mutate GitLab state from this skill.
3. Prefer URLs returned by GitLab MCP responses; do not invent GitLab URLs.
4. Keep raw diffs short. Summarize changed files first; fetch raw diffs only when needed for the user's question.
5. If a required `mcp__gitlab__*` tool schema is deferred, load it with `ToolSearch` using `select:<tool_name>` before calling it.

## URL Normalize

For each URL, normalize before classification:

1. Preserve the original URL for output.
2. Strip scheme/host and split at `/-/` to derive `project_id`.
3. Preserve query parameters and fragments separately; do not include them in `project_id`.
4. Decode only structural separators needed for routing, such as encoded compare `...`; preserve file paths as GitLab expects them.
5. Record line fragments such as `#L10` or `#L10-L20` as a requested line range.
6. Record query parameters that affect diff scope:
   - `commit_id=<sha>`: selected commit within an MR diff page.
   - `diff_id=<id>`: selected MR diff version.
   - other query parameters such as `expanded=1`: display hints only unless a tool needs them.

## URL Classification

| URL type | Pattern | Extracted values |
| --- | --- | --- |
| Merge request | `/{project_path}/-/merge_requests/{iid}` | `project_id`, `merge_request_iid` |
| MR diffs | `/{project_path}/-/merge_requests/{iid}/diffs` | `project_id`, `merge_request_iid`, optional `commit_id`, optional `diff_id` |
| MR commits | `/{project_path}/-/merge_requests/{iid}/commits` | `project_id`, `merge_request_iid` |
| Commit | `/{project_path}/-/commit/{sha}` | `project_id`, `sha` |
| File/blob | `/{project_path}/-/blob/{ref}/{file_path}` | `project_id`, `ref`, `file_path`, optional line range |
| Tree/branch | `/{project_path}/-/tree/{ref}/{path?}` | `project_id`, `ref`, optional `path` |
| Compare | `/{project_path}/-/compare/{from}...{to}` | `project_id`, `from`, `to` |

Parsing rules:

- `project_id` is the path before `/-/`, without the scheme/host.
- Process multiple URLs independently; run independent GitLab MCP calls concurrently when possible.
- If branch/ref parsing is ambiguous because refs contain `/`, try a small candidate set with `mcp__gitlab__get_branch` before asking the user. Ask only when candidates cannot be verified.
- For blob/tree URLs, prefer the longest verified branch/tag ref and treat the remaining path as `file_path` or tree `path`.

## Query Workflow

### 1. Identify the repository

For every URL, report the parsed `project_id`. When repository metadata matters, call:

```text
mcp__gitlab__get_project(project_id)
```

Extract useful fields if present:

- project name and namespace
- default branch
- repository web URL from the response
- archived/visibility status if relevant

### 2. Merge request URL

For MR URLs, call these in parallel:

```text
mcp__gitlab__get_merge_request(project_id, merge_request_iid)
mcp__gitlab__list_merge_request_changed_files(project_id, merge_request_iid)
```

Extract:

- MR IID, title, state, source branch, target branch
- author, created/updated/merged timestamps if present
- description summary
- changed file list: `old_path`, `new_path`, added/renamed/deleted when available
- commit SHA fields such as `sha`, `merge_commit_sha`, `squash_commit_sha`, and `diff_refs` when present

#### MR diff scope

Always state which scope is being summarized:

- **MR overall:** default scope for a plain MR or MR `/diffs` URL.
- **Selected commit:** when the URL has `commit_id=<sha>`. Also call:
  ```text
  mcp__gitlab__get_commit(project_id, sha, stats=true)
  mcp__gitlab__get_commit_diff(project_id, sha)
  mcp__gitlab__list_merge_request_versions(project_id, merge_request_iid)
  ```
  Use versions to confirm whether `commit_id` is an MR diff version `head_commit_sha`.
- **Selected diff version:** when the URL has `diff_id=<id>`. Call:
  ```text
  mcp__gitlab__get_merge_request_version(project_id, merge_request_iid, version_id, unidiff=true)
  ```
  If the ID is not accepted, call `mcp__gitlab__list_merge_request_versions` and report the available version IDs.

For modification content, prefer targeted file diffs after listing files:

```text
mcp__gitlab__get_merge_request_file_diff(project_id, merge_request_iid, file_paths=[...], unidiff=true)
```

Use `mcp__gitlab__get_merge_request_diffs` only when the user asks for all changes or the changed file set is small.

### 3. Commit URL

For commit URLs, call:

```text
mcp__gitlab__get_commit(project_id, sha, stats=true)
```

Extract:

- full SHA and short SHA
- commit title/message
- author/committer and dates
- parent IDs when present
- stats when present

Fetch commit diff only when the user asks for modification content, the changed file count is small, or the commit stats indicate a concise diff:

```text
mcp__gitlab__get_commit_diff(project_id, sha)
```

Then extract changed files and key code modifications from diff hunks.

### 4. File or branch URL

For blob URLs:

```text
mcp__gitlab__get_file_contents(project_id, file_path, ref)
```

Extract repository, ref, file path, optional line range, and a short content summary. Do not paste large files unless the user asks.

For tree/branch URLs:

```text
mcp__gitlab__get_branch(project_id, branch_name)
mcp__gitlab__get_repository_tree(project_id, path, ref, recursive=false)
```

Use repository tree only to summarize top-level contents or confirm a path exists.

### 5. Compare URL

For compare URLs:

```text
mcp__gitlab__get_branch_diffs(project_id, from, to)
```

Extract changed files and summarize modifications between the two refs. If `from` or `to` is ambiguous, verify candidates with `mcp__gitlab__get_branch` before asking the user.

## Output Format

Answer in Chinese unless the user asks otherwise.

```text
## GitLab URL 信息
- URL: <original url>
- 类型: MR / Commit / File / Branch / Compare
- 仓库: <project_id> (<project name if fetched>)
- 范围: MR overall / selected commit / selected diff version / file line range / compare refs

## 解析结果
- <facts parsed from URL, including query params and fragments>

## MCP 验证结果
- <facts returned by GitLab MCP>

## 修改文件
- `<path>`: <added/modified/deleted/renamed if known> — <short purpose inferred from diff>

## 修改内容摘要
- <high-signal summary of code/content changes>

## 未确认 / 需要确认
- <ambiguous refs, missing permissions, skipped large diffs, or unavailable version IDs>
```

For simple questions such as “这个链接属于哪个仓库”, answer briefly and skip unnecessary sections. For multiple URLs, repeat the URL-specific sections per URL.

## Tool Set

Core tools:

- `mcp__gitlab__get_project`
- `mcp__gitlab__get_merge_request`
- `mcp__gitlab__list_merge_request_changed_files`
- `mcp__gitlab__get_commit`

Optional detail tools:

- `mcp__gitlab__get_merge_request_file_diff`
- `mcp__gitlab__get_merge_request_diffs`
- `mcp__gitlab__get_commit_diff`
- `mcp__gitlab__get_file_contents`
- `mcp__gitlab__get_repository_tree`

Version and ref tools:

- `mcp__gitlab__list_merge_request_versions`
- `mcp__gitlab__get_merge_request_version`
- `mcp__gitlab__get_branch`
- `mcp__gitlab__get_branch_diffs`
