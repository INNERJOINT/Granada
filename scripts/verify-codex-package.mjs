import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(root, 'plugins', 'zaku');
const MAX_BUFFER = 64 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requireFile(path) {
  if (!existsSync(path) || !lstatSync(path).isFile()) fail(`required file is missing: ${path}`);
}

function listFiles(rootPath) {
  const files = [];
  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail(`bundle must not contain symlinks: ${path}`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push(relative(rootPath, path).replaceAll('\\', '/'));
    }
  }
  walk(rootPath);
  return files;
}

function unsafeReason(path, packageScope = false) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  const forbiddenSegments = new Set([
    '.git',
    '.granada',
    '.omc',
    '.claude',
    '.firecrawl',
    'node_modules',
  ]);

  const forbiddenSegment = segments.find(segment => forbiddenSegments.has(segment));
  if (forbiddenSegment) return `contains ${forbiddenSegment}`;
  if (segments.some(segment => segment === '.env' || segment.startsWith('.env.'))) {
    return 'contains an environment file';
  }
  if (packageScope && (normalized === '.codex' || normalized.startsWith('.codex/'))) {
    return 'contains project-scoped Codex state';
  }
  if (
    packageScope
    && (normalized === '.agents' || normalized.startsWith('.agents/'))
    && normalized !== '.agents/plugins/marketplace.json'
  ) {
    return 'contains unexpected .agents state';
  }
  return null;
}

function assertSafeFiles(files, label, packageScope = false) {
  const unsafe = files
    .map(path => ({ path, reason: unsafeReason(path, packageScope) }))
    .filter(entry => entry.reason);
  if (unsafe.length > 0) {
    fail(`${label} contains unsafe files:\n${unsafe.map(entry => `- ${entry.path}: ${entry.reason}`).join('\n')}`);
  }
}

function parsePackResult(stdout) {
  const start = stdout.indexOf('[');
  if (start < 0) fail(`npm pack did not emit JSON:\n${stdout}`);
  const parsed = JSON.parse(stdout.slice(start));
  if (!Array.isArray(parsed) || !parsed[0]?.filename || !Array.isArray(parsed[0]?.files)) {
    fail('npm pack returned an unexpected JSON payload');
  }
  return parsed[0];
}

function assertRequiredPackFiles(files) {
  const paths = new Set(files);
  const required = [
    'package.json',
    'README.md',
    'AGENTS.md',
    'LICENSE',
    '.agents/plugins/marketplace.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.mcp.json',
    'hooks/hooks.json',
    'dist/adapters/claude-entry.js',
    'scripts/hooks/adapters/claude-entry.cjs',
    'plugins/zaku/package.json',
    'plugins/zaku/.codex-plugin/plugin.json',
    'plugins/zaku/.mcp.json',
    'plugins/zaku/hooks/hooks.json',
    'plugins/zaku/bridge/mcp-server.cjs',
    'plugins/zaku/dist/adapters/codex-entry.js',
    'plugins/zaku/scripts/hooks/adapters/codex-entry.cjs',
    'plugins/zaku/references/codex-compat.md',
    'plugins/zaku/agents/aosp-investigator.md',
    'plugins/zaku/skills/aosp-analyze/SKILL.md',
  ];
  const missing = required.filter(path => !paths.has(path));
  if (missing.length > 0) fail(`npm package is missing required files:\n${missing.map(path => `- ${path}`).join('\n')}`);

  const pluginSkills = files.filter(path => /^plugins\/zaku\/skills\/[^/]+\/SKILL\.md$/.test(path));
  const pluginAgents = files.filter(path => /^plugins\/zaku\/agents\/[^/]+\.md$/.test(path));
  if (pluginSkills.length < 12) fail(`npm package has only ${pluginSkills.length} Codex skills; expected at least 12`);
  if (pluginAgents.length < 8) fail(`npm package has only ${pluginAgents.length} bundled agent prompts; expected at least 8`);
}

