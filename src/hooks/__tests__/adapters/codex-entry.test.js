import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runHook, baseInput } from '../events/helper.js';

async function loadAdapter() {
  const adapterUrl = pathToFileURL(
    resolve(import.meta.dirname, '../../../../dist/adapters/codex-entry.js'),
  ).href;
  return import(adapterUrl);
}

describe('Codex hook adapter', () => {
  it('extracts add/update/move paths and ignores deleted files', async () => {
    const { extractCodexPatchedFiles } = await loadAdapter();
    const patch = `*** Begin Patch
*** Add File: .granada/aosp-exports/new file.md
+new
*** Update File: .granada/aosp-exports/old.md
*** Move to: .granada/aosp-exports/moved.md
@@
-old
+new
*** Delete File: .granada/aosp-exports/deleted.md
*** Update File: README.md
@@
-old
+new
*** End Patch`;

    expect(extractCodexPatchedFiles(patch)).toEqual([
      '.granada/aosp-exports/new file.md',
      '.granada/aosp-exports/moved.md',
      'README.md',
    ]);
  });

  it('normalizes one apply_patch call into synthetic Edit inputs', async () => {
    const { normalizeCodexHookInputs } = await loadAdapter();
    const input = baseInput('PostToolUse', {
      tool_name: 'apply_patch',
      tool_use_id: 'patch-1',
      tool_input: {
        command: '*** Begin Patch\n*** Add File: .granada/a.md\n+x\n*** Update File: .granada/b.md\n@@\n-a\n+b\n*** End Patch',
      },
      tool_response: 'Exit code: 0',
    });

    const normalized = normalizeCodexHookInputs(input);
    expect(normalized).toHaveLength(2);
    expect(normalized.map(item => item.tool_name)).toEqual(['Edit', 'Edit']);
    expect(normalized.map(item => item.tool_input.file_path)).toEqual([
      '.granada/a.md',
      '.granada/b.md',
    ]);
    expect(normalized[0].tool_response).toMatchObject({ filePath: '.granada/a.md' });
  });

  it('queues every eligible markdown file from a Codex patch and drains on Stop', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'granada-codex-hook-'));
    const exportDir = join(cwd, '.granada', 'aosp-exports');
    mkdirSync(exportDir, { recursive: true });
    writeFileSync(join(exportDir, 'one.md'), '# One\n', 'utf8');
    writeFileSync(join(exportDir, 'two.md'), '# Two\n', 'utf8');

    const patchInput = baseInput('PostToolUse', {
      cwd,
      turn_id: 'turn-1',
      model: 'gpt-5',
      tool_name: 'apply_patch',
      tool_use_id: 'patch-queue',
      tool_input: {
        command: `*** Begin Patch
*** Update File: .granada/aosp-exports/one.md
@@
-old
+new
*** Update File: .granada/aosp-exports/two.md
@@
-old
+new
*** End Patch`,
      },
      tool_response: 'Exit code: 0',
    });

    const queued = await runHook('../adapters/codex-entry.cjs', patchInput, {
      cwd,
      args: ['enqueue-artifact'],
    });
    expect(queued.exitCode).toBe(0);
    expect(queued.stdout).toBe('');
    expect(queued.stderr).toBe('');

    const queueDir = join(cwd, '.granada', '.hooks', 'artifact-queue', 'session-test-session-001');
    const records = readdirSync(queueDir).filter(name => name.endsWith('.json'));
    expect(records).toHaveLength(2);
    const sources = records
      .map(name => JSON.parse(readFileSync(join(queueDir, name), 'utf8')).sourcePath)
      .sort();
    expect(sources).toEqual([
      join(exportDir, 'one.md'),
      join(exportDir, 'two.md'),
    ]);

    const stopped = await runHook('../adapters/codex-entry.cjs', baseInput('Stop', {
      cwd,
      turn_id: 'turn-1',
      model: 'gpt-5',
      stop_hook_active: false,
      last_assistant_message: 'done',
    }), {
      cwd,
      args: ['drain-artifacts'],
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文\n' },
      timeout: 10000,
    });

    expect(stopped.exitCode).toBe(0);
    expect(stopped.stderr).toBe('');
    const files = readdirSync(exportDir);
    expect(files.some(name => /^\d{8}-\d{6}-one_zh\.md$/.test(name))).toBe(true);
    expect(files.some(name => /^\d{8}-\d{6}-two_zh\.md$/.test(name))).toBe(true);
    const remainingRecords = existsSync(queueDir)
      ? readdirSync(queueDir).filter(name => name.endsWith('.json') && !name.startsWith('failed-'))
      : [];
    expect(remainingRecords).toEqual([]);
  });
});
