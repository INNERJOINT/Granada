import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(root, 'plugins', 'zaku');
const codexAgentsRoot = join(root, '.codex', 'agents');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const pluginOnly = args.has('--plugin-only');

const PLUGIN_NAMESPACE = 'zaku';
const GENERATED_AGENT_MARKER = '# Granada Codex agent:';
const SKIP_NAMES = new Set(['.DS_Store', '.omc']);
const AGENT_ROLE_NAMES = new Set(
  readdirSync(join(root, 'agents'))
    .filter(name => name.endsWith('.md'))
    .map(name => basename(name, '.md')),
);

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeText(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function stripQuotes(value) {
  const trimmed = String(value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(contents, fallbackName) {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      body: contents.trimStart(),
      name: fallbackName,
      description: fallbackName,
      artifactsDirs: null,
      disallowedTools: null,
    };
  }

  const metadata = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const scalar = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (scalar) metadata.set(scalar[1], scalar[2]);
  }

  return {
    body: contents.slice(match[0].length).trimStart(),
    name: stripQuotes(metadata.get('name')) || fallbackName,
    description: stripQuotes(metadata.get('description')) || fallbackName,
    artifactsDirs: metadata.get('artifacts-dirs')?.trim() || null,
    model: stripQuotes(metadata.get('model')) || null,
    level: Number.parseInt(stripQuotes(metadata.get('level')) || '0', 10) || 0,
    disallowedTools: stripQuotes(metadata.get('disallowedTools')) || null,
  };
}

function reasoningForModel(model, level = 0) {
  if (model === 'opus') return level >= 3 ? 'xhigh' : 'high';
  if (model === 'haiku') return 'low';
  return 'medium';
}

function codexSkillMention(name) {
  return `$${PLUGIN_NAMESPACE}:${name.replace(/^zaku:/, '')}`;
}

