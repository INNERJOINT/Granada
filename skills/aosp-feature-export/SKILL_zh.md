---
name: aosp-feature-export
description: 通过在所有 AOSP 项目中迭代搜索相关代码，导出 AOSP 功能要素文档
argument-hint: '"<功能描述>" --links <url1,url2,...>'
model: opus
level: 3
---

# AOSP 功能导出技能 (AOSP Feature Export Skill)

记录在 AOSP 之上添加的厂商/第三方功能。输入为功能描述和 GitLab MR/commit URL（厂商修改），通过 GitLab MCP 工具获取 diff 以识别修改点，然后使用 `sourcepilot` 在 AOSP 代码库中搜索被修改或扩展的原始代码。输出一份详尽的中文 Markdown 文档，将该厂商功能映射到 AOSP 的各个层级，并存档到 `.granada/aosp-exports/`。

**关键区别：** 所记录的功能**不是** AOSP 内置功能。它是一个厂商定制功能——由第三方厂商在 AOSP 之上添加或修改的代码。AOSP 搜索阶段寻找的是厂商代码与之交互的原始上下文。

## 用法

```
/zaku:aosp-feature-export "公共DNS" --links https://gitlab.example.com/mt8781_androidu/platform/packages/modules/Connectivity/-/merge_requests/3/diffs
/zaku:aosp-feature-export "fingerprint unlock" --links https://gitlab.example.com/project/path/-/commit/d2794bf5a8132dc9
/zaku:aosp-feature-export "USB audio routing" --links <mr-url1>,<commit-url2>
/zaku:aosp-feature-export "USB audio routing"
```

## 标志 (Flags)

- `--links <url1,url2,...>`: 以逗号分隔的 GitLab MR diff 或 commit URL，作为关键词提取的起点（主要输入模式）
- `--depth shallow|deep`: 控制调查深度（默认：`deep`）
  - `shallow`: 第二阶段（步骤 4）仅运行 1 轮（使用 2 个 Agent）。不进行收敛性检查。适用于快速概览或功能范围已非常明确的情况。
  - `deep`: 第二阶段运行最多 5 轮，并采用基于收敛的终止机制（现有行为，保持不变）。
- `--append`: 增量更新模式。如果该功能已存在先前的导出（通过 slug 匹配），则加载并扩展它，而不是覆盖。跳过第一阶段，并将先前的发现作为第二阶段的初始集合。
- 不带标志：仅使用描述文本进行关键词提取

### 支持的 URL 格式

- **MR 差异 (MR diffs):** `https://{host}/{project_path}/-/merge_requests/{iid}/diffs`（末尾的 `/diffs` 可选）
- **提交 (Commit):** `https://{host}/{project_path}/-/commit/{sha}`

未来展望：URL 路由由提供商分发。目前仅支持 GitLab。后续可能会加入 GitHub/Gerrit 模式。

## 协议

### 步骤 0：状态初始化

```
向 .granada/aosp-feature-export-state.json 写入 JSON，其中 active=true, task_description="<description>"
```

### 步骤 1：健康检查

调用带有 `tool: "list_tools"` 的 `sourcepilot` 以验证 MCP 服务的可达性。然后发起一次轻量级搜索查询以确认上游有响应。

健康检查通过后，读取 `.granada/aosp-config.json` 以显示当前激活 of AOSP 项目：
- 如果已配置：显著显示 `**🔍 AOSP Project: <project_name>**`
- 如果未配置：显示 `**⚠ 未配置 AOSP 项目** — 搜索将不限定项目范围。运行 /zaku:aosp-project 设置项目。`

（`aosp-investigator` 子 Agent 会读取此配置并在搜索调用中自动传递 `project`——无需将其注入到启动提示词中。）

失败时：
```
Bash: rm -f .granada/aosp-feature-export-state.json
```
中止并提示：`AOSP MCP server unreachable. Check SOURCEPILOT_URL and SOURCEPILOT_KEY environment variables.`

### 步骤 2：关键词提取

