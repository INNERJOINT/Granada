import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function parsePackOutput(stdout) {
  const jsonStart = stdout.indexOf('[');
  if (jsonStart < 0) throw new Error(`npm pack did not return JSON:\n${stdout}`);
  const packed = JSON.parse(stdout.slice(jsonStart));
  if (!Array.isArray(packed) || !packed[0]?.filename || !Array.isArray(packed[0]?.files)) {
    throw new Error('npm pack did not return a package filename and file list');
  }
  return packed[0];
}

function listPlainFiles(rootPath, basePath, { skipOmc = false } = {}) {
  const files = [];
  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      if (skipOmc && name === '.omc') continue;
      const filePath = join(current, name);
      const stat = lstatSync(filePath);
      if (stat.isSymbolicLink()) throw new Error(`package surface must not contain symlinks: ${filePath}`);
      if (stat.isDirectory()) walk(filePath);
      else if (stat.isFile()) files.push(relative(basePath, filePath).replaceAll('\\', '/'));
    }
  }
  walk(rootPath);
  return files;
}

function assertSafePackageFiles(files) {
  const forbiddenSegments = new Set(['.git', '.granada', '.omc', '.claude', '.firecrawl', '.codex', '.agents', 'node_modules']);
  const unsafe = [];
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
    const segments = normalized.split('/');
    const forbiddenSegment = segments.find(segment => forbiddenSegments.has(segment));
    if (forbiddenSegment) unsafe.push(`${normalized}: contains ${forbiddenSegment}`);
    else if (segments.some(segment => segment === '.env' || segment.startsWith('.env.'))) unsafe.push(`${normalized}: contains an environment file`);
    else if (normalized === 'plugins/zaku' || normalized.startsWith('plugins/zaku/')) unsafe.push(`${normalized}: contains the removed generated plugin`);
    else if (/codex|openai/i.test(normalized)) unsafe.push(`${normalized}: contains a removed host-specific path`);
  }
  if (unsafe.length > 0) throw new Error(`npm package contains unsafe files:\n${unsafe.map(entry => `- ${entry}`).join('\n')}`);
}

const root = resolve(import.meta.dirname, '..');
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const tempRoot = mkdtempSync(join(tmpdir(), 'granada-hooks-package-'));
const packDir = join(tempRoot, 'pack');
const extractDir = join(tempRoot, 'extract');
const projectDir = join(tempRoot, 'project');
const npmCache = join(tempRoot, 'npm-cache');
mkdirSync(packDir, { recursive: true });
mkdirSync(extractDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });
mkdirSync(npmCache, { recursive: true });

const packResult = run('npm', ['pack', '--json', '--pack-destination', packDir], {
  cwd: root,
  env: {
    ...process.env,
    npm_config_cache: npmCache,
    npm_config_loglevel: 'error',
    npm_config_update_notifier: 'false',
  },
});
const packed = parsePackOutput(packResult.stdout);
const packedFiles = packed.files.map(file => file.path.replaceAll('\\', '/'));
const canonicalRoots = ['.claude-plugin', 'agents', 'assets', 'bridge', 'dist', 'hooks', 'output-styles', 'scripts/hooks', 'skills'];
const requiredPackedFiles = [
  'package.json',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CHANGELOG.md',
  'LICENSE',
  '.mcp.json',
  ...canonicalRoots.flatMap(path => listPlainFiles(join(root, path), root, { skipOmc: true })),
];
const packedFileSet = new Set(packedFiles);
const missingPackedFiles = requiredPackedFiles.filter(path => !packedFileSet.has(path));
if (missingPackedFiles.length > 0) {
  throw new Error(`npm package is missing required files:\n${missingPackedFiles.map(path => `- ${path}`).join('\n')}`);
}
assertSafePackageFiles(packedFiles);

const tarball = join(packDir, basename(packed.filename));
run('tar', ['-xzf', tarball, '-C', extractDir]);

const packageRoot = join(extractDir, 'package');
const extractedFiles = listPlainFiles(packageRoot, packageRoot).sort();
const reportedFiles = [...packedFiles].sort();
if (JSON.stringify(extractedFiles) !== JSON.stringify(reportedFiles)) {
  throw new Error('extracted package file set does not match npm pack output');
}
assertSafePackageFiles(extractedFiles);
const packageJsonPath = join(packageRoot, 'package.json');
const pluginManifestPath = join(packageRoot, '.claude-plugin', 'plugin.json');
const marketplacePath = join(packageRoot, '.claude-plugin', 'marketplace.json');
const mcpConfigPath = join(packageRoot, '.mcp.json');
const manifestPath = join(packageRoot, 'hooks', 'hooks.json');
const adapterPath = join(packageRoot, 'scripts', 'hooks', 'adapters', 'claude-entry.cjs');
const distEntryPath = join(packageRoot, 'dist', 'adapters', 'claude-entry.js');
const bridgePath = join(packageRoot, 'bridge', 'mcp-server.cjs');