function adaptMarkdown(contents) {
  return contents
    .replace(/mcp__plugin_zaku_sourcepilot__/g, 'mcp__sourcepilot__')
    .replace(/mcp__plugin_zaku_atlassian__/g, 'mcp__atlassian__')
    .replace(/mcp__plugin_zaku_gitlab__/g, 'mcp__gitlab__')
    .replace(/(?<![A-Za-z0-9_])(jira_(?:get_issue|add_comment|download_attachments))\b/g, 'mcp__atlassian__$1')
    .replace(/JIRA_URL, JIRA_USERNAME, and JIRA_API_TOKEN/g, 'JIRA_URL and JIRA_PERSONAL_TOKEN')
    .replace(/JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN/g, 'JIRA_URL and JIRA_PERSONAL_TOKEN')
    .replace(/\/zaku:([a-z0-9-]+)/g, (_match, name) => codexSkillMention(name))
    .replace(/Skill\("((?:zaku:)?[a-z0-9-]+)"(?:,\s*("[^"]*"|'[^']*'))?\)/g, (_match, name, skillArgs) => `${codexSkillMention(name)}${skillArgs ? ` ${skillArgs}` : ''}`)
    .replace(/\bSkill\(\)/g, 'skill invocation')
    .replace(/\bAgent\(/g, 'delegate(')
    .replace(/\bTask\(/g, 'delegate(')
    .replace(/subagent_type="oh-my-claudecode:architect"/g, 'role="aosp-architect"')
    .replace(/subagent_type="(?:zaku:)?([^"]+)"/g, 'role="$1"')
    .replace(/\bmodel="opus"/g, 'reasoning="xhigh"')
    .replace(/\bmodel="sonnet"/g, 'reasoning="medium"')
    .replace(/\bmodel="haiku"/g, 'reasoning="low"')
    .replace(/\bprompt=/g, 'message=')
    .replace(/AskUserQuestion/g, 'request_user_input')
    .replace(/TodoWrite/g, 'update_plan')
    .replace(/ToolSearch/g, 'MCP tool discovery')
    .replace(/WebSearch/g, 'available web search tooling')
    .replace(/WebFetch/g, 'available web browsing tooling')
    .replace(/\{\{ARGUMENTS\}\}/g, '<skill-arguments>')
    .replace(/(?<![$/])\bzaku:([a-z0-9-]+)\b/g, (match, name) => (
      AGENT_ROLE_NAMES.has(name) ? name : match
    ))
    .replace(/oh-my-claudecode:architect/g, 'aosp-architect')
    .replace(/Claude Task agent/g, 'Codex subagent')
    .replace(/Claude Code/g, 'Codex');
}

function adaptAgentMarkdown(contents) {
  return adaptMarkdown(contents)
    .replace(
      '**Note to Orchestrators**: Use the Worker Preamble Protocol (`wrapWithPreamble()` from `src/agents/preamble.ts`) to ensure this agent executes tasks directly without spawning sub-agents.',
      '**Note to Orchestrators**: Give this role a concrete, bounded implementation task. It must not delegate write-capable implementation work to another agent.',
    )
    .replace(/\.omc\/plans/g, '.granada/plans')
    .replace(
      '- Append learnings to notepad files (.omc/notepads/{plan-name}/) after completing work.',
      '- Do not create extra state or notepad files unless the caller explicitly requests them.',
    )
    .replace(/LSP tools \([^)]*\)/g, 'available language-service or compiler diagnostics')
    .replace(/lsp_diagnostics_directory/g, 'the project-wide typecheck or diagnostics command')
    .replace(/lsp_diagnostics/g, 'the available file diagnostics or typecheck')
    .replace(/ast_grep_search/g, 'available structural search tooling')
    .replace(/ast_grep_replace/g, 'available structural replacement tooling')
    .replace(/the project-wide typecheck or diagnostics command clean/g, 'Project-wide typecheck or diagnostics pass')
    .replace(/\ba update_plan\b/g, 'an update_plan')
    .replace(
      /available structural replacement tooling for structural transformations \(always dryRun=true first\)/g,
      'apply_patch or another available structural replacement tool; preview the change first when the tool supports a dry-run mode',
    )
    .replace(/\bexplore agent \(model=haiku\)/g, 'explorer subagent')
    .replace(/\bexplore agents?\b/g, match => (match.endsWith('s') ? 'explorer subagents' : 'explorer subagent'))
    .replace(/\barchitect agent\b/g, 'aosp-architect role')
    .replace(
      'Use `/team` to spin up a CLI worker for large-context analysis tasks',
      'Use native Codex collaboration tools for an additional bounded large-context analysis task',
    )
    .replace(/document decisions in remember tags/g, 'document key decisions in the final response or a caller-provided artifact')
    .replace(/inside `\/plan --consensus` \(ralplan\)/g, 'inside `$zaku:aosp-plan` consensus mode')
    .replace(/\bralplan\b/g, 'consensus planning');
}

function codexSkillFrontmatter(name, description, artifactsDirs) {
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
  ];
  if (artifactsDirs) lines.push(`artifacts-dirs: ${artifactsDirs}`);
  lines.push('---', '');
  return lines.join('\n');
}

function adaptSkill(contents, skillName) {
  const parsed = parseFrontmatter(contents, skillName);
  const compatibility = [
    '## Codex runtime contract',
    '',
    'Before executing this workflow, read `../../references/codex-compat.md` completely.',
    'The `delegate(...)` blocks below are declarative workflow notation; translate them to the native Codex collaboration tools described in that reference.',
    '',
  ].join('\n');
  return `${codexSkillFrontmatter(skillName, parsed.description, parsed.artifactsDirs)}${compatibility}${adaptMarkdown(parsed.body)}`;
}

function shouldSkip(path, name) {
  return SKIP_NAMES.has(name) || name.endsWith('_zh.md') || path.includes(`${join('skills', 'aosp-feature-export', '.omc')}`);
}

function copyTree(source, target, transformMarkdown = false) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    ensureDir(target);
    for (const name of readdirSync(source).sort()) {
      const child = join(source, name);
      if (shouldSkip(child, name)) continue;
      copyTree(child, join(target, name), transformMarkdown);
    }
    return;
  }

  ensureDir(dirname(target));
  if (transformMarkdown && source.endsWith('.md')) {
    writeText(target, adaptMarkdown(readFileSync(source, 'utf8')));
  } else {
    cpSync(source, target);
  }
}