#### 2a: 从链接或提交中获取变更数据

**如果提供了 `--links`**，解析每个 URL 并调用 GitLab MCP 工具。**并行处理所有 URL**——每个 URL 的获取都是独立的，应当并发发起：

1. 对于每个 URL，通过模式匹配确定其类型：
   - **MR URL**（`{host}/{project_path}/-/merge_requests/{iid}`，包含可选的 `/diffs`）：
     - 提取 `project_id` = `{project_path}`（例如：`mt8781_androidu/platform/packages/modules/Connectivity`）
     - 提取 `merge_request_iid` = `{iid}`
     - **同时**调用 `mcp__gitlab__get_merge_request(project_id, merge_request_iid)` 和 `mcp__gitlab__get_merge_request_diffs(project_id, merge_request_iid)`（对同一个 MR 发起独立的调用） → 提取 MR 标题、描述、已修改的文件路径（old_path、new_path）以及 diff 内容。
   - **Commit URL**（`{host}/{project_path}/-/commit/{sha}`）：
     - 提取 `project_id` = `{project_path}`
     - 提取 `sha` = `{sha}`
     - **同时**调用 `mcp__gitlab__get_commit(project_id, sha)` 和 `mcp__gitlab__get_commit_diff(project_id, sha, full_diff=true)` → 提取提交信息、已修改的文件路径以及 diff 内容。

2. 从获取的数据中提取：
   - 已修改的文件路径（去除扩展名以获取类/模块名称）
   - 来自路径组件的类/接口名称
   - 来自 MR 标题/描述或提交信息的名词短语
   - 来自 diff 新增部分的关键标识符（类声明、方法名称、常量）

3. **错误处理：** 如果任何 URL 返回错误（不可达、404、无权限），记录日志并继续处理其余 URL。如果所有 URL 均失败，则退回到仅描述模式。

#### 2a-discover: 关联提交发现

**前提条件：** 步骤 2a（获取）必须先完成——发现机制会使用从获取数据中得到的项目 ID 和提交日期。

**跳过条件（任一条件触发静默跳过）：**
- 步骤 2a 中的所有 URL 获取都失败且未提供 `--links`（无项目/日期上下文）

**步骤：**

1. **运行时工具验证：** 使用最小参数调用 `mcp__gitlab__list_commits`（第一个项目，`per_page=1`，`since` = 1小时前）。如果该调用返回错误指出工具不存在或不支持，输出 `"⚠ GitLab list_commits 不可用，跳过关联提交发现。"` 并完全跳过发现。

2. **构建发现查询：** 对于从用户提供的 URL 中提取的每个唯一的 `project_id`：
   - 确定时间窗口：`since` = (最早的用户提交日期 - 30 天)，`until` = (最晚的用户提交日期 + 7 天)
   - 查询：`mcp__gitlab__list_commits(project_id, since, until, per_page=100)`
   - 预算：1次验证调用 + 最多29个项目查询 = 总共上限 30 次
   - 如果没有项目上下文可用（未提供 `--links`）：优雅跳过并提示 `"⚠ 无项目上下文，跳过关联提交发现。"`

3. **执行限制：**
   - **调用上限：** 最多 30 次总 `list_commits` API 调用（包括验证）。如果达到上限，停止查询剩余项目。
   - **超时：** 整个发现子步骤的实际耗时限制为 30 秒。如果超时，使用已收集的结果并提示 `"⚠ 关联提交发现超时 (30s)，使用已收集的部分结果。"`

4. **关键词后置过滤：** 从返回的提交中，仅保留其提交信息中包含步骤 2b 关键词集中至少一个关键词 of 提交（从描述 + 提取的 diff 文件路径名中去重得到的 10-15 个词）。丢弃已在用户提供集合中的提交（通过 SHA 匹配）。

5. **输出：** 存储为 `discovered_commits[]`，字段包括：`sha`、`project_id`、`title`、`authored_date`、`web_url`（构建为 `https://{host}/{project_path}/-/commit/{sha}`）。上限为 20 个提交（按日期排序，最近的在前）。

