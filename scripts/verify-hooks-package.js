import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

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
  const packed = JSON.parse(stdout);
  if (!Array.isArray(packed) || !packed[0]?.filename) {
    throw new Error('npm pack did not return a package filename');
  }
  return packed[0].filename;
}

function matchesClaudeWildcard(pattern, value) {
  const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\'\"]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 's').test(value);
}

const root = resolve(import.meta.dirname, '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'granada-hooks-package-'));
const packDir = join(tempRoot, 'pack');
const extractDir = join(tempRoot, 'extract');
const projectDir = join(tempRoot, 'project');
mkdirSync(packDir, { recursive: true });
mkdirSync(extractDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });

const packResult = run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: root });
const tarball = join(packDir, basename(parsePackOutput(packResult.stdout)));
run('tar', ['-xzf', tarball, '-C', extractDir]);

const packageRoot = join(extractDir, 'package');
const manifestPath = join(packageRoot, 'hooks', 'hooks.json');
const adapterPath = join(packageRoot, 'scripts', 'hooks', 'adapters', 'claude-entry.cjs');
const distEntryPath = join(packageRoot, 'dist', 'adapters', 'claude-entry.js');

for (const requiredPath of [manifestPath, adapterPath, distEntryPath]) {
  if (!existsSync(requiredPath)) throw new Error(`packed artifact missing ${requiredPath}`);
}

const adapterSource = readFileSync(adapterPath, 'utf8');
if (!adapterSource.includes("import('../../../dist/adapters/claude-entry.js')")) {
  throw new Error('CJS bootstrap does not import ../../../dist/adapters/claude-entry.js');
}
if (!adapterSource.includes('main({')) {
  throw new Error('CJS bootstrap does not call exported main(...)');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entry = manifest.hooks?.PostToolUse?.[0];
const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
const translateHook = hooks.find(hook => hook?.args?.[1] === 'translate-artifact');
const timestampHook = hooks.find(hook => hook?.args?.[1] === 'timestamp-artifact');
if (entry?.matcher !== 'Write') throw new Error('PostToolUse matcher is not Write');
if (hooks.length !== 2) throw new Error(`expected exactly two PostToolUse hooks, got ${hooks.length}`);
for (const hook of hooks) {
  if (hook?.command !== 'node') throw new Error('hook command is not node');
  if (hook?.args?.[0] !== '${CLAUDE_PLUGIN_ROOT}/scripts/hooks/adapters/claude-entry.cjs') {
    throw new Error('hook adapter manifest path changed');
  }
}
if (!translateHook) throw new Error('manifest missing translate-artifact hook');
if (!timestampHook) throw new Error('manifest missing timestamp-artifact hook');
if (translateHook.args.length !== 2) throw new Error('translate-artifact hook should use packaged default SKILL.md config');

mkdirSync(join(projectDir, '.granada', 'aosp-exports'), { recursive: true });
const sourcePath = join(projectDir, '.granada', 'aosp-exports', 'feature.md');
writeFileSync(sourcePath, '# English\n\nHello', 'utf8');

const input = {
  session_id: 'verify-hooks-package',
  transcript_path: join(tempRoot, 'transcript.jsonl'),
  cwd: projectDir,
  hook_event_name: 'PostToolUse',
  permission_mode: 'default',
  tool_name: 'Write',
  tool_input: { file_path: '.granada/aosp-exports/feature.md', content: '# English\n\nHello' },
  tool_response: { filePath: sourcePath, content: '# English\n\nHello' },
  tool_use_id: 'verify_write',
};

if (!matchesClaudeWildcard('*/.granada/*.md', sourcePath)) {
  throw new Error('representative path does not match hook wildcard');
}

const translateRun = run('node', [adapterPath, 'translate-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(input),
  env: { ...process.env, TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文\n\n你好' },
});
if (translateRun.stdout.trim()) throw new Error(`expected no stdout for successful translation hook output, got ${translateRun.stdout}`);
if (translateRun.stderr.trim()) throw new Error(`expected no stderr without GRANADA_DEBUG, got ${translateRun.stderr}`);

const targetPath = join(projectDir, '.granada', 'aosp-exports', 'feature_zh.md');
if (readFileSync(targetPath, 'utf8') !== '# 中文\n\n你好') {
  throw new Error('packed translate hook did not write expected zh sibling');
}

const timestampRun = run('node', [adapterPath, 'timestamp-artifact'], {
  cwd: projectDir,
  input: JSON.stringify(input),
  env: process.env,
});
if (timestampRun.stdout.trim()) throw new Error(`expected no stdout for successful timestamp hook output, got ${timestampRun.stdout}`);
if (timestampRun.stderr.trim()) throw new Error(`expected no stderr without GRANADA_DEBUG, got ${timestampRun.stderr}`);

const outputFiles = readdirSync(join(projectDir, '.granada', 'aosp-exports'));
const timestampedSource = outputFiles.find(file => /^\d{8}-\d{6}-feature\.md$/.test(file));
const timestampedTarget = outputFiles.find(file => /^\d{8}-\d{6}-feature_zh\.md$/.test(file));
if (!timestampedSource) {
  throw new Error(`packed timestamp hook did not timestamp source filename; files=${outputFiles.join(',')}`);
}
if (!timestampedTarget) {
  throw new Error(`packed timestamp hook did not timestamp zh filename; files=${outputFiles.join(',')}`);
}
const sourcePrefix = timestampedSource.slice(0, 'YYYYMMDD-HHMMSS-'.length);
const targetPrefix = timestampedTarget.slice(0, 'YYYYMMDD-HHMMSS-'.length);
if (sourcePrefix !== targetPrefix) {
  throw new Error(`packed timestamp hook used different source and zh prefixes: ${timestampedSource} ${timestampedTarget}`);
}
if (readFileSync(join(projectDir, '.granada', 'aosp-exports', timestampedTarget), 'utf8') !== '# 中文\n\n你好') {
  throw new Error('packed timestamp hook did not preserve expected zh sibling');
}
if (!existsSync(sourcePath) || !existsSync(targetPath)) {
  throw new Error('packed timestamp hook should preserve untimestamped source and zh sibling');
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
  env: { ...process.env, GRANADA_TRANSLATE_COMMAND: 'claude -p; echo unsafe' },
});
const warningOutput = JSON.parse(warningRun.stdout.trim());
if (!warningOutput.hookSpecificOutput?.additionalContext?.includes('unsafe shell metacharacters')) {
  throw new Error(`packed translate hook warning output did not mention unsafe shell metacharacters: ${warningRun.stdout}`);
}
if (warningRun.stderr.trim()) throw new Error(`expected no stderr for warning path without GRANADA_DEBUG, got ${warningRun.stderr}`);
if (existsSync(join(projectDir, '.granada', 'aosp-exports', 'failure_zh.md'))) {
  throw new Error('packed translate hook wrote zh sibling after unsafe command rejection');
}

console.log(`verified packed hook runtime: ${tarball}`);
