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
const postEntry = manifest.hooks?.PostToolUse?.[0];
const postHooks = Array.isArray(postEntry?.hooks) ? postEntry.hooks : [];
const stopEntry = manifest.hooks?.Stop?.[0];
const stopHooks = Array.isArray(stopEntry?.hooks) ? stopEntry.hooks : [];
const enqueueHook = postHooks.find(hook => hook?.args?.[1] === 'enqueue-artifact');
const drainHook = stopHooks.find(hook => hook?.args?.[1] === 'drain-artifacts');

if (postEntry?.matcher !== 'Write|Edit|Update') throw new Error('PostToolUse matcher is not Write|Edit|Update');
if (postHooks.length !== 1) throw new Error(`expected exactly one PostToolUse hook, got ${postHooks.length}`);
if (!enqueueHook) throw new Error('manifest missing enqueue-artifact hook');
if (enqueueHook.if !== undefined) throw new Error('enqueue-artifact hook should not use manifest if filtering');
if (JSON.stringify(postHooks).includes('timestamp-artifact') || JSON.stringify(postHooks).includes('translate-artifact')) {
  throw new Error('manifest PostToolUse path should not call legacy timestamp/translate routes');
}
if (stopEntry?.matcher !== undefined) throw new Error('Stop hook should not define a matcher');
if (stopHooks.length !== 1) throw new Error(`expected exactly one Stop hook, got ${stopHooks.length}`);
if (!drainHook) throw new Error('manifest missing drain-artifacts hook');
for (const hook of [enqueueHook, drainHook]) {
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
if (!warningOutput.hookSpecificOutput?.additionalContext?.includes('unsafe shell metacharacters')) {
  throw new Error(`packed translate hook warning output did not mention unsafe shell metacharacters: ${warningRun.stdout}`);
}
if (warningOutput.hookSpecificOutput?.hookEventName !== 'PostToolUse') {
  throw new Error('legacy translate warning should keep PostToolUse hook event name');
}
if (warningRun.stderr.trim()) throw new Error(`expected no stderr for warning path without GRANADA_DEBUG, got ${warningRun.stderr}`);
if (existsSync(join(projectDir, '.granada', 'aosp-exports', 'failure_zh.md'))) {
  throw new Error('packed translate hook wrote zh sibling after unsafe command rejection');
}

console.log(`verified packed hook runtime: ${tarball}`);
