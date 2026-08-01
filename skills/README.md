# Skills

The root `skills/` tree is Granada's canonical Claude Code workflow source. Each workflow lives in `skills/<skill-name>/SKILL.md` and is invoked as `/zaku:<skill-name>` when the repository is installed as a Claude Code plugin.

## Claude Code `SKILL.md` YAML frontmatter

According to the local Claude Code source, file-based skill frontmatter is primarily parsed by `parseSkillFrontmatterFields()` in `src/skills/loadSkillsDir.ts`.

User/project file-based skills use the directory format below; a Claude Code plugin exposes the equivalent `<plugin-root>/skills/<skill-name>/SKILL.md` tree:

```text
.claude/skills/<skill-name>/SKILL.md
```

The `<skill-name>` directory name determines the skill invocation name; the `name` field in frontmatter is only a display name. Granada's Claude Code plugin namespace adds the `zaku:` prefix at invocation time.

### Supported fields

| Field | Type/value | Purpose |
| --- | --- | --- |
| `name` | Any value, converted to string | Display name; does not determine the invocation name. |
| `description` | string/number/boolean/null | Skill description; when missing, extracted from the first non-empty body content. |
| `allowed-tools` | string or string[] | Additional allowed tool/command rules after skill expansion; missing or empty becomes `[]`. Supports comma/space separation; commas and spaces inside parentheses are not split. |
| `argument-hint` | string | Argument hint displayed in the slash command UI. |
| `arguments` | string or string[] | Named argument list used for `$name` substitution; strings are split on whitespace; purely numeric names are filtered out. |
| `when_to_use` | string | Model-facing when-to-use guidance, used for the skill list and token estimation. |
| `version` | string | Skill version metadata. |
| `model` | string | Switches model after skill invocation; supports aliases such as `haiku`, `sonnet`, `opus`, `best`, and `opusplan`, or a concrete model name; `inherit` means no override. |
| `disable-model-invocation` | boolean-ish | Only YAML `true` or string `"true"` counts as true; when true, the model cannot invoke the skill through the `Skill` tool. |
| `user-invocable` | boolean-ish | Whether users may manually invoke `/skill-name`; defaults to true. |
| `hooks` | HooksSettings object | Registers hooks when the skill is invoked; validated with `HooksSchema`, invalid values are ignored. |
| `context` | `fork` or other | Only `fork` has an effect: the skill runs in an independent subagent context; other values are equivalent to inline/default. |
| `agent` | string | Specifies the forked agent type when `context: fork` is used. |
| `effort` | `low`/`medium`/`high`/`max` or integer | Overrides thinking effort during skill execution; invalid values are ignored. |
| `paths` | string or string[] | Conditional skill activation: activates only when relevant file paths match. Supports comma separation and brace expansion such as `src/*.{ts,tsx}`; a `/**` suffix is removed; all-`**` is equivalent to unset. |
| `shell` | `bash` or `powershell` | Specifies the interpreter for `!` shell blocks; missing or invalid values fall back to bash. |

### Events supported by `hooks`

The event keys for `hooks` come from Claude Code `HOOK_EVENTS`:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Notification`
- `UserPromptSubmit`
- `SessionStart`
- `SessionEnd`
- `Stop`
- `StopFailure`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `PostCompact`
- `PermissionRequest`
- `PermissionDenied`
- `Setup`
- `TeammateIdle`
- `TaskCreated`
- `TaskCompleted`
- `Elicitation`
- `ElicitationResult`
- `ConfigChange`
- `WorktreeCreate`
- `WorktreeRemove`
- `InstructionsLoaded`
- `CwdChanged`
- `FileChanged`

### Notes

- Single `.md` files are not supported under `/skills/`; only the `<skill-name>/SKILL.md` directory format is supported.
- Frontmatter is not a strict schema: unknown fields are parsed by YAML but ignored by the file-based skill loader.
- `aliases` only appears in programmatic bundled-skill definitions; it is not parsed as file-based `SKILL.md` frontmatter.
- Boolean fields use `parseBooleanFrontmatter()`: only YAML `true` or string `"true"` is treated as true.

### Source references

- `src/skills/loadSkillsDir.ts`: loads skill directories, parses frontmatter, and creates skill commands.
- `src/utils/frontmatterParser.ts`: parses YAML, booleans, `paths`, and `shell`.
- `src/utils/markdownConfigLoader.ts`: parses `allowed-tools`.
- `src/utils/argumentSubstitution.ts`: parses `arguments` and substitutes parameters.
- `src/utils/model/model.ts`: parses `model` aliases and concrete model names.
- `src/utils/effort.ts`: parses `effort`.
- `src/schemas/hooks.ts`, `src/entrypoints/sdk/coreTypes.ts`: define the `hooks` schema and hook event list.
