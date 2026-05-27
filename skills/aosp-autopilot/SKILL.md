---
description: AOSP 多仓库自动执行引擎，解析 aosp-plan 产出的跨仓库修改计划并并行执行
argument-hint: <aosp-plan 计划文件路径或查询>
model: opus
pipeline: [aosp-plan, aosp-autopilot]
handoff: .granada/plans/aosp-*.md
level: 4
---

# AOSP Autopilot 技能

AOSP 多仓库自动执行引擎。解析 aosp-plan 产出的按仓库分组的修改计划，在 repo 管理的 AOSP 源码树中为每个仓库创建带前缀的 topic branch，并行派发 agent 执行修改，通过 diff 检查验证修改落地，使用 git-commit 技能按仓库历史风格提交。

## 使用方式

```
/zaku:aosp-plan "查询" → 产出计划 → /zaku:aosp-autopilot .granada/plans/aosp-<slug>.md
/zaku:aosp-autopilot .granada/plans/aosp-xxx.md
/zaku:aosp-autopilot --max-retries 5 .granada/plans/aosp-xxx.md
```

## 何时使用

- aosp-plan 产出了跨多仓库的修改计划，需要自动执行
- 用户说 "aosp autopilot"、"执行 aosp 计划"、"aosp execute"
- 已有 `.granada/plans/aosp-*.md` 计划文件，且计划涉及多个 AOSP 子仓库
- 需要在多个仓库中并行创建分支、执行修改并提交

## 何时不用

- 计划只涉及单个仓库 — 直接用 `ralph` 或 executor agent
- 还没有 aosp-plan 产出的计划 — 先运行 `/zaku:aosp-plan`
- 不在 AOSP 源码树中（无 `.repo/` 目录） — 用标准 `autopilot` 或 `ralph`
- 用户只想查看计划不想执行 — 用 `aosp-plan` 即可

## 标志

- `--max-retries N`: 每个仓库的最大重试次数（默认: 3）
- `--dry-run`: 只解析计划和创建分支，不执行修改
- `--no-commit`: 执行修改但不提交，保留在工作区

## 前置条件

- AOSP 源码树通过 `repo` 工具管理（存在 `.repo/` 目录）
- aosp-plan 产出的计划文件（`.granada/plans/aosp-*.md`）

## 协议

### Step 0: 状态初始化

调用 `Write {"active": true} to .granada/aosp-autopilot-state.json` 启用 stop-hook 持续执行。

### Step 1: 环境检测

**1a. 定位 AOSP 根路径**

先读取 `.granada/aosp-config.json`。如果其中 `repoPath` 指向一个存在的 `.repo` 目录，则将其父目录设为 `AOSP_ROOT`。

如果 `repoPath` 不存在、为空或无效，再从当前工作目录开始，向上逐级查找 `.repo/` 目录：

```bash
path=$(pwd)
while [ "$path" != "/" ]; do
  if [ -d "$path/.repo" ]; then
    echo "$path"
    break
  fi
  path=$(dirname "$path")
done
```

如果仍找不到 `.repo/`，调用 `Bash: rm -f .granada/aosp-autopilot-state.json` 后报错退出：

```
未检测到 AOSP 源码树（未找到 .repo/ 目录）。请先运行 /zaku:aosp-project detect-repo，或确认当前目录在 repo 管理的 AOSP 源码树内。
```

将配置或检测到的路径设为 `AOSP_ROOT`，后续所有仓库路径均相对于此。

**1b. 验证仓库可用性**

检查 aosp-plan 中涉及的仓库目录是否存在于 `AOSP_ROOT` 下：

```bash
ls -d $AOSP_ROOT/frameworks/base $AOSP_ROOT/hardware/interfaces ...
```

如果某个仓库目录不存在，记录缺失并在最终报告中标记。

### Step 2: 解析计划

读取 aosp-plan 产出的计划文件（`.granada/plans/aosp-*.md`），提取以下结构：

**2a. 提取仓库任务列表**