function assertVersions(packageRoot = root) {
  const pkg = readJson(join(packageRoot, 'package.json'));
  const claudeManifest = readJson(join(packageRoot, '.claude-plugin', 'plugin.json'));
  const claudeMarketplace = readJson(join(packageRoot, '.claude-plugin', 'marketplace.json'));
  const codexManifest = readJson(join(packageRoot, 'plugins', 'zaku', '.codex-plugin', 'plugin.json'));
  const codexPackage = readJson(join(packageRoot, 'plugins', 'zaku', 'package.json'));
  const versions = [
    ['Claude plugin manifest', claudeManifest.version],
    ['Claude marketplace', claudeMarketplace.version],
    ['Claude marketplace plugin', claudeMarketplace.plugins?.[0]?.version],
    ['Codex plugin manifest', codexManifest.version],
    ['Codex plugin package', codexPackage.version],
  ];
  const mismatches = versions.filter(([, version]) => version !== pkg.version);
  if (mismatches.length > 0) {
    fail(`version mismatch against package.json ${pkg.version}:\n${mismatches.map(([label, version]) => `- ${label}: ${version ?? 'missing'}`).join('\n')}`);
  }
  if (codexPackage.type !== 'module' || codexPackage.private !== true) {
    fail('plugins/zaku/package.json must be a private ESM package');
  }
}

function assertRootPackageContract() {
  const pkg = readJson(join(root, 'package.json'));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const prepack = pkg.scripts?.prepack ?? '';
  const referencedPluginCheck = prepack.includes('verify:codex-plugin')
    ? pkg.scripts?.['verify:codex-plugin'] ?? ''
    : '';
  const pluginOnlyPrepack = `${prepack} ${referencedPluginCheck}`.includes('--plugin-only');

  if (!pluginOnlyPrepack || /(?:^|\s)npm run verify:codex(?:\s|$)/.test(prepack)) {
    fail('prepack must verify only the installable Codex plugin bundle; full .codex/agents verification belongs to CI');
  }
  if (files.some(path => path.replaceAll('\\', '/').replace(/^!/, '').startsWith('.codex/'))) {
    fail('package.json files must not publish project-scoped .codex/agents');
  }
  const packagesRootSkills = files.some(path => path.replaceAll('\\', '/').replace(/^!/, '').startsWith('skills/'));
  const excludesLocalSkillState = files.some(path => path.startsWith('!') && path.includes('.omc'));
  if (packagesRootSkills && !excludesLocalSkillState) {
    fail('package.json files must explicitly exclude local skills/**/.omc/** state');
  }

  const lockSource = readFileSync(join(root, 'package-lock.json'), 'utf8');
  if (lockSource.includes('node_modules/@modelcontextprotocol/sdk')) {
    fail('package-lock.json still contains the removed @modelcontextprotocol/sdk dependency');
  }
}

function assertPluginMetadata(packageRoot = root) {
  const marketplace = readJson(join(packageRoot, '.agents', 'plugins', 'marketplace.json'));
  const entry = marketplace.plugins?.find(candidate => candidate.name === 'zaku');
  if (marketplace.name !== 'zeonic-local') fail('Codex marketplace name must be zeonic-local');
  if (entry?.source?.source !== 'local' || entry?.source?.path !== './plugins/zaku') {
    fail('Codex marketplace must point zaku at the lightweight ./plugins/zaku bundle');
  }

  const manifest = readJson(join(packageRoot, 'plugins', 'zaku', '.codex-plugin', 'plugin.json'));
  if (manifest.name !== 'zaku' || manifest.skills !== './skills/' || manifest.mcpServers !== './.mcp.json') {
    fail('Codex plugin manifest is incomplete');
  }
  if ('agents' in manifest) fail('Codex plugin manifest must not declare unsupported native agents');

  const mcpSource = readFileSync(join(packageRoot, 'plugins', 'zaku', '.mcp.json'), 'utf8');
  if (mcpSource.includes('${')) fail('Codex MCP config must inherit env_vars instead of interpolating environment values');

  const hookSource = readFileSync(join(packageRoot, 'plugins', 'zaku', 'hooks', 'hooks.json'), 'utf8');
  if (!hookSource.includes('${PLUGIN_ROOT}/scripts/hooks/adapters/codex-entry.cjs')) {
    fail('Codex hooks must launch the adapter through PLUGIN_ROOT');
  }

  const bridgeSource = readFileSync(join(packageRoot, 'plugins', 'zaku', 'bridge', 'mcp-server.cjs'), 'utf8');
  if (bridgeSource.includes('@modelcontextprotocol/sdk')) {
    fail('Codex bridge must remain self-contained and must not depend on @modelcontextprotocol/sdk');
  }
}

