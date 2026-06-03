import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { runHook, baseInput } from './helper.js';

describe('plugin PostToolUse hook manifest', () => {
  function matchesClaudeWildcard(pattern, value) {
    const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\'\"]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 's').test(value);
  }

  it('registers translate-artifact and timestamp-artifact hooks with the generic adapter path', () => {
    const manifestPath = resolve(import.meta.dirname, '../../../../hooks/hooks.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.hooks.PostToolUse[0];
    const [translateHook, timestampHook] = entry.hooks;

    expect(entry.hooks).toHaveLength(2);
    expect(entry.matcher).toBe('Write');
    for (const hook of entry.hooks) {
      expect(hook.type).toBe('command');
      expect(hook.if).toBe('Write(*/.granada/*.md)');
      expect(hook.command).toBe('node');
      expect(hook.args[0]).toBe('${CLAUDE_PLUGIN_ROOT}/scripts/hooks/adapters/claude-entry.cjs');
      expect(hook.timeout).toBe(360);
    }
    expect(translateHook.args[1]).toBe('translate-artifact');
    expect(timestampHook.args[1]).toBe('timestamp-artifact');
    expect(existsSync(resolve(import.meta.dirname, '../../../../scripts/hooks/adapters/claude-entry.cjs'))).toBe(true);
  });

  it('pre-filters markdown writes under .granada while leaving loop prevention to the hook script', () => {
    const rule = '*/.granada/*.md';

    expect(matchesClaudeWildcard(rule, '/repo/.granada/a.md')).toBe(true);
    expect(matchesClaudeWildcard(rule, '/repo/.granada/aosp-exports/feature.md')).toBe(true);
    expect(matchesClaudeWildcard(rule, '/repo/.granada/aosp-exports/nested/feature.md')).toBe(true);
    expect(matchesClaudeWildcard(rule, '/repo/.granada/aosp-exports/feature.txt')).toBe(false);
    expect(matchesClaudeWildcard(rule, '/repo/granada/aosp-exports/feature.md')).toBe(false);
    expect(matchesClaudeWildcard(rule, '/repo/.granada/aosp-exports/feature_zh.md')).toBe(true);
  });
});

describe('aosp-feature-export translation hook', () => {
  function makeExportInput(cwd, filePath, toolResponse = 'ok') {
    return baseInput('PostToolUse', {
      cwd,
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: '# English\n\nHello' },
      tool_response: toolResponse,
      tool_use_id: 'tu_export',
    });
  }

  function makeBareProject() {
    const cwd = mkdtempSync(join(tmpdir(), 'granada-hook-'));
    mkdirSync(join(cwd, '.granada', 'aosp-exports'), { recursive: true });
    return cwd;
  }

  function makeProject(frontmatter = 'translate-dirs: [.granada/aosp-exports]') {
    const cwd = makeBareProject();
    mkdirSync(join(cwd, 'skills', 'translate-md-zh'), { recursive: true });
    mkdirSync(join(cwd, 'skills', 'aosp-feature-export'), { recursive: true });
    writeFileSync(join(cwd, 'skills', 'translate-md-zh', 'SKILL.md'), `---\n${frontmatter}\n---\n\n# Translate\n`, 'utf8');
    writeFileSync(join(cwd, 'skills', 'aosp-feature-export', 'SKILL.md'), `---\n${frontmatter}\n---\n\n# AOSP Feature Export\n`, 'utf8');
    return cwd;
  }

  function runTranslationHook(cwd, input, options = {}) {
    return runHook('../adapters/claude-entry.cjs', input, {
      cwd,
      args: ['translate-artifact', 'skills/translate-md-zh/SKILL.md'],
      ...options,
    });
  }

  function runDefaultTranslationHook(cwd, input, options = {}) {
    return runHook('../adapters/claude-entry.cjs', input, {
      cwd,
      args: ['translate-artifact'],
      ...options,
    });
  }

  function translationDeps(cwd, env = {}, fsOverrides = {}) {
    return {
      fs: { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, readdirSync, ...fsOverrides },
      env,
      cwd,
      skillPathArg: 'skills/translate-md-zh/SKILL.md',
      pid: 123,
      now: () => 456,
      logger: { log() {} },
    };
  }

  it('defaults Claude translation command to no session persistence', async () => {
    const cwd = makeProject();
    const configUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/config.js')).href;
    const { readTranslationConfig } = await import(configUrl);

    const config = readTranslationConfig(cwd, translationDeps(cwd));

    expect(config.command).toBe('claude -p --model sonnet --no-session-persistence');
  });

  it('loads default translation config from the plugin root', async () => {
    const cwd = makeBareProject();
    const pluginRoot = resolve(import.meta.dirname, '../../../..');
    const configUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/config.js')).href;
    const { readTranslationConfig } = await import(configUrl);

    const config = readTranslationConfig(cwd, {
      ...translationDeps(cwd),
      pluginRoot,
      skillPathArg: undefined,
    });

    expect(config.dirs).toEqual(['.granada/aosp-exports']);
  });

  it('direct ESM handler writes zh sibling for eligible export writes', async () => {
    const cwd = makeProject();
    const source = join(cwd, '.granada', 'aosp-exports', 'feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/index.js')).href;
    const { handleTranslateArtifactHook } = await import(sliceUrl);

    const output = await handleTranslateArtifactHook(
      makeExportInput(cwd, '.granada/aosp-exports/feature.md'),
      translationDeps(cwd, { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文' }),
    );

    expect(output).toBeNull();
    expect(readFileSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'), 'utf8')).toBe('# 中文');
  });

  it('direct ESM handler returns a warning output for translation failures', async () => {
    const cwd = makeProject();
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature.md'), '# English', 'utf8');
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/index.js')).href;
    const { handleTranslateArtifactHook } = await import(sliceUrl);

    const output = await handleTranslateArtifactHook(
      makeExportInput(cwd, '.granada/aosp-exports/feature.md'),
      translationDeps(cwd, { GRANADA_TRANSLATE_COMMAND: 'claude -p; echo unsafe' }),
    );

    expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(output.hookSpecificOutput.additionalContext).toContain('unsafe shell metacharacters');
    expect(existsSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'))).toBe(false);
  });

  it('retries translation command failures three times before succeeding', async () => {
    vi.useFakeTimers();
    try {
      const cwd = makeProject();
      const commandUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/command.js')).href;
      const { translateWithCommand } = await import(commandUrl);
      let spawnCalls = 0;
      const spawn = () => {
        spawnCalls += 1;
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => {};
        queueMicrotask(() => {
          if (spawnCalls === 4) child.stdout.write('# 中文');
          child.stdout.end();
          child.stderr.end();
          child.emit('close', spawnCalls === 4 ? 0 : 1);
        });
        return child;
      };

      const result = translateWithCommand('# English', { dirs: ['.granada/aosp-exports'], command: 'claude -p', timeoutMs: 1000 }, {
        cwd,
        env: {},
        spawn,
      });
      await vi.advanceTimersByTimeAsync(15000);

      await expect(result).resolves.toBe('# 中文');
      expect(spawnCalls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exports only handleTranslateArtifactHook from the translation slice', async () => {
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/index.js')).href;
    const slice = await import(sliceUrl);
    const exported = Object.keys(slice).filter((k) => k !== 'default');
    expect(exported).toEqual(['handleTranslateArtifactHook']);
    expect(slice.default).toBeUndefined();
  });

  it('generic adapter writes zh sibling for eligible export writes', async () => {
    const cwd = makeProject();
    const source = join(cwd, '.granada', 'aosp-exports', 'feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');

    const { exitCode, stderr } = await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文\n\n你好' },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(readFileSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'), 'utf8')).toBe('# 中文\n\n你好');
  });

  it('generic adapter uses packaged skill config when no SKILL.md arg is passed', async () => {
    const cwd = makeBareProject();
    const source = join(cwd, '.granada', 'aosp-exports', 'feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');

    const { exitCode, stderr } = await runDefaultTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文\n\n你好' },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(readFileSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'), 'utf8')).toBe('# 中文\n\n你好');
  });

  it('direct ESM handler writes timestamped zh when timestamp runs before translate', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    const timestampedSource = join(exportsDir, '20260602-110405-feature.md');
    writeFileSync(timestampedSource, '# English\n\nHello', 'utf8');
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/index.js')).href;
    const { handleTranslateArtifactHook } = await import(sliceUrl);

    const output = await handleTranslateArtifactHook(
      makeExportInput(cwd, '.granada/aosp-exports/feature.md'),
      translationDeps(cwd, { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文' }),
    );

    expect(output).toBeNull();
    expect(readFileSync(timestampedSource, 'utf8')).toBe('# English\n\nHello');
    expect(readFileSync(join(exportsDir, '20260602-110405-feature_zh.md'), 'utf8')).toBe('# 中文');
    expect(existsSync(join(exportsDir, 'feature.md'))).toBe(false);
    expect(existsSync(join(exportsDir, 'feature_zh.md'))).toBe(false);
  });

  it('direct ESM handler compensates zh when timestamp runs during translate', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    const source = join(exportsDir, 'feature.md');
    const timestampedSource = join(exportsDir, '20260602-110405-feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/translate-artifact/index.js')).href;
    const { handleTranslateArtifactHook } = await import(sliceUrl);
    const fsOverrides = {
      writeFileSync(filePath, content, encoding) {
        writeFileSync(filePath, content, encoding);
        if (existsSync(source)) renameSync(source, timestampedSource);
      },
    };

    const output = await handleTranslateArtifactHook(
      makeExportInput(cwd, '.granada/aosp-exports/feature.md'),
      translationDeps(cwd, { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文' }, fsOverrides),
    );

    expect(output).toBeNull();
    expect(readFileSync(timestampedSource, 'utf8')).toBe('# English\n\nHello');
    expect(readFileSync(join(exportsDir, '20260602-110405-feature_zh.md'), 'utf8')).toBe('# 中文');
    expect(existsSync(source)).toBe(false);
    expect(existsSync(join(exportsDir, 'feature_zh.md'))).toBe(false);
  });

  it('writes GRANADA_DEBUG logs to stderr with level thresholds', async () => {
    const cwd = makeProject();
    const source = join(cwd, '.granada', 'aosp-exports', 'feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');

    const info = await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: { GRANADA_DEBUG: 'I', TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文' },
    });
    const debug = await runTranslationHook(cwd, makeExportInput(cwd, 'README.md'), {
      env: { GRANADA_DEBUG: 'D', TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文' },
    });
    const error = await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: {
        GRANADA_DEBUG: 'E',
        GRANADA_TRANSLATE_COMMAND: 'claude -p; echo unsafe',
      },
    });

    expect(info.exitCode).toBe(0);
    expect(info.stderr).toContain('[info] translate start source=');
    expect(info.stderr).toContain('[info] translate success source=');
    expect(debug.exitCode).toBe(0);
    expect(debug.stderr).toContain('[debug] skip reason=outside-translate-dirs');
    expect(error.exitCode).toBe(0);
    expect(error.stderr).toContain('[error] translate failed source=');
    expect(error.stderr).not.toContain('[info]');
    expect(error.stderr).not.toContain('[debug]');
  });

  it('uses tool_response.filePath before tool_input.file_path', async () => {
    const cwd = makeProject();
    const source = join(cwd, '.granada', 'aosp-exports', 'feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');

    const { exitCode } = await runTranslationHook(
      cwd,
      makeExportInput(cwd, 'README.md', { filePath: source, content: '# English\n\nHello' }),
      { env: { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文' } },
    );

    expect(exitCode).toBe(0);
    expect(readFileSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'), 'utf8')).toBe('# 中文');
    expect(existsSync(join(cwd, 'README_zh.md'))).toBe(false);
  });

  it('reads translate-dirs from skill frontmatter', async () => {
    const cwd = makeProject('translate-dirs: [docs]');
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'guide.md'), '# English', 'utf8');
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature.md'), '# English', 'utf8');

    await runTranslationHook(cwd, makeExportInput(cwd, 'docs/guide.md'), {
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: '指南' },
    });
    await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: '功能' },
    });

    expect(readFileSync(join(cwd, 'docs', 'guide_zh.md'), 'utf8')).toBe('指南');
    expect(existsSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'))).toBe(false);
  });

  it('invokes translate-command without a shell', async () => {
    const cwd = makeProject('translate-dirs: [.granada/aosp-exports]');
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature.md'), '# English', 'utf8');

    const { exitCode } = await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: { GRANADA_TRANSLATE_COMMAND: 'node -e "process.stdin.pipe(process.stdout)"' },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'), 'utf8')).toContain('Translate the following Markdown document');
  });

  it('overwrites existing zh sibling only on successful translation', async () => {
    const cwd = makeProject();
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature.md'), '# English', 'utf8');
    const target = join(cwd, '.granada', 'aosp-exports', 'feature_zh.md');
    writeFileSync(target, 'old', 'utf8');

    await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: 'new' },
    });
    expect(readFileSync(target, 'utf8')).toBe('new');

    await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), { env: {} });
    expect(readFileSync(target, 'utf8')).toBe('new');
  });

  it('ignores zh, partial, outside, and non-md writes', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    for (const file of ['feature_zh.md', 'feature-partial.md', 'feature.txt']) {
      writeFileSync(join(exportsDir, file), 'source', 'utf8');
      await runTranslationHook(cwd, makeExportInput(cwd, `.granada/aosp-exports/${file}`), {
        env: { TRANSLATE_MD_ZH_MOCK_TEXT: 'translated' },
      });
    }
    writeFileSync(join(cwd, 'README.md'), 'source', 'utf8');
    await runTranslationHook(cwd, makeExportInput(cwd, 'README.md'), {
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: 'translated' },
    });

    expect(existsSync(join(exportsDir, 'feature_zh_zh.md'))).toBe(false);
    expect(existsSync(join(exportsDir, 'feature-partial_zh.md'))).toBe(false);
    expect(existsSync(join(exportsDir, 'feature_zh.txt'))).toBe(false);
    expect(existsSync(join(cwd, 'README_zh.md'))).toBe(false);
  });

  it('rejects unsafe translate-command metacharacters', async () => {
    const cwd = makeProject('translate-dirs: [.granada/aosp-exports]');
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature.md'), '# English', 'utf8');

    const { exitCode, json } = await runTranslationHook(cwd, makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      env: { GRANADA_TRANSLATE_COMMAND: 'claude -p; echo unsafe' },
    });

    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('unsafe shell metacharacters');
    expect(existsSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'))).toBe(false);
  });

  it('rejects skill paths outside the project', async () => {
    const cwd = makeProject();
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature.md'), '# English', 'utf8');

    const { exitCode, json } = await runHook('../adapters/claude-entry.cjs', makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      cwd,
      args: ['translate-artifact', '../SKILL.md'],
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: 'translated' },
    });

    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('invalid SKILL.md path argument');
    expect(existsSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'))).toBe(false);
  });

  it('generic adapter exits quietly for malformed input and unknown routes', async () => {
    const cwd = makeProject();
    const unknown = await runHook('../adapters/claude-entry.cjs', makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      cwd,
      args: ['unknown-handler', 'skills/translate-md-zh/SKILL.md'],
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: '# 中文' },
    });
    const malformed = await runHook('../adapters/claude-entry.cjs', '{bad json', {
      cwd,
      args: ['translate-artifact', 'skills/translate-md-zh/SKILL.md'],
    });

    expect(unknown.exitCode).toBe(0);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toBe('');
    expect(malformed.exitCode).toBe(0);
    expect(malformed.stdout).toBe('');
    expect(malformed.stderr).toBe('');
  });

  function makeTimestampDeps(cwd, epochMs = Date.UTC(2026, 5, 2, 3, 4, 5), env = {}) {
    let nowCalls = 0;
    return {
      deps: {
        fs: { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, readdirSync },
        env,
        cwd,
        skillPathArg: 'skills/translate-md-zh/SKILL.md',
        pid: 123,
        now: () => {
          nowCalls += 1;
          return epochMs;
        },
        logger: { log() {} },
      },
      getNowCalls: () => nowCalls,
    };
  }

  async function importTimestampHook() {
    const url = pathToFileURL(resolve(import.meta.dirname, '../../../../dist/events/post-tool-use/timestamp-artifact/index.js')).href;
    return import(url);
  }

  it('generic adapter resolves the timestamp-artifact route', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    writeFileSync(join(exportsDir, 'feature.md'), '# English', 'utf8');

    const timestamp = await runHook('../adapters/claude-entry.cjs', makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      cwd,
      args: ['timestamp-artifact'],
    });

    expect(timestamp.exitCode).toBe(0);
    expect(timestamp.stderr).toBe('');
    expect(readdirSync(exportsDir).some(file => /^\d{8}-\d{6}-feature\.md$/.test(file))).toBe(true);
  });

  it('direct timestamp renames a source and zh sibling with one UTC+8 prefix', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    writeFileSync(join(exportsDir, 'feature.md'), '# English', 'utf8');
    writeFileSync(join(exportsDir, 'feature_zh.md'), '# 中文', 'utf8');
    const { handleTimestampArtifactHook } = await importTimestampHook();
    const { deps, getNowCalls } = makeTimestampDeps(cwd);

    const output = handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/feature.md'), deps);

    expect(output).toBeNull();
    expect(readFileSync(join(exportsDir, '20260602-110405-feature.md'), 'utf8')).toBe('# English');
    expect(readFileSync(join(exportsDir, '20260602-110405-feature_zh.md'), 'utf8')).toBe('# 中文');
    expect(existsSync(join(exportsDir, 'feature.md'))).toBe(false);
    expect(existsSync(join(exportsDir, 'feature_zh.md'))).toBe(false);
    expect(getNowCalls()).toBe(1);
  });

  it('direct timestamp succeeds when no zh sibling exists', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    writeFileSync(join(exportsDir, 'source-only.md'), '# English', 'utf8');
    const { handleTimestampArtifactHook } = await importTimestampHook();
    const { deps } = makeTimestampDeps(cwd);

    const output = handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/source-only.md'), deps);

    expect(output).toBeNull();
    expect(readFileSync(join(exportsDir, '20260602-110405-source-only.md'), 'utf8')).toBe('# English');
    expect(existsSync(join(exportsDir, 'source-only.md'))).toBe(false);
  });

  it('direct timestamp replaces only leading timestamp prefixes', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    writeFileSync(join(exportsDir, '20250101-120000-feature.md'), 'leading', 'utf8');
    writeFileSync(join(exportsDir, 'feature-20250101-120000.md'), 'middle', 'utf8');
    const { handleTimestampArtifactHook } = await importTimestampHook();
    const first = makeTimestampDeps(cwd);
    const second = makeTimestampDeps(cwd);

    handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/20250101-120000-feature.md'), first.deps);
    handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/feature-20250101-120000.md'), second.deps);

    expect(readFileSync(join(exportsDir, '20260602-110405-feature.md'), 'utf8')).toBe('leading');
    expect(readFileSync(join(exportsDir, '20260602-110405-feature-20250101-120000.md'), 'utf8')).toBe('middle');
    expect(existsSync(join(exportsDir, '20260602-110405-20250101-120000-feature.md'))).toBe(false);
  });

  it('direct timestamp skips non-candidate primary inputs without consuming the clock', async () => {
    const cwd = makeProject();
    mkdirSync(join(cwd, 'not.granada'), { recursive: true });
    const external = mkdtempSync(join(tmpdir(), 'granada-hook-external-'));
    mkdirSync(join(external, '.granada'), { recursive: true });
    const externalPath = join(external, '.granada', 'feature.md');
    writeFileSync(join(cwd, 'not.granada', 'feature.md'), 'outside', 'utf8');
    writeFileSync(externalPath, 'external', 'utf8');
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'), 'zh', 'utf8');
    writeFileSync(join(cwd, '.granada', 'aosp-exports', 'feature-partial.md'), 'partial', 'utf8');
    const { handleTimestampArtifactHook } = await importTimestampHook();
    const { deps, getNowCalls } = makeTimestampDeps(cwd);

    expect(handleTimestampArtifactHook(makeExportInput(cwd, 'not.granada/feature.md'), deps)).toBeNull();
    expect(handleTimestampArtifactHook(makeExportInput(cwd, externalPath), deps)).toBeNull();
    expect(handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/feature_zh.md'), deps)).toBeNull();
    expect(handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/feature-partial.md'), deps)).toBeNull();

    expect(readFileSync(join(cwd, 'not.granada', 'feature.md'), 'utf8')).toBe('outside');
    expect(readFileSync(externalPath, 'utf8')).toBe('external');
    expect(existsSync(join(external, '.granada', '20260602-110405-feature.md'))).toBe(false);
    expect(readFileSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'), 'utf8')).toBe('zh');
    expect(readFileSync(join(cwd, '.granada', 'aosp-exports', 'feature-partial.md'), 'utf8')).toBe('partial');
    expect(getNowCalls()).toBe(0);
  });

  it('direct timestamp honors tool_response.filePath before tool_input.file_path', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    const responsePath = join(exportsDir, 'response.md');
    writeFileSync(join(exportsDir, 'input.md'), 'input', 'utf8');
    writeFileSync(responsePath, 'response', 'utf8');
    const { handleTimestampArtifactHook } = await importTimestampHook();
    const { deps } = makeTimestampDeps(cwd);

    const output = handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/input.md', { filePath: responsePath }), deps);

    expect(output).toBeNull();
    expect(readFileSync(join(exportsDir, 'input.md'), 'utf8')).toBe('input');
    expect(readFileSync(join(exportsDir, '20260602-110405-response.md'), 'utf8')).toBe('response');
  });

  it('direct timestamp source destination collision renames nothing', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    writeFileSync(join(exportsDir, 'feature.md'), 'source', 'utf8');
    writeFileSync(join(exportsDir, 'feature_zh.md'), 'sibling', 'utf8');
    writeFileSync(join(exportsDir, '20260602-110405-feature.md'), 'existing', 'utf8');
    const { handleTimestampArtifactHook } = await importTimestampHook();
    const { deps } = makeTimestampDeps(cwd);

    const output = handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/feature.md'), deps);

    expect(output.hookSpecificOutput.additionalContext).toContain('destination already exists');
    expect(output.hookSpecificOutput.additionalContext).toContain('feature.md');
    expect(readFileSync(join(exportsDir, 'feature.md'), 'utf8')).toBe('source');
    expect(readFileSync(join(exportsDir, 'feature_zh.md'), 'utf8')).toBe('sibling');
    expect(readFileSync(join(exportsDir, '20260602-110405-feature.md'), 'utf8')).toBe('existing');
    expect(existsSync(join(exportsDir, '20260602-110405-feature_zh.md'))).toBe(false);
  });

  it('direct timestamp sibling destination collision renames nothing', async () => {
    const cwd = makeProject();
    const exportsDir = join(cwd, '.granada', 'aosp-exports');
    writeFileSync(join(exportsDir, 'feature.md'), 'source', 'utf8');
    writeFileSync(join(exportsDir, 'feature_zh.md'), 'sibling', 'utf8');
    writeFileSync(join(exportsDir, '20260602-110405-feature_zh.md'), 'existing sibling', 'utf8');
    const { handleTimestampArtifactHook } = await importTimestampHook();
    const { deps } = makeTimestampDeps(cwd);

    const output = handleTimestampArtifactHook(makeExportInput(cwd, '.granada/aosp-exports/feature.md'), deps);

    expect(output.hookSpecificOutput.additionalContext).toContain('destination already exists');
    expect(output.hookSpecificOutput.additionalContext).toContain('feature_zh.md');
    expect(readFileSync(join(exportsDir, 'feature.md'), 'utf8')).toBe('source');
    expect(readFileSync(join(exportsDir, 'feature_zh.md'), 'utf8')).toBe('sibling');
    expect(existsSync(join(exportsDir, '20260602-110405-feature.md'))).toBe(false);
    expect(readFileSync(join(exportsDir, '20260602-110405-feature_zh.md'), 'utf8')).toBe('existing sibling');
  });
});