从计划的 "Evidence-Based Plan" 部分，优先读取每个步骤的 `**Repo:**` 字段分组为 repo-task 列表；如果旧计划缺少 `**Repo:**`，再按 `**AOSP files:**` 的二级目录前缀推断 repo。每个 repo-task 包含：

```json
{
  "repo_path": "frameworks/base",
  "branch_name": "feat/<slug>-frameworks-base",
  "steps": [
    {
      "action": "修改描述",
      "change_type": "source",
      "files": ["path/to/file1.java", "path/to/file2.java"],
      "evidence": "调查证据引用",
      "executor_instructions": "具体修改指令",
      "acceptance": "验收标准",
      "verification": "构建、测试或运行时验证方式"
    }
  ],
  "depends_on": ["hardware/interfaces"]
}
```

**2b. 推断依赖关系**

aosp-plan 的 Evidence-Based Plan 按步骤编号排列，步骤顺序隐含了依赖关系。推断规则：

1. 按步骤编号升序处理。对每个步骤，优先从 `**Dependencies:**` 读取显式依赖；缺失时提取其涉及的仓库（优先 `**Repo:**`，否则从 `**AOSP files:**` 路径前缀得出）
2. 如果 `**Dependencies:**` 为 `none`，该步骤视为无显式依赖
3. 如果旧计划缺少 `**Dependencies:**`，且某个仓库首次出现在步骤 N，而步骤 N 之前有其他仓库的步骤，则该仓库依赖于前序步骤中所有已出现的仓库
4. 同一步骤内的多个仓库视为无互相依赖（同层级）

示例：
```
Step 1 AOSP files: hardware/interfaces/nfc/...  → 层级 0
Step 2 AOSP files: frameworks/base/core/...     → 依赖 hardware/interfaces → 层级 1
Step 3 AOSP files: packages/apps/Settings/...   → 依赖 frameworks/base → 层级 2
```

如果某个步骤的 `**AOSP files:**` 引用了多个仓库的文件，这些仓库归入同一层级。

**2c. 生成分支名**

分支命名规则：`{prefix}/{feature-slug}-{repo-slug}`

- `prefix`: 默认 `feat`，从计划标题或用户参数推断
- `feature-slug`: 从计划标题生成（小写、空格转连字符、去特殊字符）
- `repo-slug`: 仓库路径的简写（`frameworks/base` → `frameworks-base`）

示例：
- `feat/add-nfc-hal-frameworks-base`
- `feat/add-nfc-hal-hardware-interfaces`

### Step 3: 创建分支

为每个仓库任务创建 topic branch。按依赖层级顺序执行，无依赖的仓库并行创建：

```bash
cd $AOSP_ROOT/<repo_path> && repo start <branch_name>
```

如果分支已存在，询问用户是否切换到现有分支或创建新分支名。

**验证分支创建成功：**

```bash
cd $AOSP_ROOT/<repo_path> && git branch --show-current
```

确认当前分支为预期的 topic branch。

### Step 4: 并行执行

根据依赖图，按拓扑层级并行派发 executor agent。

**4a. 构建执行层级**

将 repo-task 按依赖关系分为层级：

```
层级 0（无依赖）: [hardware/interfaces, system/bt]
层级 1（依赖层级 0）: [frameworks/base]
层级 2（依赖层级 1）: [packages/apps/Settings]
```

**4b. 逐层并行派发**

对每一层，同时派发该层所有仓库的 agent：

```
Agent(
  subagent_type="zaku:executor",
  prompt="在 AOSP 仓库中执行以下修改：

工作目录: $AOSP_ROOT/<repo_path>
当前分支: <branch_name>

重要: 所有文件操作必须使用绝对路径 $AOSP_ROOT/<repo_path>/... 前缀。

修改步骤:
<steps 详细描述，包含完整文件路径、修改内容、验收标准>

注意事项:
- 只修改指定的文件
- 遵循 AOSP 代码风格
- 修改完成后不要 commit（由主流程统一处理）
"
)
```

