import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

function agentSurfaces(name: string): string[] {
  return [
    readFileSync(join(root, 'agents', `${name}.md`), 'utf8'),
    readFileSync(join(pluginRoot, 'agents', `${name}.md`), 'utf8'),
    nativeAgentInstructions(name),
  ];
}

function skillSurfaces(name: string): string[] {
  return [
    readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8'),
    readFileSync(join(pluginRoot, 'skills', name, 'SKILL.md'), 'utf8'),
  ];
}

function sectionBetween(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}

function expectOrdered(text: string, tokens: string[]): void {
  let previous = -1;
  for (const token of tokens) {
    const index = text.indexOf(token, previous + 1);
    expect(index, `missing or out-of-order token: ${token}`).toBeGreaterThan(previous);
    previous = index;
  }
}

function handoffValidatorSource(markdown: string): string {
  const collection = sectionBetween(markdown, '## Phase 2: JIRA Data Collection', '## Phase 3: Log Parsing');
  const match = collection.match(/TEMP_DIR="\$temp_dir" node <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/);
  expect(match, 'missing deterministic handoff validator').toBeTruthy();
  return match![1];
}

function stageValidatorSource(markdown: string): string {
  const staging = sectionBetween(markdown, '## Private Staging, Sandbox, and No-Follow Merge', '## JIRA Mode');
  const match = staging.match(/node <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/);
  expect(match, 'missing deterministic stage validator').toBeTruthy();
  return match![1];
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
    const surfaces = agentSurfaces('aosp-log-collector');
    const downloadCommand = /"\$log_unboxer_bin" download "\$serial_number"\s+--output-dir "\$stage_output"\s+--days 90\s+--workers 4/;

    for (const surface of surfaces) {
      const commands = shellBlocks(surface);
      expect(commands.match(/"\$log_unboxer_bin" --version\b/g) ?? []).toHaveLength(1);
      expect(commands.match(/"\$log_unboxer_bin" unpack\b/g) ?? []).toHaveLength(1);
      expect(commands.match(/"\$log_unboxer_bin" download\b/g) ?? []).toHaveLength(1);
      expect(commands).not.toMatch(/(?:^|\n)\s*log-unboxer\s+(?:--version|unpack|download)\b/);
      expect(commands).toContain('"$log_unboxer_bin" unpack "$archive_path" --output-dir "$stage_output"');
      expect(commands).toContain('archive_control=$(mktemp -d "${temp_dir%/}/archive-control-${archive_index}.XXXXXX")');
      expect(commands).toContain('download_stderr="${download_control}/download.stderr"');
      expect(commands).toContain('CONTROL_ROOT="$temp_dir"');
      expect(commands).toContain('bwrap --die-with-parent --new-session');
      expect(commands).toContain('--unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup');
      expect(commands).toContain('--unshare-net');
      expect(commands).toContain('--clearenv');
      expect(commands).toContain('--ro-bind / /');
      expect(commands).toContain('--dev /dev');
      expect(commands).toContain('-- "$log_unboxer_python" -');
      expect(commands).not.toContain('--dev-bind /dev /dev');
      expect(commands).not.toContain('--share-net');
      expect(commands).toMatch(downloadCommand);
      expect(commands).toContain('base64 -d < "$b64_path" > "$archive_path"');
      expect(commands).toContain('base64 -d < "$b64_path" > "$decoded_path"');
      expect(commands).toContain('log_unboxer_bin=$(command -v log-unboxer)');
      expect(commands).toContain('hasattr(tarfile, "data_filter")');
      expect(commands).toContain('(3, 12): (3, 12, 11)');
      expect(commands).toContain('getattr(unpacker, "_EXTRACT_KW", None) != {"filter": "data"}');
      expect(commands).toContain('unsafe archive extraction canary failed');
      expect(commands).not.toMatch(/(^|\s)--sn(?:\s|$)/);
      expect(commands).not.toMatch(/(^|\s)--(?:url|limit)(?:\s|$)/);
      expect(commands).not.toMatch(/\b(?:unzip|tar|7z)\b/);
      expect(commands).not.toMatch(/log-unboxer\s+unpack\b[^;\n]*(?:zip_path|\.zip)/);
      expect(commands).not.toMatch(/\b(?:pipx|pip|uv|apt(?:-get)?|brew)\s+(?:install|uninstall|reinstall|upgrade)\b/);
      expect(commands).not.toMatch(/\bcurl\b[^\n|]*\|\s*(?:sh|bash)\b/);

      expect(surface).toContain('**Supported archive**: `.tgz` or `.tar.gz`');
      expect(surface).toContain('**Supported direct log**: `.txt` or `.log`');
      expect(surface).toContain('**Unsupported**: `.zip`');
      expect(surface).toContain('validated, case-insensitive filename suffix');
      expect(surface).toContain('Direct logs do not require `log-unboxer`');
      expect(surface).toContain('never install, uninstall, reinstall, or upgrade it from the collector');
      expect(surface).toContain('^[A-Za-z0-9][A-Za-z0-9._-]*$');
    }
  });

  it('preserves collector fallback, partial-output, and manifest semantics', () => {
    const surfaces = agentSurfaces('aosp-log-collector');
    const parser = readFileSync(join(root, 'agents', 'aosp-log-parser.md'), 'utf8');
    const reasons = [
      'ISSUE_METADATA_FAILED',
      'LOG_UNBOXER_UNAVAILABLE',
      'LOG_UNBOXER_UNSAFE_RUNTIME',
      'LOG_UNBOXER_SANDBOX_UNAVAILABLE',
      'ATTACHMENT_METADATA_FAILED',
      'ATTACHMENT_SIZE_UNSAFE',
      'MCP_DOWNLOAD_FAILED',
      'BASE64_DECODE_FAILED',
      'ARCHIVE_UNPACK_FAILED',
      'ARCHIVE_UNPACK_PARTIAL',
      'ARCHIVE_UNPACK_EMPTY',
      'ARCHIVE_STAGE_INVALID',
      'OUTPUT_COLLISION',
      'SN_NOT_FOUND_OR_INVALID',
      'SN_FALLBACK_BLOCKED',
      'SN_DOWNLOAD_PARTIAL',
      'SN_STAGE_INVALID',
      'SN_RESPONSE_IDENTITY_MISMATCH',
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
      expect(surface).toContain('Evaluate staged output even when `download_status` is non-zero');
      expect(surface).toContain('Parseable merged files plus non-zero exit');
      expect(surface).toContain('report `PARTIAL`');
      expect(surface).toContain('A non-zero `log-unboxer` exit does not by itself prove collection failed');
      expect(surface).toContain('Private Staging, Sandbox, and No-Follow Merge');
      expect(surface).toContain('LOG_UNBOXER_SANDBOX_UNAVAILABLE');
      expect(surface).toContain('Every archive/SN operation ran in its own private sandbox stage');
      expect(surface).toContain('Never give `log-unboxer` write access to `<extracted_dir>`');
      expect(surface).toContain('Every invocation that imports or executes `log_unboxer` must already be inside the offline sandbox');
      expect(surface).toContain('never bind the host `/dev` writable');
      expect(surface).toContain('control files in a separate private control directory');
      expect(surface).toContain('control file must remain outside writable stage');
      expect(surface).toContain('A filename-set comparison alone is forbidden');
      expect(surface).toContain('exactly one real top-level directory under `output/`, named exactly the validated requested `$serial_number`');
      expect(surface).toContain('Direct `.txt` / `.log` attachments remain usable even when `log-unboxer` is unavailable');
      expect(surface).toContain('Collection attempts');
      expect(surface).toContain('Failure codes observed');
      expect(surface).toContain('SN fallback: NOT_RUN | SUCCESS | PARTIAL | FAILED | BLOCKED');
      expect(surface).toContain('NOT_APPLICABLE (local mode)');
      expect(surface).toContain('SN fallback: NOT_RUN — SN_NOT_FOUND_OR_INVALID');
      expect(surface).toContain('A later successful SN fallback never erases an earlier sticky error');
      expect(surface).toContain('Do not probe the CLI in this branch');
      expect(surface).toContain('SN fallback: BLOCKED — <availability/safety/sandbox reason>');
      expect(surface).toContain('ARCHIVE_UNPACK_PARTIAL');
      expect(surface).toContain('SN_DOWNLOAD_PARTIAL');
      expect(surface).toContain('traceback, exception, or explicit per-file processing failure');
      expect(surface).toContain('Filter checks alone—including `hasattr(tarfile, "data_filter")`—are insufficient');
      expect(surface).toContain('3.12.11+');
      expect(surface).toContain('traversal/absolute/symlink/hardlink canaries');
      for (const reason of reasons) expect(surface).toContain(reason);
      expect(surface).toContain(`flat JSON object mapping relative filenames to \`${manifestTypes}\``);

      const issueMetadata = sectionBetween(surface, '### Step J1: Fetch Issue Details', '### Step J2: Inspect Attachment Metadata');
      expect(issueMetadata).toContain('Stop immediately');
      expect(issueMetadata).toContain('Do not call attachment metadata/download tools or `log-unboxer`');

      const fallback = sectionBetween(surface, '### Step J5: One-Time SN Fallback Download', '### Step J6: Report Issue Context');
      expectOrdered(fallback, [
        'If no valid SN exists',
        'Do not probe the CLI in this branch',
        'Only after a valid SN is available',
        'SN_FALLBACK_BLOCKED',
        '"$log_unboxer_bin" download "$serial_number"',
      ]);
    }

    expect(parser).toContain(`{"filename": "${manifestTypes}", ...}`);
  });

  it('rejects unsafe or inconsistent classification manifests before parsing', () => {
    for (const surface of agentSurfaces('aosp-log-parser')) {
      expect(surface).toContain('Workspace roots');
      expect(surface).toContain('Manifest file exists safely');
      expect(surface).toContain('Valid flat JSON object');
      expect(surface).toContain('Safe relative manifest keys');
      expect(surface).toContain('Unsafe classification manifest key: <key>');
      expect(surface).toContain('never echo raw manifest bytes');
      expect(surface).not.toContain('raw first 200 characters');
      expect(surface).toContain('without following symlinks');
      expect(surface).toContain('Exact file-set match');
      expect(surface).toContain('Never follow symlinks or read a manifest path that escapes `<temp_dir>/extracted/`');
      expectOrdered(surface, [
        'Valid flat JSON object',
        'At least one parseable type',
        'Safe relative manifest keys',
        'Manifest-to-disk consistency',
        'Disk-to-manifest consistency',
        'Exact file-set match',
      ]);
    }
  });

  it('creates unique JIRA workspaces and validates current-run artifacts before parsing', () => {
    for (const surface of skillSurfaces('jira-analyze')) {
      const initialize = sectionBetween(surface, '## Phase 1: Initialize', '## Phase 2: JIRA Data Collection');
      expectOrdered(initialize, [
        'Validate the extracted key',
        'JIRA MCP health check',
        'mktemp -d "/tmp/jira-analyze-${issue_key}.XXXXXX"',
        'mkdir -p -- "$extracted_dir" || exit 1',
      ]);
      expect(initialize).toContain('[[ -d "$temp_dir" && ! -L "$temp_dir" ]] || exit 1');
      expect(initialize).toContain('[[ -d "$extracted_dir" && ! -L "$extracted_dir" ]] || exit 1');
      expect(initialize).toContain('A unique directory prevents stale-artifact reuse and same-issue concurrent-run interference');
      expect(initialize).toContain('Preserve this current-run workspace on failure');
      expect(initialize).not.toContain('rm -rf');
      expect(surface).not.toContain('/tmp/jira-analyze-<KEY>');

      const collection = sectionBetween(surface, '## Phase 2: JIRA Data Collection', '## Phase 3: Log Parsing');
      expect(collection).toContain('Enforce the parser handoff gate');
      expect(collection).toContain('non-empty flat JSON object');
      expect(collection).toContain('at least one `logcat|tombstone|anr|kernel` entry');
      expect(collection).toContain('exact manifest-to-disk and disk-to-manifest set equality');
      expect(collection).toContain('Log collection handoff invalid — <specific reason>');
      expect(collection).toContain('do not spawn the parser, call Sourcepilot, generate Why seeds/RCA, or post a JIRA comment');
      expect(collection).toContain('do not replace it with an informal visual check');
      expect(collection).toContain('A `PARTIAL` collector result may continue only when this command exits zero');
      expect(surface).toContain('Collector or parser agent timeout/failure');
      expect(surface).toContain('never reuse existing artifacts from an earlier run');

      expectOrdered(surface, [
        'mktemp -d "/tmp/jira-analyze-${issue_key}.XXXXXX"',
        '## Phase 2: JIRA Data Collection',
        'Enforce the parser handoff gate',
        'TEMP_DIR="$temp_dir" node',
        '## Phase 3: Log Parsing',
      ]);
    }
  });

  it('canonicalizes local input paths before structure-preserving copy', () => {
    for (const surface of agentSurfaces('aosp-log-collector')) {
      const localMode = sectionBetween(surface, '## Local Directory Mode', '## Classification Rules');
      expect(localMode).toContain('input_root=$(realpath -e -- "$input_path") || exit 1');
      expect(localMode).toContain('canonical_extracted=$(realpath -e -- "$extracted_dir") || exit 1');
      expect(localMode).toContain('cd -- "$input_root" || exit 1');
      expect(localMode).toContain('find -P . -type f -exec cp --parents --no-dereference');
      expect(localMode).toContain('Never run `cp --parents` on the original caller-supplied path');
      expect(localMode).not.toContain('find "$input_path" -type f -exec cp --parents');
    }

    const rootDir = mkdtempSync(join(tmpdir(), 'granada-local-collector-'));
    const sourceDir = join(rootDir, 'source');
    const workingDir = join(rootDir, 'work', 'deep');
    const tempDir = join(rootDir, 'temp');
    const extractedDir = join(tempDir, 'extracted');
    mkdirSync(join(sourceDir, 'nested'), { recursive: true });
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(extractedDir, { recursive: true });
    writeFileSync(join(sourceDir, 'nested', 'logcat.txt'), '--------- beginning of main\n');
    writeFileSync(join(rootDir, 'sentinel.txt'), 'unchanged');

    const canonical = agentSurfaces('aosp-log-collector')[0];
    const localCommands = shellBlocks(sectionBetween(canonical, '## Local Directory Mode', '## Classification Rules'));
    const run = spawnSync('/bin/bash', ['-c', [
      'set -e',
      'input_path="$INPUT_PATH"',
      'temp_dir="$TEMP_DIR"',
      'extracted_dir="$EXTRACTED_DIR"',
      localCommands,
    ].join('\n')], {
      cwd: workingDir,
      env: {
        ...process.env,
        INPUT_PATH: '../../source',
        TEMP_DIR: tempDir,
        EXTRACTED_DIR: extractedDir,
      },
      encoding: 'utf8',
      timeout: 5000,
    });

    try {
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(0);
      expect(readFileSync(join(extractedDir, 'nested', 'logcat.txt'), 'utf8')).toContain('beginning of main');
      expect(readFileSync(join(rootDir, 'sentinel.txt'), 'utf8')).toBe('unchanged');
      expect(existsSync(join(rootDir, 'source', 'source', 'nested', 'logcat.txt'))).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps host paths read-only outside the private bubblewrap stage', () => {
    if (process.platform !== 'linux' || spawnSync('bwrap', ['--version']).status !== 0) return;

    const stageDir = mkdtempSync(join(tmpdir(), 'granada-bwrap-stage-'));
    const controlDir = mkdtempSync(join(tmpdir(), 'granada-bwrap-control-'));
    const controlPath = join(controlDir, 'command.stderr');
    writeFileSync(controlPath, 'original');
    const marker = `/dev/shm/granada-bwrap-${process.pid}-${stageDir.split('/').at(-1)}`;
    rmSync(marker, { force: true });
    try {
      const run = spawnSync('bwrap', [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--unshare-cgroup',
        '--unshare-net',
        '--ro-bind', '/', '/',
        '--dev', '/dev',
        '--proc', '/proc',
        '--bind', stageDir, stageDir,
        '--', '/bin/sh', '-c',
        'printf ok > "$1/stage-write"; printf isolated > "$2"; if printf tamper > "$3"; then exit 22; fi',
        'sh', stageDir, marker, controlPath,
      ], { encoding: 'utf8', timeout: 5000 });

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(0);
      expect(readFileSync(join(stageDir, 'stage-write'), 'utf8')).toBe('ok');
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(controlPath, 'utf8')).toBe('original');
    } finally {
      rmSync(marker, { force: true });
      rmSync(stageDir, { recursive: true, force: true });
      rmSync(controlDir, { recursive: true, force: true });
    }
  });

  it('validates staged log-unboxer output before no-follow merge', () => {
    const source = stageValidatorSource(agentSurfaces('aosp-log-collector')[0]);
    const roots: string[] = [];
    const createFixture = (topDirectory?: string) => {
      const rootDir = mkdtempSync(join(tmpdir(), 'granada-log-stage-'));
      roots.push(rootDir);
      const stageDir = join(rootDir, 'stage');
      const stageOutput = join(stageDir, 'output');
      const controlDir = join(rootDir, 'controls');
      const extractedDir = join(rootDir, 'extracted');
      mkdirSync(stageOutput, { recursive: true, mode: 0o700 });
      mkdirSync(controlDir, { mode: 0o700 });
      mkdirSync(extractedDir, { mode: 0o700 });
      chmodSync(stageDir, 0o700);
      const stdoutPath = join(controlDir, 'command.stdout');
      const stderrPath = join(controlDir, 'command.stderr');
      writeFileSync(stdoutPath, 'bounded output\n');
      writeFileSync(stderrPath, '');
      const contentRoot = topDirectory ? join(stageOutput, topDirectory) : stageOutput;
      if (topDirectory) mkdirSync(contentRoot, { mode: 0o700 });
      writeFileSync(join(contentRoot, 'logcat.txt'), '--------- beginning of main\n');
      return { rootDir, stageDir, stageOutput, controlDir, stdoutPath, stderrPath, extractedDir };
    };
    const validate = (
      fixture: ReturnType<typeof createFixture>,
      destinationRelative = 'attachments/0001-test',
      expectedTop = '',
    ) => spawnSync(process.execPath, ['-e', source], {
      env: {
        ...process.env,
        STAGE_DIR: fixture.stageDir,
        STAGE_OUTPUT: fixture.stageOutput,
        CONTROL_ROOT: fixture.rootDir,
        STAGE_CONTROLS: `${fixture.stdoutPath},${fixture.stderrPath}`,
        EXTRACTED_DIR: fixture.extractedDir,
        DEST_RELATIVE: destinationRelative,
        EXPECTED_TOP: expectedTop,
      },
      encoding: 'utf8',
      timeout: 5000,
    });

    try {
      const valid = createFixture();
      expect(validate(valid).status).toBe(0);
      expect(readFileSync(join(valid.extractedDir, 'attachments', '0001-test', 'logcat.txt'), 'utf8'))
        .toContain('beginning of main');

      const unexpectedSibling = createFixture();
      writeFileSync(join(unexpectedSibling.stageDir, 'escaped.txt'), 'escaped\n');
      expect(validate(unexpectedSibling).status).not.toBe(0);

      const identityMismatch = createFixture('remote-value');
      expect(validate(identityMismatch, 'sn-fallback/REQUESTED', 'REQUESTED').status).not.toBe(0);

      const collision = createFixture();
      mkdirSync(join(collision.extractedDir, 'attachments'), { mode: 0o700 });
      mkdirSync(join(collision.extractedDir, 'attachments', '0001-test'), { mode: 0o700 });
      expect(validate(collision).status).not.toBe(0);

      if (process.platform !== 'win32') {
        const linked = createFixture();
        symlinkSync('/tmp', join(linked.stageOutput, 'pivot'));
        expect(validate(linked).status).not.toBe(0);

        const hardlinked = createFixture();
        linkSync(join(hardlinked.stageOutput, 'logcat.txt'), join(hardlinked.stageOutput, 'duplicate.txt'));
        expect(validate(hardlinked).status).not.toBe(0);
      }
    } finally {
      for (const rootDir of roots) rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('executes the handoff validator against valid and adversarial fixtures', () => {
    const source = handoffValidatorSource(skillSurfaces('jira-analyze')[0]);
    const roots: string[] = [];
    const createRun = (manifest: Record<string, string>, files: Record<string, string>): string => {
      const runRoot = mkdtempSync(join(tmpdir(), 'granada-log-handoff-'));
      roots.push(runRoot);
      const extracted = join(runRoot, 'extracted');
      mkdirSync(extracted);
      for (const [name, contents] of Object.entries(files)) writeFileSync(join(extracted, name), contents);
      writeFileSync(join(runRoot, 'file-classification.json'), JSON.stringify(manifest));
      return runRoot;
    };
    const validate = (runRoot: string) => spawnSync(process.execPath, ['-e', source], {
      env: { ...process.env, TEMP_DIR: runRoot },
      encoding: 'utf8',
      timeout: 5000,
    });

    try {
      const valid = createRun({ 'logcat.txt': 'logcat' }, { 'logcat.txt': '--------- beginning of main\n' });
      expect(validate(valid).status).toBe(0);

      const empty = createRun({}, {});
      expect(validate(empty).status).not.toBe(0);

      const allOther = createRun({ 'misc.txt': 'other' }, { 'misc.txt': 'not an Android log\n' });
      expect(validate(allOther).status).not.toBe(0);

      const unclassified = createRun(
        { 'logcat.txt': 'logcat' },
        { 'logcat.txt': '--------- beginning of main\n', 'extra.txt': 'stale\n' },
      );
      expect(validate(unclassified).status).not.toBe(0);

      const traversal = createRun({ '../outside.log': 'logcat' }, {});
      writeFileSync(join(traversal, 'outside.log'), '--------- beginning of main\n');
      expect(validate(traversal).status).not.toBe(0);

      if (process.platform !== 'win32') {
        const linkedManifest = createRun({ 'logcat.txt': 'logcat' }, { 'logcat.txt': '--------- beginning of main\n' });
        const manifestPath = join(linkedManifest, 'file-classification.json');
        const manifestTarget = join(linkedManifest, 'manifest-target.json');
        writeFileSync(manifestTarget, readFileSync(manifestPath, 'utf8'));
        rmSync(manifestPath);
        symlinkSync(manifestTarget, manifestPath);
        expect(validate(linkedManifest).status).not.toBe(0);

        const linkedRoot = mkdtempSync(join(tmpdir(), 'granada-log-handoff-linked-'));
        roots.push(linkedRoot);
        const outside = mkdtempSync(join(tmpdir(), 'granada-log-handoff-outside-'));
        roots.push(outside);
        writeFileSync(join(outside, 'logcat.txt'), '--------- beginning of main\n');
        symlinkSync(outside, join(linkedRoot, 'extracted'));
        writeFileSync(join(linkedRoot, 'file-classification.json'), JSON.stringify({ 'logcat.txt': 'logcat' }));
        expect(validate(linkedRoot).status).not.toBe(0);
      }
    } finally {
      for (const runRoot of roots) rmSync(runRoot, { recursive: true, force: true });
    }
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