6. **报告：** 输出进度：`"发现关联提交: {N} 条 (来自 {M} 个项目, 耗时 {T}s)"`

#### 2b: 构建关键词集

1. 从描述文本中：提取名词短语、领域术语、子系统名称。
2. 合并从链接/提交中提取的关键词（如果有）。
3. 如果运行了发现机制：合并来自发现的提交信息的附加关键词（名词短语、标识符）。
4. 对所有关键词进行去重，上限为 10-15 个。
5. 按子系统领域（例如：HAL 相关、Framework 相关、App 相关）将关键词分成 3 个关键词组。

### 步骤 3：第一阶段——项目发现

并行启动 3 个 `aosp-investigator` 子 Agent。给每个调查员提供完整的功能上下文，并由其独立决定搜索什么以及如何搜索。编排器不预先生成搜索查询——调查员自己管理搜索策略：

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="调查 AOSP 寻找与厂商功能相关的原始代码: '<description>'。
  
  这是一个第三方/厂商定制功能，而非 AOSP 内置功能。厂商修改或扩展了 AOSP 代码来实现此功能。
  
  厂商修改点 (来自 GitLab diff):
  <来自步骤 2 的已修改文件路径、类名、方法名 and diff 摘要>
  
  你的任务: 搜索 AOSP 以找到厂商修改所交互的原始 (ORIGINAL) 代码。
  - 搜索被厂商代码修改、扩展或调用的原始 AOSP 类/接口
  - 追踪交叉引用: 如果厂商修改了一个接口，在 AOSP 中找到其原始定义、实现类和调用者
  - 覆盖多个 AOSP 层级: HAL、native、framework、system services、apps
  - 记录每个发现: 文件路径、代码片段、架构角色以及它与厂商修改点的关系
  
  按主题分组汇报所有发现的 AOSP 文件路径。包含关于厂商修改如何挂载 (hook) 到 AOSP 架构中的架构观察。"
)
```

收集所有调查员报告。提取唯一的二级目录前缀（AOSP 根目录下的前两个路径段，例如 `frameworks/base`、`hardware/interfaces`、`packages/modules/Connectivity`）。存储在 `discovered_prefixes` 集合中。

### 步骤 4：第二阶段——迭代扩展

**深度关卡：** 如果为 `--depth shallow`，则仅执行 1 轮（启动 2 个 Agent），跳过收敛性检查，直接进入步骤 5。如果为 `--depth deep`（或未指定标志），则运行下方的完整循环。

最多循环 5 轮（包括第一阶段在内的所有轮次中，成功启动 Agent 的总数上限为 15 个）。

每一轮启动 N 个 `aosp-investigator` 子 Agent，其中 N 由发现率决定：
- **第 1 轮**（第二阶段的第一轮）：启动 2 个 Agent（基线，无先前的发现率可用）
- **后续轮次：** 如果上一轮发现了 ≥ 5 个新前缀，则启动 3 个 Agent；否则启动 2 个 Agent
- **单轮上限：** 单轮启动的 Agent 数量绝不超过 3 个
- **总上限：** 跨所有阶段（第一阶段 + 第二阶段）成功启动 15 个 Agent 的限制依然适用
- **可调常数：** 5 个前缀的调整阈值是一个初始启发式规则。根据观察到的发现模式进行调整——如果功能始终探索不足，则降低该值；如果 Agent 的启动在边际效应递减上被浪费，则提高该值。

当 `--depth shallow` 处于激活状态时，动态调整便没有意义（仅运行 1 轮，使用 2 个 Agent）。

将目前累积的发现传递给它们，并让它们独立决定如何扩展搜索——编排器提供上下文，而非查询语句：

```
Agent(
  subagent_type="zaku:aosp-investigator",
  prompt="继续调查 AOSP 寻找与厂商功能相关的原始代码: '<description>'。
  
  这是一个第三方/厂商定制功能。厂商修改或扩展了 AOSP 代码。
  
  先前已发现的 AOSP 路径 (请勿重复搜索这些路径):
  <discovered_prefixes 列表>
  
  已记录的特定文件 (避免冗余搜索):
  <从先前轮次中精选出的最多 50 个被引用最多的文件路径，选择时保证前缀多样性——分布在最不相同的路径前缀中，以最大化覆盖信号>
  
  目前已找到的关键接口和类:
  <从先前轮次中提取的接口名称、类名、AIDL/HIDL 定义>
  
  你的任务: 在已发现区域之外寻找与厂商修改交互的 AOSP 代码。
  - 搜索目前已找到接口的调用者/实现者
  - 寻找厂商功能依赖或扩展的相关 AOSP 子系统
  - 检查 AOSP 中与已修改组件相关的配置、SELinux 策略、init 脚本或测试代码
  - 探索尚未覆盖的上游/下游 AOSP 依赖关系
  
  仅汇报新发现 (不在已发现列表中的路径)。按主题分组，并附带关于厂商修改如何挂接到这些 AOSP 组件的观察。"
)
```

在每轮之后：
1. 收集结果，提取新的二级前缀。
2. **收敛性检查：** 如果本轮向 `discovered_prefixes` 中添加的从未见过的新前缀少于 3 个，则停止迭代。
3. **部分失败处理：** 失败的 Agent 不计入 15 个启动上限。如果一轮中超过 50% 的 Agent 失败，则停止并输出带有警告的部分结果。不进行重试。
4. 向用户输出进度：`Round N (M agents): +X new prefixes (total: Y unique prefixes, Z files discovered)`

<!-- 未来展望：语义收敛（在发现结果在主题上重复时停止，而不仅是按前缀计数）需要 aosp-investigator 输出中包含结构化的 `layer` 字段。
     参见 agents/aosp-investigator.md 了解前提条件的更改。在此字段存在之前，
     收敛性检查仍仅基于前缀计数。 -->

### 步骤 5：综合

这是编排器唯一需要繁重处理的阶段——将所有调查员的报告合并并结构化为最终文档：

1. 连接所有轮次中的所有调查员发现。
2. 发现结果去重：
   a. **精确路径去重：** 合并具有相同文件路径的条目（保留更丰富的观察结果）。
   b. **重叠代码片段去重：** 如果两个发现引用了具有重叠行范围的相同文件，则合并为包含更广泛范围的一个条目。
   c. **语义去重：** 如果两个发现从不同角度描述了相同的接口/类，则巩固合并为一个结合了双方观察的条目。
3. 按二级 AOSP 目录前缀对发现进行分组（这些将成为输出中的“项目”）。
4. 对于每个项目组：收集调查员报告的关键接口、代码模式和设计决策。
5. 从调查员的架构观察中综合出一个整体的“设计原理”部分。
6. 根据调查员对接口-调用者/实现者的发现，映射跨项目依赖关系。
6b. **自适应模板章节：**
   - 如果发现的项目组 ≤ 2 且发现范围仅跨越单一架构层：使用精简输出（省略摘要表格，将接口提及折叠到项目部分）。
   - 如果未找到 AIDL/HIDL 接口：省略“关键接口”章节标题，将任何接口提及折叠到项目部分。
   - 如果仅发现 1 个 AOSP 项目：省略“相关AOSP项目”摘要表格（这与单个项目部分冗余）。
   - 如果未发现跨项目依赖关系：省略“依赖关系”章节。
   - 如果 `discovered_commits[]` 为空（无项目上下文或无匹配）：省略“发现的关联提交”章节。
   - **始终包含：** 概览、Vendor修改概述、设计原理、各项目代码路径、调查日志。
7. **构建提交 URL：** 对于每个输入链接的项目，使用格式 `https://{host}/{project_path}/-/commit/{sha}` 构建可浏览的提交 URL。如果输入是 MR，则使用 MR 的源提交。将这些 URL 包含在输出中的“相关提交”下。
8. 使用下方的模板构建**中文**的输出文档。

