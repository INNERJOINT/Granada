import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runHook, baseInput } from './helper.js';

describe('plugin PostToolUse hook manifest', () => {
  function matchesClaudeWildcard(pattern, value) {
    const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\'\"]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 's').test(value);
  }

  it('registers the translate-artifact hook with the generic adapter path', () => {
    const manifestPath = resolve(import.meta.dirname, '../../../../hooks/hooks.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.hooks.PostToolUse[0];
    const hook = entry.hooks[0];

    expect(entry.matcher).toBe('Write');
    expect(hook.type).toBe('command');
    expect(hook.if).toBe('Write(*/.granada/*.md)');
    expect(hook.command).toBe('node');
    expect(hook.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/adapters/claude-entry.cjs', 'translate-artifact']);
    expect(hook.timeout).toBe(360);
    expect(existsSync(resolve(import.meta.dirname, '../../adapters/claude-entry.cjs'))).toBe(true);
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

  function makeProject(frontmatter = 'translate-dirs: [.granada/aosp-exports]') {
    const cwd = mkdtempSync(join(tmpdir(), 'granada-hook-'));
    mkdirSync(join(cwd, '.granada', 'aosp-exports'), { recursive: true });
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

  function translationDeps(cwd, env = {}) {
    return {
      fs: { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync },
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
    const configUrl = pathToFileURL(resolve(import.meta.dirname, '../post-tool-use/translate-artifact/config.js')).href;
    const { readTranslationConfig } = await import(configUrl);

    const config = readTranslationConfig(cwd, translationDeps(cwd));

    expect(config.command).toBe('claude -p --model sonnet --no-session-persistence');
  });

  it('direct ESM handler writes zh sibling for eligible export writes', async () => {
    const cwd = makeProject();
    const source = join(cwd, '.granada', 'aosp-exports', 'feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../post-tool-use/translate-artifact/index.js')).href;
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
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../post-tool-use/translate-artifact/index.js')).href;
    const { handleTranslateArtifactHook } = await import(sliceUrl);

    const output = await handleTranslateArtifactHook(
      makeExportInput(cwd, '.granada/aosp-exports/feature.md'),
      translationDeps(cwd, { GRANADA_TRANSLATE_COMMAND: 'claude -p; echo unsafe' }),
    );

    expect(output.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(output.hookSpecificOutput.additionalContext).toContain('unsafe shell metacharacters');
    expect(existsSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'))).toBe(false);
  });

  it('exports only handleTranslateArtifactHook from the translation slice', async () => {
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../post-tool-use/translate-artifact/index.js')).href;
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
        GRANADA_TRANSLATE_COMMAND: 'node -e "process.exit(1)"',
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
});
