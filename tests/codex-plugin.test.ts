import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const pluginRoot = join(root, 'plugins', 'zaku');

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listSkillFiles(): string[] {
  const skillsRoot = join(pluginRoot, 'skills');
  return readdirSync(skillsRoot)
    .sort()
    .map(name => join(skillsRoot, name, 'SKILL.md'))
    .filter(path => existsSync(path));
}

function shellBlocks(markdown: string): string {
  return [...markdown.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g)]
    .filter(match => ['', 'bash', 'sh', 'shell', 'console'].includes(match[1].trim().toLowerCase()))
    .map(match => match[2])
    .join('\n')
    .replace(/\\\r?\n\s*/g, ' ');
}

function jiraToolTokens(markdown: string): string[] {
  return [...markdown.matchAll(/\bmcp__[A-Za-z0-9_]+__jira_(?:get_issue|download_attachments)\b/g)]
    .map(match => match[0]);
}

function nativeAgentInstructions(name: string): string {
  const contents = readFileSync(join(root, '.codex', 'agents', `${name}.toml`), 'utf8');
  const serialized = contents.match(/^developer_instructions = (.+)$/m)?.[1];
  expect(serialized).toBeTruthy();
  return JSON.parse(serialized!);
}

function exchangeWithBridge(messages: unknown[]): Promise<any[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(pluginRoot, 'bridge', 'mcp-server.cjs')], {
      cwd: pluginRoot,
      env: { ...process.env, SOURCEPILOT_URL: '', SOURCEPILOT_KEY: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses: any[] = [];
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`bridge timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      while (true) {
        const newline = stdout.indexOf('\n');
        if (newline < 0) break;
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        if (!line.trim()) continue;
        responses.push(JSON.parse(line));
        if (responses.length === messages.length) {
          clearTimeout(timer);
          child.kill('SIGTERM');
          resolvePromise(responses);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

describe('Codex plugin bundle', () => {
  it('uses a lightweight marketplace source and complete Codex metadata', () => {
    const marketplace = readJson(join(root, '.agents', 'plugins', 'marketplace.json'));
    const entry = marketplace.plugins.find((candidate: any) => candidate.name === 'zaku');
    expect(marketplace.name).toBe('zeonic-local');
    expect(entry.source).toEqual({ source: 'local', path: './plugins/zaku' });
    expect(entry.policy).toEqual({ installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
    expect(entry.category).toBe('Developer Tools');

    const manifest = readJson(join(pluginRoot, '.codex-plugin', 'plugin.json'));
    const pkg = readJson(join(root, 'package.json'));
    expect(manifest.name).toBe('zaku');
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.mcpServers).toBe('./.mcp.json');
    expect(manifest).not.toHaveProperty('agents');
    expect(manifest).not.toHaveProperty('hooks');
    expect(manifest.interface.displayName).toBe('Zaku for Codex');
    expect(readJson(join(pluginRoot, 'package.json')).type).toBe('module');
  });

  it('uses Codex-native MCP environment inheritance and hook commands', () => {
    const mcp = readJson(join(pluginRoot, '.mcp.json')).mcpServers;
    expect(mcp.sourcepilot).toMatchObject({
      command: 'node',
      args: ['./bridge/mcp-server.cjs'],
      cwd: '.',
      env_vars: ['SOURCEPILOT_URL', 'SOURCEPILOT_KEY'],
    });
    expect(JSON.stringify(mcp)).not.toContain('${');

    const hooks = readJson(join(pluginRoot, 'hooks', 'hooks.json')).hooks;
    const post = hooks.PostToolUse[0];
    const postCommand = post.hooks[0];
    const stopCommand = hooks.Stop[0].hooks[0];
    expect(post.matcher).toBe('apply_patch|Write|Edit');
    expect(postCommand.command).toContain('${PLUGIN_ROOT}/scripts/hooks/adapters/codex-entry.cjs');
    expect(stopCommand.command).toContain('${PLUGIN_ROOT}/scripts/hooks/adapters/codex-entry.cjs');
    expect(postCommand).not.toHaveProperty('args');
    expect(postCommand).not.toHaveProperty('if');
  });

  it('generates Codex skill frontmatter and removes unmapped Claude syntax', () => {
    const forbidden = [
      '/zaku:',
      'Agent(',
      'Task(',
      'Skill(',
      'AskUserQuestion',
      'ToolSearch',
      'WebSearch',
      'WebFetch',
      '{{ARGUMENTS}}',
      'mcp__plugin_zaku_sourcepilot__',
    ];

    const skillFiles = listSkillFiles();
    expect(skillFiles.length).toBeGreaterThanOrEqual(12);
    for (const path of skillFiles) {
      const contents = readFileSync(path, 'utf8');
      expect(contents).toMatch(/^---\nname: [a-z0-9-]+\ndescription: /);
      for (const token of forbidden) expect(contents, `${path} contains ${token}`).not.toContain(token);
    }
    expect(readFileSync(join(pluginRoot, 'skills', 'aosp-plan', 'SKILL.md'), 'utf8'))
      .toContain('$zaku:aosp-autopilot');
    expect(readFileSync(join(pluginRoot, 'skills', 'aosp-autopilot', 'SKILL.md'), 'utf8'))
      .toContain('$zaku:git-commit');
    const generatedText = skillFiles.map(path => readFileSync(path, 'utf8')).join('\n');
    for (const skillName of readdirSync(join(pluginRoot, 'skills'))) {
      expect(generatedText, `unqualified plugin skill mention: $${skillName}`)
        .not.toMatch(new RegExp(`\\$(?!zaku:)${skillName}\\b`));
    }
    expect(existsSync(join(pluginRoot, 'skills', '_shared'))).toBe(false);
    expect(existsSync(join(pluginRoot, 'skills', 'diagrams-first', 'SKILL.md'))).toBe(true);
    expect(generatedText).toContain('mcp__atlassian__jira_get_issue');
    expect(generatedText).toContain('mcp__atlassian__jira_add_comment');
    expect(generatedText).not.toMatch(/(?<![A-Za-z0-9_])jira_(?:get_issue|add_comment|download_attachments)\b/);
    expect(generatedText).not.toContain('JIRA_USERNAME');
    expect(generatedText).not.toContain('JIRA_API_TOKEN');
  });

  it('generates project-scoped native agent roles with developer instructions', () => {
    const agentDir = join(root, '.codex', 'agents');
    const files = readdirSync(agentDir).filter(name => name.endsWith('.toml')).sort();
    expect(files).toContain('aosp-investigator.toml');
    expect(files).toContain('executor.toml');
    for (const file of files) {
      const contents = readFileSync(join(agentDir, file), 'utf8');
      if (!contents.startsWith('# Granada Codex agent:')) continue;
      expect(contents).toContain('description = ');
      expect(contents).toContain('model_reasoning_effort = ');
      const instructions = contents.match(/^developer_instructions = (.+)$/m)?.[1];
      expect(instructions).toBeTruthy();
      expect(() => JSON.parse(instructions!)).not.toThrow();
      expect(contents).not.toContain('mcp__plugin_zaku_sourcepilot__');
      expect(contents).not.toContain('role="zaku:');
    }
    expect(readFileSync(join(agentDir, 'aosp-architect.toml'), 'utf8'))
      .toContain('sandbox_mode = "read-only"');
    expect(readFileSync(join(agentDir, 'aosp-critic.toml'), 'utf8'))
      .toContain('sandbox_mode = "read-only"');
    expect(readFileSync(join(agentDir, 'executor.toml'), 'utf8'))
      .not.toContain('sandbox_mode = "read-only"');

    const generatedAgents = readdirSync(join(pluginRoot, 'agents'))
      .filter(name => name.endsWith('.md'))
      .map(name => readFileSync(join(pluginRoot, 'agents', name), 'utf8'))
      .join('\n');
    for (const token of [
      '.omc/',
      '/team',
      'wrapWithPreamble',
      'lsp_diagnostics',
      'ast_grep',
      'model=haiku',
      'remember tags',
      '`/plan --consensus`',
    ]) {
      expect(generatedAgents, `generated agent prompts contain ${token}`).not.toContain(token);
    }
    expect(generatedAgents).toContain('mcp__atlassian__jira_download_attachments');
    expect(generatedAgents).not.toMatch(/(?<![A-Za-z0-9_])jira_(?:get_issue|add_comment|download_attachments)\b/);
  });

  it('maps collector JIRA tools to each host namespace', () => {
    const canonical = readFileSync(join(root, 'agents', 'aosp-log-collector.md'), 'utf8');
    const generated = readFileSync(join(pluginRoot, 'agents', 'aosp-log-collector.md'), 'utf8');
    const native = nativeAgentInstructions('aosp-log-collector');
    const claudeTools = new Set([
      'mcp__plugin_zaku_atlassian__jira_get_issue',
      'mcp__plugin_zaku_atlassian__jira_download_attachments',
    ]);
    const codexTools = new Set([
      'mcp__atlassian__jira_get_issue',
      'mcp__atlassian__jira_download_attachments',
    ]);

    const canonicalTokens = jiraToolTokens(canonical);
    expect(canonicalTokens.length).toBeGreaterThan(0);
    expect(canonicalTokens.every(token => claudeTools.has(token))).toBe(true);
    expect(canonical).toContain('Call `mcp__plugin_zaku_atlassian__jira_get_issue(issue_key=<KEY>, comment_limit=0)`');
    expect(canonical).toContain('Call `mcp__plugin_zaku_atlassian__jira_download_attachments(issue_key=<KEY>)`');
    expect(canonical).not.toContain('mcp__atlassian__');

    for (const surface of [generated, native]) {
      const tokens = jiraToolTokens(surface);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every(token => codexTools.has(token))).toBe(true);
      expect(surface).toContain('mcp__atlassian__jira_get_issue(issue_key=<KEY>, comment_limit=0)');
      expect(surface).toContain('mcp__atlassian__jira_download_attachments(issue_key=<KEY>)');
      expect(surface).not.toContain('mcp__plugin_zaku_atlassian__');
    }

    for (const surface of [canonical, generated, native]) {
      expect(surface).not.toMatch(/(?<![A-Za-z0-9_])jira_(?:get_issue|download_attachments)\b/);
    }
  });

  it('uses only documented log-unboxer commands for supported attachments', () => {
    const surfaces = [
      readFileSync(join(root, 'agents', 'aosp-log-collector.md'), 'utf8'),
      readFileSync(join(pluginRoot, 'agents', 'aosp-log-collector.md'), 'utf8'),
      nativeAgentInstructions('aosp-log-collector'),
    ];
    const downloadCommand = /log-unboxer download "\$serial_number"\s+--output-dir "\$extracted_dir"\s+--days 90\s+--workers 4/;

    for (const surface of surfaces) {
      const commands = shellBlocks(surface);
      expect(commands.match(/\blog-unboxer --version\b/g) ?? []).toHaveLength(1);
      expect(commands.match(/\blog-unboxer unpack\b/g) ?? []).toHaveLength(1);
      expect(commands.match(/\blog-unboxer download\b/g) ?? []).toHaveLength(1);
      expect(commands).toContain('log-unboxer unpack "$archive_path" --output-dir "$extracted_dir"');
      expect(commands).toMatch(downloadCommand);
      expect(commands).toContain('base64 -d < "$b64_path" > "$archive_path"');
      expect(commands).toContain('base64 -d < "$b64_path" > "$decoded_path"');
      expect(commands).not.toMatch(/(^|\s)--sn(?:\s|$)/);
      expect(commands).not.toMatch(/(^|\s)--(?:url|limit)(?:\s|$)/);
      expect(commands).not.toMatch(/\b(?:unzip|tar|7z)\b/);
      expect(commands).not.toMatch(/log-unboxer\s+unpack\b[^;\n]*(?:zip_path|\.zip)/);

      expect(surface).toContain('**Supported archive**: `.tgz` or `.tar.gz`');
      expect(surface).toContain('**Supported direct log**: `.txt` or `.log`');
      expect(surface).toContain('**Unsupported**: `.zip`');
      expect(surface).toContain('validated, case-insensitive filename suffix');
      expect(surface).toContain('Direct logs do not require `log-unboxer`');
      expect(surface).toContain('^[A-Za-z0-9][A-Za-z0-9._-]*$');
    }
  });

  it('preserves collector fallback, partial-output, and manifest semantics', () => {
    const surfaces = [
      readFileSync(join(root, 'agents', 'aosp-log-collector.md'), 'utf8'),
      readFileSync(join(pluginRoot, 'agents', 'aosp-log-collector.md'), 'utf8'),
      nativeAgentInstructions('aosp-log-collector'),
    ];
    const parser = readFileSync(join(root, 'agents', 'aosp-log-parser.md'), 'utf8');
    const reasons = [
      'LOG_UNBOXER_UNAVAILABLE',
      'ATTACHMENT_METADATA_FAILED',
      'ATTACHMENT_SIZE_UNSAFE',
      'MCP_DOWNLOAD_FAILED',
      'BASE64_DECODE_FAILED',
      'ARCHIVE_UNPACK_FAILED',
      'ARCHIVE_UNPACK_EMPTY',
      'SN_DOWNLOAD_FAILED',
      'SN_DOWNLOAD_EMPTY',
    ];
    const manifestTypes = 'logcat|tombstone|anr|kernel|other';

    for (const surface of surfaces) {
      expect(surface.indexOf('### Step J4: Evaluate Attachment Results'))
        .toBeLessThan(surface.indexOf('### Step J5: One-Time SN Fallback Download'));
      expect(surface).toContain('Do not run SN fallback.');
      expect(surface).toContain('only when Steps J2-J4 yielded no parseable log files');
      expect(surface).toContain('Run this step at most once');
      expect(surface).toContain('Inspect `<extracted_dir>` after the command even when `download_status` is non-zero');
      expect(surface).toContain('Parseable files plus non-zero exit');
      expect(surface).toContain('report `PARTIAL`');
      expect(surface).toContain('A non-zero `log-unboxer` exit does not by itself prove collection failed');
      expect(surface).toContain('Direct `.txt` / `.log` attachments remain usable even when `log-unboxer` is unavailable');
      for (const reason of reasons) expect(surface).toContain(reason);
      expect(surface).toContain(`flat JSON object mapping relative filenames to \`${manifestTypes}\``);
    }

    expect(parser).toContain(`{"filename": "${manifestTypes}", ...}`);
  });

  it('loads the Codex hook bootstrap from an isolated plugin cache copy', () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), 'granada-codex-cache-'));
    const cachedPlugin = join(cacheRoot, 'zaku');
    cpSync(pluginRoot, cachedPlugin, { recursive: true });

    const run = spawnSync(
      process.execPath,
      [join(cachedPlugin, 'scripts', 'hooks', 'adapters', 'codex-entry.cjs'), 'enqueue-artifact'],
      {
        cwd: cachedPlugin,
        env: { ...process.env },
        input: '{}\n',
        encoding: 'utf8',
        timeout: 5000,
      },
    );

    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('');
  });

  it('starts the standalone bridge without node_modules and exposes individual tools', async () => {
    const [initialized, listed] = await exchangeWithBridge([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    expect(initialized.result.serverInfo.name).toBe('zaku-sourcepilot');
    const toolNames = listed.result.tools.map((tool: any) => tool.name);
    expect(toolNames).toContain('list_projects');
    expect(toolNames).toContain('search_code');
    expect(toolNames).toContain('get_file_content');
    expect(readFileSync(join(pluginRoot, 'bridge', 'mcp-server.cjs'), 'utf8')).not.toContain('@modelcontextprotocol/sdk');
  });
});
