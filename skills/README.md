# Skills

## `SKILL.md` YAML frontmatter

根据本地 Claude Code 源码，文件型 skill 的 frontmatter 主要由 `src/skills/loadSkillsDir.ts` 中的 `parseSkillFrontmatterFields()` 解析。

文件型 skill 必须使用目录格式：

```text
.claude/skills/<skill-name>/SKILL.md
```

`<skill-name>` 目录名决定技能调用名；frontmatter 里的 `name` 只作为显示名。

### 支持字段

| 字段 | 类型/值 | 作用 |
| --- | --- | --- |
| `name` | 任意值，会转为字符串 | 显示名，不决定调用名。 |
| `description` | string/number/boolean/null | 技能描述；缺失时从正文第一条非空内容提取。 |
| `allowed-tools` | string 或 string[] | 技能展开后额外允许的工具/命令规则；缺失或空为 `[]`。支持逗号/空格分隔，括号内逗号和空格不会切分。 |
| `argument-hint` | string | 在 slash command UI 里显示的参数提示。 |
| `arguments` | string 或 string[] | 命名参数列表，用于 `$name` 替换；字符串按空白切分；纯数字名会被过滤。 |
| `when_to_use` | string | 给模型看的“何时使用”说明，用于技能列表和 token 估算。 |
| `version` | string | 技能版本元数据。 |
| `model` | string | 技能调用后切换模型；支持 `haiku`、`sonnet`、`opus`、`best`、`opusplan` 等 alias，也可写具体模型名；`inherit` 表示不覆盖。 |
| `disable-model-invocation` | boolean-ish | 只有 YAML `true` 或字符串 `"true"` 算 true；为 true 时模型不能通过 `Skill` 工具调用该技能。 |
| `user-invocable` | boolean-ish | 是否允许用户手动输入 `/skill-name` 调用；缺省为 true。 |
| `hooks` | HooksSettings object | 技能被调用时注册 hook；会用 `HooksSchema` 校验，非法则忽略。 |
| `context` | `fork` 或其他 | 只有 `fork` 生效：技能在子 agent 独立上下文执行；其他值等同 inline/默认。 |
| `agent` | string | `context: fork` 时指定 forked agent 类型。 |
| `effort` | `low`/`medium`/`high`/`max` 或整数 | 覆盖技能执行时的 thinking effort；非法值忽略。 |
| `paths` | string 或 string[] | 条件技能：匹配到相关文件路径后才激活。支持逗号分隔和 brace 展开，如 `src/*.{ts,tsx}`；`/**` 后缀会去掉；全 `**` 等同未设置。 |
| `shell` | `bash` 或 `powershell` | 指定 `!` shell block 的解释器；缺省或非法值都回退到 bash。 |

### `hooks` 支持的事件

`hooks` 的事件 key 来自 Claude Code 的 `HOOK_EVENTS`：

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

### 注意事项

- `/skills/` 下不支持单个 `.md` 文件，只支持 `<skill-name>/SKILL.md` 目录格式。
- frontmatter 不是严格 schema：未知字段会被 YAML 解析出来，但文件型 skill loader 不会使用。
- `aliases` 只出现在 bundled skill 的程序化定义中，不是文件型 `SKILL.md` frontmatter 解析字段。
- 布尔型字段使用 `parseBooleanFrontmatter()`：只有 YAML `true` 或字符串 `"true"` 会被视为 true。

### 源码依据

- `src/skills/loadSkillsDir.ts`：加载 skill 目录、解析 frontmatter、创建 skill command。
- `src/utils/frontmatterParser.ts`：解析 YAML、布尔值、`paths`、`shell`。
- `src/utils/markdownConfigLoader.ts`：解析 `allowed-tools`。
- `src/utils/argumentSubstitution.ts`：解析 `arguments` 并替换参数。
- `src/utils/model/model.ts`：解析 `model` alias 和具体模型名。
- `src/utils/effort.ts`：解析 `effort`。
- `src/schemas/hooks.ts`、`src/entrypoints/sdk/coreTypes.ts`：定义 `hooks` schema 和 hook event 列表。