for (const requiredPath of [
  packageJsonPath,
  pluginManifestPath,
  marketplacePath,
  mcpConfigPath,
  manifestPath,
  adapterPath,
  distEntryPath,
  bridgePath,
]) {
  if (!existsSync(requiredPath)) throw new Error(`packed artifact missing ${requiredPath}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const pluginManifest = JSON.parse(readFileSync(pluginManifestPath, 'utf8'));
const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
const marketplacePlugin = marketplace.plugins?.find(plugin => plugin.name === 'zaku');
const versions = [
  ['package-lock.json', packageLock.version],
  ['package-lock.json root package', packageLock.packages?.['']?.version],
  ['.claude-plugin/plugin.json', pluginManifest.version],
  ['.claude-plugin/marketplace.json', marketplace.version],
  ['.claude-plugin/marketplace.json zaku plugin', marketplacePlugin?.version],
];
for (const [label, version] of versions) {
  if (version !== packageJson.version) {
    throw new Error(`${label} version ${version} does not match package version ${packageJson.version}`);
  }
}
if (pluginManifest.mcpServers !== './.mcp.json') {
  throw new Error(`Claude plugin MCP manifest path changed: ${pluginManifest.mcpServers}`);
}
if (packageJson.main !== 'bridge/mcp-server.cjs') {
  throw new Error(`packed package main changed: ${packageJson.main}`);
}

const bridgeSource = readFileSync(bridgePath, 'utf8');
if (bridgeSource.includes('@modelcontextprotocol/sdk')) {
  throw new Error('packed bridge must remain self-contained without @modelcontextprotocol/sdk');
}
const bridgeInput = [
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'verify', version: '1' } },
  }),
  JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  '',
].join('\n');
const bridgeRun = run(process.execPath, [bridgePath], {
  cwd: packageRoot,
  input: bridgeInput,
  env: { ...process.env, SOURCEPILOT_URL: '', SOURCEPILOT_KEY: '' },
});
const bridgeResponses = bridgeRun.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map(line => JSON.parse(line));
const initialized = bridgeResponses.find(response => response.id === 1);
const listed = bridgeResponses.find(response => response.id === 2);
if (initialized?.result?.serverInfo?.name !== 'zaku-sourcepilot') {
  throw new Error(`packed bridge initialization failed: ${bridgeRun.stdout}`);
}
const toolNames = listed?.result?.tools?.map(tool => tool.name) || [];
for (const requiredTool of ['list_projects', 'search_code', 'get_file_content']) {
  if (!toolNames.includes(requiredTool)) throw new Error(`packed bridge missing fallback tool: ${requiredTool}`);
}

const adapterSource = readFileSync(adapterPath, 'utf8');
if (!adapterSource.includes("import('../../../dist/adapters/claude-entry.js')")) {
  throw new Error('CJS bootstrap does not import ../../../dist/adapters/claude-entry.js');
}
if (!adapterSource.includes('main({')) {
  throw new Error('CJS bootstrap does not call exported main(...)');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const postEntry = manifest.hooks?.PostToolUse?.[0];
const postHooks = Array.isArray(postEntry?.hooks) ? postEntry.hooks : [];
const stopEntry = manifest.hooks?.Stop?.[0];
const stopHooks = Array.isArray(stopEntry?.hooks) ? stopEntry.hooks : [];
const enqueueHooks = postHooks.filter(hook => hook?.args?.[1] === 'enqueue-artifact');
const drainHook = stopHooks.find(hook => hook?.args?.[1] === 'drain-artifacts');

if (postEntry?.matcher !== 'Write|Edit') throw new Error('PostToolUse matcher is not Write|Edit');
if (postHooks.length !== 2) throw new Error(`expected exactly two PostToolUse hooks, got ${postHooks.length}`);
if (enqueueHooks.length !== 2) throw new Error(`expected two enqueue-artifact hooks, got ${enqueueHooks.length}`);
const [writeHook, editHook] = postHooks;
if (writeHook?.if !== 'Write(*/.granada/**)') throw new Error(`Write enqueue hook if filter changed: ${writeHook?.if}`);
if (editHook?.if !== 'Edit(*/.granada/**)') throw new Error(`Edit enqueue hook if filter changed: ${editHook?.if}`);
if (JSON.stringify(postHooks).includes('timestamp-artifact') || JSON.stringify(postHooks).includes('translate-artifact')) {
  throw new Error('manifest PostToolUse path should not call legacy timestamp/translate routes');
}
if (stopEntry?.matcher !== undefined) throw new Error('Stop hook should not define a matcher');
if (stopHooks.length !== 1) throw new Error(`expected exactly one Stop hook, got ${stopHooks.length}`);
if (!drainHook) throw new Error('manifest missing drain-artifacts hook');
for (const hook of [...enqueueHooks, drainHook]) {
  if (hook?.command !== 'node') throw new Error('hook command is not node');
  if (hook?.args?.[0] !== '${CLAUDE_PLUGIN_ROOT}/scripts/hooks/adapters/claude-entry.cjs') {
    throw new Error('hook adapter manifest path changed');
  }
}

mkdirSync(join(projectDir, '.granada', 'aosp-exports'), { recursive: true });
const sourcePath = join(projectDir, '.granada', 'aosp-exports', 'feature.md');
writeFileSync(sourcePath, '# English\n\nDraft', 'utf8');

const input = {
  session_id: 'verify-hooks-package',
  transcript_path: join(tempRoot, 'transcript.jsonl'),
  cwd: projectDir,
  hook_event_name: 'PostToolUse',
  permission_mode: 'default',
  tool_name: 'Write',
  tool_input: { file_path: '.granada/aosp-exports/feature.md', content: '# English\n\nDraft' },
  tool_response: { filePath: sourcePath, content: '# English\n\nDraft' },
  tool_use_id: 'verify_write_1',
};

const enqueueRun = run('node', [adapterPath, 'enqueue-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(input),
  env: { ...process.env, GRANADA_TRANSLATE_LANG: 'ja' },
});
if (enqueueRun.stdout.trim()) throw new Error(`expected no stdout for successful enqueue hook output, got ${enqueueRun.stdout}`);
if (enqueueRun.stderr.trim()) throw new Error(`expected no stderr without GRANADA_DEBUG, got ${enqueueRun.stderr}`);

writeFileSync(sourcePath, '# English\n\nFinal', 'utf8');
const updateInput = {
  ...input,
  tool_name: 'Update',
  tool_input: { file_path: '.granada/aosp-exports/feature.md' },
  tool_response: { filePath: sourcePath, content: '# English\n\nFinal' },
  tool_use_id: 'verify_update_2',
};
const enqueueUpdateRun = run('node', [adapterPath, 'enqueue-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(updateInput),
  env: { ...process.env, GRANADA_TRANSLATE_LANG: 'ja' },
});
if (enqueueUpdateRun.stdout.trim()) throw new Error(`expected no stdout for second enqueue hook output, got ${enqueueUpdateRun.stdout}`);
if (enqueueUpdateRun.stderr.trim()) throw new Error(`expected no stderr for second enqueue, got ${enqueueUpdateRun.stderr}`);

const queueDir = join(projectDir, '.granada', '.hooks', 'artifact-queue', 'session-verify-hooks-package');
const queuedRecords = readdirSync(queueDir).filter(file => file.endsWith('.json') && !file.startsWith('failed-'));
if (queuedRecords.length !== 1) throw new Error(`expected one latest queue record, got ${queuedRecords.length}`);
const latestRecord = JSON.parse(readFileSync(join(queueDir, queuedRecords[0]), 'utf8'));
if (latestRecord.toolUseId !== 'verify_update_2') throw new Error(`queue did not keep latest Update record: ${latestRecord.toolUseId}`);

const stopInput = {
  session_id: 'verify-hooks-package',
  transcript_path: join(tempRoot, 'transcript.jsonl'),
  cwd: projectDir,
  hook_event_name: 'Stop',
  permission_mode: 'default',
  stop_hook_active: false,
  last_assistant_message: 'done',
};
const drainRun = run('node', [adapterPath, 'drain-artifacts'], {
  cwd: projectDir,
  input: JSON.stringify(stopInput),
  env: { ...process.env, GRANADA_TRANSLATE_LANG: 'ja', TRANSLATE_MD_ZH_MOCK_TEXT: '# 日本語\n\nこんにちは' },
});
if (drainRun.stdout.trim()) throw new Error(`expected no stdout for successful drain hook output, got ${drainRun.stdout}`);
if (drainRun.stderr.trim()) throw new Error(`expected no stderr for successful drain, got ${drainRun.stderr}`);

let outputFiles = readdirSync(join(projectDir, '.granada', 'aosp-exports'));
const timestampedSources = outputFiles.filter(file => /^\d{8}-\d{6}-feature\.md$/.test(file));
const timestampedTargets = outputFiles.filter(file => /^\d{8}-\d{6}-feature_ja\.md$/.test(file));
if (timestampedSources.length !== 1) throw new Error(`expected one timestamped source, files=${outputFiles.join(',')}`);
if (timestampedTargets.length !== 1) throw new Error(`expected one timestamped translation, files=${outputFiles.join(',')}`);
if (readFileSync(join(projectDir, '.granada', 'aosp-exports', timestampedSources[0]), 'utf8') !== '# English\n\nFinal') {
  throw new Error('drain did not timestamp final source content');
}
if (readFileSync(join(projectDir, '.granada', 'aosp-exports', timestampedTargets[0]), 'utf8') !== '# 日本語\n\nこんにちは') {
  throw new Error('drain did not write expected timestamped ja sibling');
}
if (existsSync(join(projectDir, '.granada', 'aosp-exports', 'feature_ja.md'))) {
  throw new Error('drain should not write untimestamped ja when timestamped source exists');
}

const legacyPath = join(projectDir, '.granada', 'aosp-exports', 'legacy.md');
writeFileSync(legacyPath, '# English\n\nLegacy', 'utf8');
const legacyInput = {
  ...input,
  tool_input: { file_path: '.granada/aosp-exports/legacy.md', content: '# English\n\nLegacy' },
  tool_response: { filePath: legacyPath, content: '# English\n\nLegacy' },
  tool_use_id: 'verify_legacy',
};
const legacyTimestamp = run('node', [adapterPath, 'timestamp-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(legacyInput),
  env: { ...process.env, GRANADA_TRANSLATE_LANG: 'zh' },
});
if (legacyTimestamp.stdout.trim()) throw new Error(`expected no stdout for legacy timestamp hook, got ${legacyTimestamp.stdout}`);
const legacyTranslate = run('node', [adapterPath, 'translate-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(legacyInput),
  env: { ...process.env, GRANADA_TRANSLATE_LANG: 'zh', TRANSLATE_MD_ZH_MOCK_TEXT: '# 旧版' },
});
if (legacyTranslate.stdout.trim()) throw new Error(`expected no stdout for legacy translate hook, got ${legacyTranslate.stdout}`);
outputFiles = readdirSync(join(projectDir, '.granada', 'aosp-exports'));
if (!outputFiles.some(file => /^\d{8}-\d{6}-legacy_zh\.md$/.test(file))) {
  throw new Error(`legacy direct routes did not produce timestamped translation; files=${outputFiles.join(',')}`);
}

const disabledPath = join(projectDir, '.granada', 'aosp-exports', 'disabled.md');
writeFileSync(disabledPath, '# English', 'utf8');
const disabledInput = {
  ...input,
  tool_input: { file_path: '.granada/aosp-exports/disabled.md', content: '# English' },
  tool_response: { filePath: disabledPath, content: '# English' },
  tool_use_id: 'verify_disabled',
};
const disabledRun = run('node', [adapterPath, 'translate-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(disabledInput),
  env: { ...process.env, GRANADA_TRANSLATE_ENABLE: 'false', TRANSLATE_MD_ZH_MOCK_TEXT: '# 禁用' },
});
if (disabledRun.stdout.trim()) throw new Error(`expected no stdout for disabled translate hook, got ${disabledRun.stdout}`);
if (existsSync(join(projectDir, '.granada', 'aosp-exports', 'disabled_zh.md'))) {
  throw new Error('packed translate hook wrote zh sibling while translation disabled');
}

const failureSourcePath = join(projectDir, '.granada', 'aosp-exports', 'failure.md');
writeFileSync(failureSourcePath, '# English', 'utf8');
const failureInput = {
  ...input,
  tool_input: { file_path: '.granada/aosp-exports/failure.md', content: '# English' },
  tool_response: { filePath: failureSourcePath, content: '# English' },
  tool_use_id: 'verify_failure',
};
const warningRun = run('node', [adapterPath, 'translate-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(failureInput),
  env: { ...process.env, GRANADA_TRANSLATE_LANG: 'zh', GRANADA_TRANSLATE_COMMAND: 'claude -p; echo unsafe' },
});
const warningOutput = JSON.parse(warningRun.stdout.trim());
if (!warningOutput.systemMessage?.includes('unsafe shell metacharacters')) {
  throw new Error(`packed translate hook warning output did not mention unsafe shell metacharacters: ${warningRun.stdout}`);
}
if (warningRun.stderr.trim()) throw new Error(`expected no stderr for warning path without GRANADA_DEBUG, got ${warningRun.stderr}`);
if (existsSync(join(projectDir, '.granada', 'aosp-exports', 'failure_zh.md'))) {
  throw new Error('packed translate hook wrote zh sibling after unsafe command rejection');
}

console.log(`verified packed hook runtime and bridge: ${tarball}`);