### 步骤 5b：追加模式（如果设置了 `--append` 标志）

如果未设置 `--append`，则完全跳过此步骤。

1. 根据描述计算 slug（与步骤 6 的逻辑相同）。
2. 检查 `.granada/aosp-exports/<slug>.md` 是否存在：
   - 如果不存在：提示 `"⚠ 未找到已有导出文件，回退到完整模式。"` 并正常进行（追加模式优雅退化为完整模式——第一阶段如常执行）。
   - 如果存在：加载文件并提取：
     a. 来自“相关AOSP项目”表格的 `discovered_prefixes`
     b. 来自元数据部分的 `last_verified` 时间戳
     c. 所有先前记录的文件路径
3. **陈旧度检查：**
   - 从现有文档的元数据部分解析 `last_verified`。
   - 如果 `last_verified` 超过 30 天：向用户发出警告：`"⚠ 上次验证已超过30天 ({date})。建议不使用 --append 重新完整导出。"`。
   - 继续执行（仅作警告，不阻断）。
4. **向第二阶段注入先前上下文：**
   - 完全跳过第一阶段（步骤 3）——使用加载的前缀作为 `discovered_prefixes` 的初始集合。
   - 在第二阶段的 Agent 提示词中，将加载的前缀包含在“先前已发现”的列表中。
   - 第二阶段正常运行（尊重 `--depth` 标志），仅搜索新发现。