function smokeBridge(packageRoot) {
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'verify-codex-package', version: '1' },
      },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(message => JSON.stringify(message)).join('\n') + '\n';
  const bridgePath = join(packageRoot, 'plugins', 'zaku', 'bridge', 'mcp-server.cjs');
  const result = run(process.execPath, [bridgePath], {
    cwd: dirname(bridgePath),
    env: { ...process.env, SOURCEPILOT_URL: '', SOURCEPILOT_KEY: '' },
    input,
    timeout: 10_000,
  });
  const responses = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const initialized = responses.find(response => response.id === 1);
  const listed = responses.find(response => response.id === 2);
  if (initialized?.result?.serverInfo?.name !== 'zaku-sourcepilot') {
    fail(`packed bridge initialize failed: ${result.stdout}`);
  }
  const tools = new Set((listed?.result?.tools ?? []).map(tool => tool.name));
  for (const name of ['list_projects', 'search_code', 'get_file_content']) {
    if (!tools.has(name)) fail(`packed bridge tools/list is missing ${name}`);
  }
}

run(process.execPath, ['scripts/sync-codex-plugin.mjs', '--check', '--plugin-only']);

for (const path of [
  join(pluginRoot, '.codex-plugin', 'plugin.json'),
  join(pluginRoot, 'package.json'),
  join(pluginRoot, '.mcp.json'),
  join(pluginRoot, 'hooks', 'hooks.json'),
  join(pluginRoot, 'bridge', 'mcp-server.cjs'),
]) {
  requireFile(path);
}

assertVersions();
assertRootPackageContract();
assertPluginMetadata();
assertSafeFiles(listFiles(pluginRoot), 'plugins/zaku');

const tempRoot = mkdtempSync(join(tmpdir(), 'granada-codex-package-'));
const packDir = join(tempRoot, 'pack');
const extractDir = join(tempRoot, 'extract');
const npmCache = join(tempRoot, 'npm-cache');
mkdirSync(packDir, { recursive: true });
mkdirSync(extractDir, { recursive: true });
mkdirSync(npmCache, { recursive: true });

try {
  // Ignore lifecycle scripts deliberately: prepack is responsible only for the
  // installable plugin mirror, while full project-agent verification belongs to CI.
  const packed = parsePackResult(run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    packDir,
  ], {
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      npm_config_loglevel: 'error',
      npm_config_update_notifier: 'false',
    },
  }).stdout);

  const packedFiles = packed.files.map(file => file.path.replaceAll('\\', '/'));
  assertRequiredPackFiles(packedFiles);
  assertSafeFiles(packedFiles, 'npm package', true);

  const tarball = join(packDir, basename(packed.filename));
  requireFile(tarball);
  run('tar', ['-xzf', tarball, '-C', extractDir]);

  const extractedRoot = join(extractDir, 'package');
  assertVersions(extractedRoot);
  assertPluginMetadata(extractedRoot);
  smokeBridge(extractedRoot);

  console.log(`verified Codex plugin bundle and npm package: ${packed.filename} (${packedFiles.length} files)`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