function buildSkills(stagePluginRoot) {
  const sourceSkills = join(root, 'skills');
  const targetSkills = join(stagePluginRoot, 'skills');
  ensureDir(targetSkills);

  for (const skillName of readdirSync(sourceSkills).sort()) {
    if (skillName.startsWith('_') || skillName.startsWith('.')) continue;
    const sourceSkillRoot = join(sourceSkills, skillName);
    if (!lstatSync(sourceSkillRoot).isDirectory()) continue;
    const sourceSkill = join(sourceSkillRoot, 'SKILL.md');
    if (!existsSync(sourceSkill)) continue;

    const targetSkillRoot = join(targetSkills, skillName);
    copyTree(sourceSkillRoot, targetSkillRoot, true);
    writeText(join(targetSkillRoot, 'SKILL.md'), adaptSkill(readFileSync(sourceSkill, 'utf8'), skillName));
  }

  const diagramSource = readFileSync(join(root, 'output-styles', 'diagrams-first.md'), 'utf8');
  const diagram = parseFrontmatter(diagramSource, 'diagrams-first');
  writeText(
    join(targetSkills, 'diagrams-first', 'SKILL.md'),
    `${codexSkillFrontmatter('diagrams-first', diagram.description, null)}${adaptMarkdown(diagram.body)}`,
  );
}

function buildAgentMarkdown(sourcePath) {
  const roleName = basename(sourcePath, '.md');
  const parsed = parseFrontmatter(readFileSync(sourcePath, 'utf8'), roleName);
  const readOnly = parsed.disallowedTools
    ?.split(',')
    .map(tool => tool.trim())
    .some(tool => tool === 'Write' || tool === 'Edit') ?? false;
  const overlay = [
    '<codex_runtime>',
    'Use Codex-native filesystem, terminal, planning, and collaboration tools.',
    'Map Read to filesystem reads, Write/Edit to apply_patch, Bash to the terminal, and Grep/Glob to rg/rg --files.',
    'Treat delegate(...) as declarative notation and follow the available spawn_agent/agent_type surface.',
    'Use mcp__sourcepilot__* for SourcePilot, mcp__atlassian__* for JIRA/Confluence, and mcp__gitlab__* for GitLab.',
    ...(readOnly ? ['This role is read-only. Do not modify files, repository state, or external systems.'] : []),
    'When a named tool is unavailable, report the missing capability instead of inventing a tool call.',
    '</codex_runtime>',
    '',
  ].join('\n');
  return {
    name: roleName,
    description: parsed.description,
    reasoning: reasoningForModel(parsed.model, parsed.level),
    sandbox: readOnly ? 'read-only' : null,
    body: `${overlay}${adaptAgentMarkdown(parsed.body)}`,
  };
}

function buildAgents(stagePluginRoot, stageAgentsRoot) {
  const pluginAgentsRoot = join(stagePluginRoot, 'agents');
  ensureDir(pluginAgentsRoot);
  ensureDir(stageAgentsRoot);

  for (const fileName of readdirSync(join(root, 'agents')).filter(name => name.endsWith('.md')).sort()) {
    const agent = buildAgentMarkdown(join(root, 'agents', fileName));
    writeText(
      join(pluginAgentsRoot, `${agent.name}.md`),
      `---\nname: ${agent.name}\ndescription: ${JSON.stringify(agent.description)}\n---\n\n${agent.body}`,
    );
    writeText(
      join(stageAgentsRoot, `${agent.name}.toml`),
      [
        `${GENERATED_AGENT_MARKER} ${agent.name}`,
        `name = ${JSON.stringify(agent.name)}`,
        `description = ${JSON.stringify(agent.description)}`,
        `model_reasoning_effort = "${agent.reasoning}"`,
        ...(agent.sandbox ? [`sandbox_mode = "${agent.sandbox}"`] : []),
        `developer_instructions = ${JSON.stringify(agent.body)}`,
        '',
      ].join('\n'),
    );
  }
}