每层完成后，进入下一层。同层内的 agent 完全并行。

**4c. 执行结果收集**

每个 agent 完成后，收集：
- 修改了哪些文件
- 是否遇到错误
- 需要人工确认的问题（如有）

### Step 5: Diff 验证

每个仓库的 agent 完成后，执行 diff 检查验证修改是否正确落地：

```bash
cd $AOSP_ROOT/<repo_path> && git diff --stat
cd $AOSP_ROOT/<repo_path> && git diff
```

**验证逻辑：**

1. 检查 `git diff --stat` 输出是否包含计划中指定的所有文件
2. 检查 `git diff` 内容是否包含预期的修改（关键字/代码片段匹配）
3. 如果文件缺失或修改不完整，标记为"部分完成"并记录差距

**验证结果分类：**

| 状态 | 含义 | 后续动作 |
|------|------|----------|
| PASS | 所有指定文件已修改，diff 内容符合预期 | 进入 Step 6（提交） |
| PARTIAL | 部分文件已修改，或有遗漏 | 进入重试流程 |
| FAIL | 未产生任何修改，或修改完全不符 | 进入重试流程 |

### Step 6: 提交

对验证通过（PASS）的仓库，使用 git-commit 技能生成并提交 commit。

提交前先检查目标仓库是否已有 staged 内容，避免把用户预先暂存的无关改动混入自动提交：

```bash
git -C "$AOSP_ROOT/<repo_path>" diff --staged --name-only
```

如果输出非空，必须确认这些文件完全属于当前 repo-task 的计划文件；否则暂停并询问用户处理方式，不要继续提交。

只暂存计划中指定的文件（避免意外包含生成文件或 IDE 配置）：

```bash
git -C "$AOSP_ROOT/<repo_path>" add <file1> <file2> ...
```

文件列表从 Step 2a 解析的 repo-task.steps[].files 中获取；调用 git-commit 前，staged 文件集合必须只包含这些计划文件。

然后调用 git-commit 技能（git-commit 会检测目标仓库的 commit 历史风格并生成对应格式的 commit message）：

```
Skill("git-commit", "--repo $AOSP_ROOT/<repo_path> --commit")
```

注意：必须通过 `--repo $AOSP_ROOT/<repo_path>` 显式传入目标仓库路径；不要依赖前置 `cd` 命令或 shell 工作目录持久化。

**注意：** 如果指定了 `--no-commit`，跳过此步骤，修改保留在工作区。

### Step 7: 重试循环

对 PARTIAL 或 FAIL 的仓库，执行重试循环（类似 ralph 机制）：

**7a. 重试策略**

- 最大重试次数：由 `--max-retries` 指定（默认 3）
- 每次重试时，将上一轮的失败信息和 diff 差距反馈给 agent
- 重试时 agent 重新执行该仓库的全部修改步骤（非增量）

**7b. 重试 agent 提示增强**

重试时在 agent prompt 中附加：

```
这是第 N 次重试。上一轮执行结果：

缺失文件: <file list>
差距描述: <具体差距>
完整 diff: <git diff output>

请重新执行所有修改步骤，特别注意上述缺失和差距。
```

**7c. 重试后验证**

每次重试后重新执行 Step 5 的 diff 验证。如果 PASS，进入 Step 6 提交。

**7d. 重试耗尽**

如果达到最大重试次数仍未 PASS，标记该仓库为"失败"，记录失败原因，继续处理其他仓库。

### Step 8: 汇总报告

所有仓库处理完毕后（无论成功或失败），生成汇总报告：

```markdown
## AOSP Autopilot 执行报告

**计划:** <计划文件路径>
**AOSP 根:** <AOSP_ROOT>
**执行时间:** <时间戳>

### 执行结果

| 仓库 | 分支 | 状态 | 重试次数 | 备注 |
|------|------|------|----------|------|
| frameworks/base | feat/xxx-frameworks-base | PASS | 0 | - |
| hardware/interfaces | feat/xxx-hardware-interfaces | PASS | 1 | 第1次 diff 不完整 |
| packages/apps/Settings | feat/xxx-packages-apps-Settings | FAIL | 3 | 文件未找到 |

### 统计
- 总仓库数: N
- 成功: X
- 失败: Y
- 总重试次数: Z

### 失败仓库详情
<对每个失败仓库，列出具体失败原因和 git diff 输出>
```