5. **合并策略：**
   - 新发现将追加（APPEND）到现有部分（不替换）。
   - 重复的文件路径进行去重（保留较新的观察结果）。
   - 将 `last_verified` 时间戳更新为当前日期。
   - 更新收敛统计数据以反映追加运行。

**已知限制：** 如果自上次导出以来 AOSP 代码库经历了重大的目录重命名或模块拆分，陈旧的前缀可能会使第二阶段 Agent 陷入死胡同。在这种情况下，请重新运行且不带 `--append` 以进行全新的完整导出。

### 步骤 6：保存

1. 从描述生成 slug：小写，空格/特殊字符替换为连字符，最大 50 个字符。
2. 创建 `.granada/aosp-exports/` 目录（如果不存在）。
3. 将输出写入 `.granada/aosp-exports/<slug>.md`。
4. 调用 `Bash: rm -f .granada/aosp-feature-export-state.json`。
5. 向用户确认：`Feature export saved to .granada/aosp-exports/<slug>.md`。

### 错误恢复

在步骤 0 之后发生任何不可恢复的错误时：
- 如果已收集 Agent 数据，将部分结果写入 `.granada/aosp-exports/<slug>-partial.md`
- 调用 `Bash: rm -f .granada/aosp-feature-export-state.json`
- 向用户报告错误

技能是幂等的——使用相同的输入重新运行会覆盖输出文件。

## 输出模板