function buildPlugin(stagePluginRoot, stageAgentsRoot) {
  writeJson(join(stagePluginRoot, 'package.json'), {
    name: '@zeonic/zaku-codex-plugin',
    version: packageJson.version,
    private: true,
    type: 'module',
  });

  writeJson(join(stagePluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'zaku',
    version: packageJson.version,
    description: packageJson.description,
    author: {
      name: 'INNERJOINT',
      url: 'https://github.com/INNERJOINT',
    },
    homepage: 'https://github.com/INNERJOINT/Granada',
    repository: 'https://github.com/INNERJOINT/Granada.git',
    license: 'MIT',
    keywords: ['aosp', 'android', 'jira', 'git', 'sourcepilot', 'codex'],
    skills: './skills/',
    mcpServers: './.mcp.json',
    interface: {
      displayName: 'Zaku for Codex',
      shortDescription: 'AOSP analysis, Android RCA, planning, and Git workflows.',
      longDescription: 'Granada brings its Zaku Android platform workflows to Codex with native skills, MCP servers, lifecycle hooks, and project-scoped specialist agents.',
      developerName: 'INNERJOINT',
      category: 'Developer Tools',
      capabilities: ['AOSP source search', 'Android root-cause analysis', 'Multi-agent planning', 'Git workflows'],
      websiteURL: 'https://github.com/INNERJOINT/Granada',
      defaultPrompt: [
        'Analyze this Android issue with AOSP evidence.',
        'Create a reviewed AOSP implementation plan.',
        'Summarize the staged changes as a commit message.',
      ],
      brandColor: '#5B7F3A',
    },
  });

  writeJson(join(stagePluginRoot, '.mcp.json'), {
    mcpServers: {
      sourcepilot: {
        type: 'stdio',
        command: 'node',
        args: ['./bridge/mcp-server.cjs'],
        cwd: '.',
        env_vars: ['SOURCEPILOT_URL', 'SOURCEPILOT_KEY'],
        required: false,
        supports_parallel_tool_calls: true,
      },
      atlassian: {
        type: 'stdio',
        command: 'uvx',
        args: ['mcp-atlassian'],
        env_vars: [
          'JIRA_URL',
          'JIRA_PERSONAL_TOKEN',
          'CONFLUENCE_URL',
          'CONFLUENCE_PERSONAL_TOKEN',
        ],
        required: false,
      },
      gitlab: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@zereight/mcp-gitlab'],
        env_vars: ['GITLAB_PERSONAL_ACCESS_TOKEN', 'GITLAB_API_URL'],
        required: false,
      },
    },
  });

  writeJson(join(stagePluginRoot, 'hooks', 'hooks.json'), {
    description: 'Granada artifact lifecycle hooks for Codex',
    hooks: {
      PostToolUse: [
        {
          matcher: 'apply_patch|Write|Edit',
          hooks: [
            {
              type: 'command',
              command: 'node "${PLUGIN_ROOT}/scripts/hooks/adapters/codex-entry.cjs" enqueue-artifact',
              commandWindows: 'node "%PLUGIN_ROOT%\\scripts\\hooks\\adapters\\codex-entry.cjs" enqueue-artifact',
              timeout: 360,
              statusMessage: 'Tracking Granada artifacts',
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node "${PLUGIN_ROOT}/scripts/hooks/adapters/codex-entry.cjs" drain-artifacts',
              commandWindows: 'node "%PLUGIN_ROOT%\\scripts\\hooks\\adapters\\codex-entry.cjs" drain-artifacts',
              timeout: 360,
              statusMessage: 'Finalizing Granada artifacts',
            },
          ],
        },
      ],
    },
  });

  writeText(join(stagePluginRoot, 'references', 'codex-compat.md'), readFileSync(join(root, 'references', 'codex-compat.md'), 'utf8'));
  writeText(
    join(stagePluginRoot, 'references', 'rca-pipeline.md'),
    adaptMarkdown(readFileSync(join(root, 'skills', '_shared', 'rca-pipeline.md'), 'utf8')),
  );
  copyTree(join(root, 'bridge'), join(stagePluginRoot, 'bridge'));
  copyTree(join(root, 'dist'), join(stagePluginRoot, 'dist'));
  copyTree(join(root, 'scripts', 'hooks'), join(stagePluginRoot, 'scripts', 'hooks'));
  copyTree(join(root, 'assets'), join(stagePluginRoot, 'assets'));
  cpSync(join(root, 'LICENSE'), join(stagePluginRoot, 'LICENSE'));
  buildSkills(stagePluginRoot);
  buildAgents(stagePluginRoot, stageAgentsRoot);
  writeText(
    join(stagePluginRoot, 'README.md'),
    '# Zaku Codex plugin\n\nGenerated from the Granada repository SSOT. Edit the root `skills/`, `agents/`, hooks, bridge, or assets and run `npm run sync:codex`; do not hand-edit this directory.\n',
  );
}