将报告保存到 `.granada/aosp-autopilot-report/<timestamp>-<task-name>.md`。

**报告路径规则：**

- 目录：`.granada/aosp-autopilot-report/`（不存在时自动创建）
- 文件名格式：`<YYYYMMDD-HHmmss>-<task-name>.md`
  - `timestamp`：执行开始时间，格式 `YYYYMMDD-HHmmss`（如 `20260515-143022`）
  - `task-name`：从计划标题提取的简要任务名（小写、空格转连字符、去特殊字符、截断至 50 字符）
- 示例：`.granada/aosp-autopilot-report/20260515-143022-add-nfc-hal.md`

### Step 9: 清理

调用 `Write {"active": false} to .granada/aosp-autopilot-state.json` 标记完成。

## 状态生命周期

aosp-autopilot 管理自身状态以启用 stop-hook 持续执行。

| 场景 | 状态操作 |
|------|----------|
| 进入时 | `Write {"active": true} to .granada/aosp-autopilot-state.json` |
| 正常完成 | `Write {"active": false} to .granada/aosp-autopilot-state.json` |
| `.repo/` 未找到（不可恢复） | `Bash: rm -f .granada/aosp-autopilot-state.json` |
| 计划文件无法解析（不可恢复） | `Bash: rm -f .granada/aosp-autopilot-state.json` |
| 执行中异常退出 | 状态保留 active=true，下次启动可恢复 |
| 用户取消 | `/zaku:cancel` 内部调用 `rm -f .granada/*-state.json` |

注意：不要在准备启动后续技能前调用 `rm -f .granada/*-state.json`。`rm -f .granada/*-state.json` 的 30 秒取消信号会禁用所有 mode 的 stop-hook。正常完成时使用 `Write JSON with active=false)`。

## 与 aosp-plan 的集成

aosp-autopilot 是 aosp-plan 的下游执行技能。典型工作流：

```
/zaku:aosp-plan "AOSP 查询"
  → 调查 → 计划生成 → 保存到 .granada/plans/aosp-<slug>.md
  → 用户批准后
/zaku:aosp-autopilot .granada/plans/aosp-<slug>.md
  → 解析 → 分支创建 → 并行执行 → 验证 → 提交 → 报告
```

aosp-plan 的 `--interactive` 模式在 Step 7（执行批准）可以直接调用 aosp-autopilot 作为后续技能。

## aosp-plan 计划文件格式解析

aosp-autopilot 解析 aosp-plan 的 Evidence-Based Plan 部分。aosp-plan 的输出格式为：

```markdown
## Evidence-Based Plan

### Step 1: <action>
- **Repo:** hardware/interfaces
- **Change type:** source
- **Dependencies:** none
- **Evidence:** E1, E3
- **AOSP files:** hardware/interfaces/nfc/1.0/INfc.hal, hardware/interfaces/nfc/1.0/default/Nfc.cpp
- **Executor instructions:** [具体修改指令]
- **Acceptance criteria:** [验收标准]
- **Verification:** [构建、测试或运行时验证方式]

### Step 2: <action>
- **Repo:** frameworks/base
- **Change type:** source
- **Dependencies:** hardware/interfaces
- **Evidence:** E4
- **AOSP files:** frameworks/base/core/java/android/nfc/NfcAdapter.java
- **Executor instructions:** [具体修改指令]
- **Acceptance criteria:** [验证标准]
- **Verification:** [构建、测试或运行时验证方式]
```