```markdown
# Vendor功能元导出: {feature_name}

## 概览
- **功能:** {description}
- **类型:** Vendor/第三方定制功能
- **AOSP项目:** {来自 .granada/aosp-config.json 的 project_name，或 "未配置"}
- **导出日期:** {date}
- **输入链接:** {url_list 或 "无"}
- **输入提交:** {commit_list 或 "无"}
- **提取关键词:** {keyword_list}
- **搜索轮次:** {n}/5
- **发现AOSP关联项目数:** {count}
- **收敛情况:** {在第X轮收敛 / 达到最大轮次}
- **关联提交发现:** {启用/未启用} {如启用: "发现 N 条, 耗时 Xs" / "工具不可用，已跳过" / "超时，部分结果"}

## Vendor修改概述

{基于GitLab diff的vendor改动摘要。说明vendor修改了哪些文件、增加了什么逻辑、修改的入口点在哪里。}

## 设计原理

{AI综合说明该vendor功能如何嵌入AOSP架构。涵盖vendor代码的hook点、对AOSP原有逻辑的修改方式、跨层交互模式。}

## 相关AOSP项目

| 项目 | 路径 | 层级 | 与Vendor功能的关系 |
|------|------|------|-------------------|
| {name} | {aosp_path} | {HAL/Framework/System/App} | {vendor如何修改或依赖此项目} |
| ... | ... | ... | ... |

## 关键接口

### {接口名称}
- **文件:** {aosp/path/to/file}
- **类型:** AIDL / HIDL / Java API / Native / JNI
- **AOSP原始用途:** {该接口在AOSP中的原始作用}
- **Vendor修改方式:** {vendor如何修改、扩展或调用此接口}
- **代码片段:**
  ```
  {相关代码片段}
  ```

## 各项目代码路径

### {项目名称} ({aosp_path_前缀})
- **关键文件:**
  - `{文件路径}`: {用途}
  - `{文件路径}`: {用途}
- **Vendor相关提交:**
  - [{提交信息}]({https://gitlab.host/project_path/-/commit/full_sha}) ({日期})
- **设计说明:** {vendor代码如何hook进此AOSP项目}

## 架构总览

{Vendor功能如何跨越Android各层嵌入: App → Framework → Native → HAL → Kernel。标注vendor修改点与AOSP原始代码的边界。}

## 依赖关系

- Vendor功能依赖 {AOSP项目A} 的 {接口/机制}
- Vendor功能修改了 {AOSP项目B} 的 {类/方法}
- ...

## 发现的关联提交

> 以下提交通过关联提交发现自动获取，非用户直接提供。基于项目时间窗口和关键词匹配筛选。

| 项目 | SHA | 提交信息 | 日期 | 链接 |
|------|-----|----------|------|------|
| {项目路径} | {短_sha} | {标题} | {日期} | [查看]({网页链接}) |
| ... | ... | ... | ... | ... |

**发现参数:** 时间窗口 {开始时间} ~ {结束时间}, 关键词匹配 {关键词数} 个, 扫描项目 {项目数} 个

## 调查日志

| 轮次 | 查询 | 新增前缀 | 总前缀数 | 总文件数 |
|------|------|----------|----------|----------|
| 1 (发现) | {关键词组} | {n} | {n} | {n} |
| 2 | {新查询} | {n} | {n} | {n} |
| ... | ... | ... | ... | ... |
| {最终} | {查询} | {n} | {n} | {n} |

**终止原因:** {收敛 (< 3个新前缀) / 达到最大轮次 / 部分失败}

## 元数据

- **上次验证:** {上次验证日期}
- **更新模式:** {完整导出 / 增量追加}
- **增量历史:** {追加次数，如果适用}
```

## 关键词触发器

- `"aosp export"`, `"aosp feature export"`, `"功能元导出"`, `"feature export"`

## 配置

- 输出目录：`.granada/aosp-exports/`（固定）
- 最大迭代轮次：5
- 最大 Agent 启动总数：15
- 收敛性阈值：每轮少于 3 个新的二级前缀
- 状态模式：`aosp-feature-export`
- 发现调用上限：30（1次验证 + 29次查询）
- 发现超时时间：30秒
- 发现时间窗口：最早提交 - 30 天至最晚提交 + 7 天
- 发现最大结果数：20 个提交（按日期降序排序）
- 发现关键词过滤器：步骤 2b 关键词集（10-15 个词）

## 已知限制 (关联提交发现 V1)

- **多项目：** 仅在用户提供的 `--links` URL 所引用的项目中进行搜索。无跨项目或组级别的发现。（未来展望：GitLab 组级别的提交搜索或通过 MR 链接进行交叉引用。）
- **精确度：** 限于项目范围（未进行路径过滤）。关键词过滤可以减少噪点，但可能会漏掉使用不同术语但语义相关的提交。（未来展望：路径级过滤以提高精确度。）
- **工具依赖：** 需要来自 GitLab MCP 服务的 `mcp__gitlab__list_commits` 工具。如果不可用，将静默跳过。
- **追加模式下的交互：** 发现的提交已包含在追加模式的去重逻辑中（通过 SHA 匹配）。使用 `--append` 重新运行不会重复已发现的提交。