function listFiles(rootPath) {
  if (!existsSync(rootPath)) return [];
  const files = [];
  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      if (name === '.DS_Store') continue;
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(relative(rootPath, path));
    }
  }
  walk(rootPath);
  return files;
}

function compareTrees(expectedRoot, actualRoot, label, filter = () => true) {
  const expectedFiles = listFiles(expectedRoot).filter(filter);
  const actualFiles = listFiles(actualRoot).filter(filter);
  const problems = [];
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    problems.push(`${label} file list differs`);
  }
  for (const file of expectedFiles) {
    const actual = join(actualRoot, file);
    if (!existsSync(actual)) continue;
    const expectedBytes = readFileSync(join(expectedRoot, file));
    const actualBytes = readFileSync(actual);
    if (!expectedBytes.equals(actualBytes)) problems.push(`${label}/${file} is stale`);
  }
  return problems;
}

function isGranadaAgent(relativePath, rootPath) {
  if (!relativePath.endsWith('.toml')) return false;
  const path = join(rootPath, relativePath);
  return existsSync(path) && readFileSync(path, 'utf8').startsWith(GENERATED_AGENT_MARKER);
}

function installGeneratedAgents(stageAgentsRoot) {
  ensureDir(codexAgentsRoot);
  const stagedNames = readdirSync(stageAgentsRoot);
  for (const name of stagedNames) {
    const target = join(codexAgentsRoot, name);
    if (!existsSync(target)) continue;
    const stat = lstatSync(target);
    const generated = stat.isFile()
      && readFileSync(target, 'utf8').startsWith(GENERATED_AGENT_MARKER);
    if (!generated) {
      throw new Error(`Refusing to overwrite user-owned Codex agent: ${target}`);
    }
  }

  for (const name of readdirSync(codexAgentsRoot)) {
    const path = join(codexAgentsRoot, name);
    if (!lstatSync(path).isFile()) continue;
    if (readFileSync(path, 'utf8').startsWith(GENERATED_AGENT_MARKER)) rmSync(path);
  }
  for (const name of stagedNames) {
    cpSync(join(stageAgentsRoot, name), join(codexAgentsRoot, name));
  }
}

const stageRoot = mkdtempSync(join(tmpdir(), 'granada-codex-sync-'));
const stagePluginRoot = join(stageRoot, 'plugin');
const stageAgentsRoot = join(stageRoot, 'agents');
buildPlugin(stagePluginRoot, stageAgentsRoot);

try {
  if (checkOnly) {
    const problems = compareTrees(stagePluginRoot, pluginRoot, 'plugins/zaku');
    if (!pluginOnly) {
      const expectedAgentFiles = listFiles(stageAgentsRoot);
      const actualAgentFiles = listFiles(codexAgentsRoot).filter(path => isGranadaAgent(path, codexAgentsRoot));
      if (JSON.stringify(expectedAgentFiles) !== JSON.stringify(actualAgentFiles)) {
        problems.push('.codex/agents generated file list differs');
      }
      for (const file of expectedAgentFiles) {
        const actualPath = join(codexAgentsRoot, file);
        if (!existsSync(actualPath)) continue;
        if (!readFileSync(join(stageAgentsRoot, file)).equals(readFileSync(actualPath))) {
          problems.push(`.codex/agents/${file} is stale`);
        }
      }
    }
    if (problems.length > 0) {
      throw new Error(`Codex generated surfaces are stale:\n- ${problems.join('\n- ')}`);
    }
    console.log('Codex plugin and agent surfaces are in sync.');
  } else {
    rmSync(pluginRoot, { recursive: true, force: true });
    cpSync(stagePluginRoot, pluginRoot, { recursive: true });
    if (!pluginOnly) installGeneratedAgents(stageAgentsRoot);
    console.log(`Synced Codex plugin: ${pluginRoot}`);
    if (!pluginOnly) console.log(`Synced Codex agents: ${codexAgentsRoot}`);
  }
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}