解析规则：
1. 优先从每个步骤的 `**Repo:**` 中提取仓库；旧计划缺少该字段时，再从 `**AOSP files:**` 的二级目录前缀（如 `frameworks/base`、`hardware/interfaces`）推断
2. 优先从 `**Dependencies:**` 建立依赖关系；旧计划缺少该字段时，步骤编号顺序隐含依赖关系：后出现的仓库依赖先出现的仓库（详见 Step 2b）
3. 每个步骤的 `**Executor instructions:**` 是 agent 修改指令来源
4. 每个步骤的 `**Acceptance criteria:**` 和 `**Verification:**` 作为 diff 与运行验证的参考

## 工具使用

- 使用 `Agent(subagent_type="zaku:executor")` 并行派发各仓库的修改 agent（与 aosp-plan 的 aosp-investigator 派发保持一致的 API 风格）
- 使用 `Skill("git-commit", "--repo <absolute-repo-path> --commit")` 为每个仓库生成符合历史风格的 commit
- 使用 `Write` / `Read` 管理执行状态（.granada/ 目录）
- 使用 `Bash` 工具执行 `repo start`、`git diff`、`git add <files>` 等 git 操作
- 使用 `AskUserQuestion` 在需要用户决策时（如分支冲突）交互

## 配置

```jsonc
{
  "aosp-autopilot": {
    "maxRetries": 3,         // 每个仓库最大重试次数
    "branchPrefix": "feat",  // topic branch 前缀
    "dryRun": false,         // 只解析不执行
    "noCommit": false        // 不提交修改
  }
}
```

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| `.repo/` 未找到 | `rm -f .granada/aosp-autopilot-state.json` + 报错退出 |
| 计划文件无法解析 | `rm -f .granada/aosp-autopilot-state.json` + 报错退出 |
| 仓库目录不存在 | 在报告中标记为缺失，跳过该仓库 |
| 分支已存在 | 询问用户是否切换或重新命名 |
| agent 执行超时 | 标记为 FAIL，进入重试循环 |
| diff 验证 PARTIAL | 进入重试循环，附加上一轮差距信息 |
| 重试耗尽 | 标记为 FAIL，继续处理其他仓库 |
| git commit 失败 | 标记为 FAIL，修改保留在工作区 |
| 执行中不可恢复异常 | `Write {"active": false, "error": "<reason>"} to .granada/aosp-autopilot-state.json` + 报告当前进度 |

## 示例

### 基本用法

```
/zaku:aosp-plan "为 NFC 添加新的 HAL 接口"
  → 产出: .granada/plans/aosp-add-nfc-hal.md

/zaku:aosp-autopilot .granada/plans/aosp-add-nfc-hal.md
  → 检测 AOSP 根: /home/user/aosp
  → 解析计划: 3 个仓库任务
    - hardware/interfaces (层级 0, 无依赖)
    - frameworks/base (层级 1, 依赖 hardware/interfaces)
    - packages/apps/Settings (层级 2, 依赖 frameworks/base)
  → 层级 0: 并行执行 hardware/interfaces
  → 层级 1: 执行 frameworks/base
  → 层级 2: 执行 packages/apps/Settings
  → diff 验证: 全部 PASS
  → 提交: 使用 git-commit 技能
  → 报告: 3/3 成功
```

### 重试场景

```
/zaku:aosp-autopilot .granada/plans/aosp-add-nfc-hal.md
  → ...
  → frameworks/base: diff 验证 PARTIAL (缺少 1 个文件修改)
  → 重试 1: 附加差距信息，重新执行
  → 重试 1 验证: PASS
  → 提交成功
  → 报告: 3/3 成功 (1 次重试)
```

### Dry-run 模式

```
/zaku:aosp-autopilot --dry-run .granada/plans/aosp-add-nfc-hal.md
  → 检测 AOSP 根: /home/user/aosp
  → 解析计划: 3 个仓库任务
  → 分支创建:
    - feat/add-nfc-hal-hardware-interfaces
    - feat/add-nfc-hal-frameworks-base
    - feat/add-nfc-hal-packages-apps-Settings
  → [DRY RUN] 不执行修改
  → 报告: 计划解析成功，3 个仓库已准备就绪
```
