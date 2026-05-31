import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runHook, baseInput } from './helper.js';

describe('PreToolUse', () => {
  it('exits 0 with allow for read-only tools', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.js' },
      tool_use_id: 'tu_001',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(json.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('denies dangerous rm -rf / commands', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      tool_use_id: 'tu_002',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('asks for config file writes', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: '/project/.env', content: 'KEY=val' },
      tool_use_id: 'tu_003',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('allows and modifies npm publish with --dry-run', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'npm publish' },
      tool_use_id: 'tu_004',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(json.hookSpecificOutput.updatedInput.command).toContain('--dry-run');
  });

  it('exits 0 with no output for normal Bash commands', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_use_id: 'tu_005',
    });
    const { exitCode, json } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('PreToolUse ESM slice (direct handler)', () => {
  const sliceUrl = pathToFileURL(
    resolve(import.meta.dirname, '../pre-tool-use/index.js'),
  ).href;

  it('denies dangerous Bash commands without IO', async () => {
    const { handlePreToolUseHook } = await import(sliceUrl);
    const output = handlePreToolUseHook(
      baseInput('PreToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
        tool_use_id: 'tu_d_001',
      }),
      {},
    );
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('rm -rf /');
  });

  it('allows read-only tools', async () => {
    const { handlePreToolUseHook } = await import(sliceUrl);
    for (const tool of ['Read', 'Glob', 'Grep']) {
      const output = handlePreToolUseHook(
        baseInput('PreToolUse', {
          tool_name: tool,
          tool_input: { file_path: '/tmp/x' },
          tool_use_id: `tu_d_${tool}`,
        }),
        {},
      );
      expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
    }
  });

  it('asks before writes to config files', async () => {
    const { handlePreToolUseHook } = await import(sliceUrl);
    const output = handlePreToolUseHook(
      baseInput('PreToolUse', {
        tool_name: 'Write',
        tool_input: { file_path: '/project/app.yaml', content: 'k: v' },
        tool_use_id: 'tu_d_002',
      }),
      {},
    );
    expect(output.hookSpecificOutput.permissionDecision).toBe('ask');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('app.yaml');
  });

  it('mutates npm publish input with --dry-run', async () => {
    const { handlePreToolUseHook } = await import(sliceUrl);
    const output = handlePreToolUseHook(
      baseInput('PreToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'npm publish', description: 'release', timeout: 60 },
        tool_use_id: 'tu_d_003',
      }),
      {},
    );
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(output.hookSpecificOutput.updatedInput.command).toBe('npm publish --dry-run');
    expect(output.hookSpecificOutput.updatedInput.description).toBe('release');
    expect(output.hookSpecificOutput.updatedInput.timeout).toBe(60);
  });

  it('returns null for normal Bash commands (no-output sentinel)', async () => {
    const { handlePreToolUseHook } = await import(sliceUrl);
    const output = handlePreToolUseHook(
      baseInput('PreToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
        tool_use_id: 'tu_d_004',
      }),
      {},
    );
    expect(output).toBeNull();
  });

  it('exports only handlePreToolUseHook from the slice', async () => {
    const slice = await import(sliceUrl);
    const exported = Object.keys(slice).filter((k) => k !== 'default');
    expect(exported).toEqual(['handlePreToolUseHook']);
    expect(typeof slice.handlePreToolUseHook).toBe('function');
    expect(slice.default).toBeUndefined();
  });

  it('imports without side effects (no stdout/stderr, no exit)', async () => {
    const probeScript = `
      const chunks = { stdout: '', stderr: '' };
      const origStdout = process.stdout.write.bind(process.stdout);
      const origStderr = process.stderr.write.bind(process.stderr);
      const origExit = process.exit;
      process.stdout.write = (chunk) => { chunks.stdout += String(chunk); return true; };
      process.stderr.write = (chunk) => { chunks.stderr += String(chunk); return true; };
      process.exit = (code) => { chunks.exited = code; };
      import(${JSON.stringify(sliceUrl)}).then((m) => {
        process.stdout.write = origStdout;
        process.stderr.write = origStderr;
        process.exit = origExit;
        origStdout(JSON.stringify({
          stdout: chunks.stdout,
          stderr: chunks.stderr,
          exited: chunks.exited ?? null,
          exportNames: Object.keys(m).filter((k) => k !== 'default'),
        }));
      });
    `;
    const { spawn } = await import('node:child_process');
    const result = await new Promise((res) => {
      const child = spawn('node', ['--input-type=module', '-e', probeScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => res({ stdout, stderr, code }));
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const probe = JSON.parse(result.stdout);
    expect(probe.stdout).toBe('');
    expect(probe.stderr).toBe('');
    expect(probe.exited).toBeNull();
    expect(probe.exportNames).toEqual(['handlePreToolUseHook']);
  });
});

describe('PreToolUse wrapper contract', () => {
  it('produces empty stdout and silent stderr for null handler output', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'echo wrapper' },
      tool_use_id: 'tu_w_001',
    });
    const { exitCode, stdout, stderr } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  it('serializes decision objects exactly to stdout JSON', async () => {
    const input = baseInput('PreToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/exact.js' },
      tool_use_id: 'tu_w_002',
    });
    const { exitCode, stdout, stderr } = await runHook('pre-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Read-only operation auto-approved',
      },
    });
  });

  it('exits non-zero with empty stdout when input is not valid JSON', async () => {
    const { exitCode, stdout, json } = await runHook('pre-tool-use.cjs', '{not json');
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe('');
    expect(json).toBeNull();
  });
});

describe('PostToolUse', () => {
  it('exits 0 with no output for normal tool results', async () => {
    const input = baseInput('PostToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: 'test.js' },
      tool_response: 'file content',
      tool_use_id: 'tu_010',
    });
    const { exitCode, json } = await runHook('post-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });

  it('warns about generated files', async () => {
    const input = baseInput('PostToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: '/project/dist/bundle.min.js', content: 'x' },
      tool_response: 'ok',
      tool_use_id: 'tu_011',
    });
    const { exitCode, json } = await runHook('post-tool-use.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('generated');
  });
});

describe('plugin PostToolUse hook manifest', () => {
  function matchesClaudeWildcard(pattern, value) {
    const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\'\"]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 's').test(value);
  }

  it('registers the translate-artifact hook with a packaged script path', () => {
    const manifestPath = resolve(import.meta.dirname, '../../../../hooks/hooks.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.hooks.PostToolUse[0];
    const hook = entry.hooks[0];

    expect(entry.matcher).toBe('Write');
    expect(hook.type).toBe('command');
    expect(hook.if).toBe('Write(*/.granada/*.md)');
    expect(hook.command).toBe('node');
    expect(hook.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/PostToolUse/translate-artifact.cjs']);
    expect(hook.timeout).toBe(360);
    expect(existsSync(resolve(import.meta.dirname, '../../PostToolUse/translate-artifact.cjs'))).toBe(true);
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
    return runHook('../PostToolUse/translate-artifact.cjs', input, {
      cwd,
      args: ['skills/translate-md-zh/SKILL.md'],
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

  it('imports translation slice without side effects', async () => {
    const sliceUrl = pathToFileURL(resolve(import.meta.dirname, '../post-tool-use/translate-artifact/index.js')).href;
    const probeScript = `
      const chunks = { stdout: '', stderr: '' };
      const origStdout = process.stdout.write.bind(process.stdout);
      const origStderr = process.stderr.write.bind(process.stderr);
      const origExit = process.exit;
      process.stdout.write = (chunk) => { chunks.stdout += String(chunk); return true; };
      process.stderr.write = (chunk) => { chunks.stderr += String(chunk); return true; };
      process.exit = (code) => { chunks.exited = code; };
      import(${JSON.stringify(sliceUrl)}).then((m) => {
        process.stdout.write = origStdout;
        process.stderr.write = origStderr;
        process.exit = origExit;
        origStdout(JSON.stringify({
          stdout: chunks.stdout,
          stderr: chunks.stderr,
          exited: chunks.exited ?? null,
          exportNames: Object.keys(m).filter((k) => k !== 'default'),
        }));
      });
    `;
    const { spawn } = await import('node:child_process');
    const result = await new Promise((res) => {
      const child = spawn('node', ['--input-type=module', '-e', probeScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => res({ stdout, stderr, code }));
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const probe = JSON.parse(result.stdout);
    expect(probe.stdout).toBe('');
    expect(probe.stderr).toBe('');
    expect(probe.exited).toBeNull();
    expect(probe.exportNames).toEqual(['handleTranslateArtifactHook']);
  });

  it('writes zh sibling for eligible export writes', async () => {
    const cwd = makeProject();
    const source = join(cwd, '.granada', 'aosp-exports', 'feature.md');
    writeFileSync(source, '# English\n\nHello', 'utf8');

    const { exitCode, stderr } = await runHook('../PostToolUse/translate-artifact.cjs', makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      cwd,
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

    const { exitCode, json } = await runHook('../PostToolUse/translate-artifact.cjs', makeExportInput(cwd, '.granada/aosp-exports/feature.md'), {
      cwd,
      args: ['../SKILL.md'],
      env: { TRANSLATE_MD_ZH_MOCK_TEXT: 'translated' },
    });

    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('invalid SKILL.md path argument');
    expect(existsSync(join(cwd, '.granada', 'aosp-exports', 'feature_zh.md'))).toBe(false);
  });

  it('handles malformed input without throwing', async () => {
    const { exitCode, json, stderr } = await runHook('../PostToolUse/translate-artifact.cjs', '{bad json');
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
    expect(stderr).toBe('');
  });
});

describe('PostToolUseFailure', () => {
  it('injects context for build failures', async () => {
    const input = baseInput('PostToolUseFailure', {
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' },
      tool_use_id: 'tu_020',
      error: 'exit code 1',
      is_interrupt: false,
    });
    const { exitCode, json } = await runHook('post-tool-use-failure.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('PostToolUseFailure');
    expect(json.hookSpecificOutput.additionalContext).toContain('Build failed');
  });

  it('exits 0 with no output for non-build failures', async () => {
    const input = baseInput('PostToolUseFailure', {
      tool_name: 'Read',
      tool_input: { file_path: 'missing.js' },
      tool_use_id: 'tu_021',
      error: 'file not found',
      is_interrupt: false,
    });
    const { exitCode, json } = await runHook('post-tool-use-failure.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('PostToolBatch', () => {
  it('returns additionalContext summarizing the batch', async () => {
    const input = baseInput('PostToolBatch', {
      tool_results: [
        { tool_name: 'Read', tool_use_id: 'tu1', tool_input: { file_path: 'a.js' }, tool_response: 'ok' },
        { tool_name: 'Grep', tool_use_id: 'tu2', tool_input: { pattern: 'foo' }, tool_response: 'found' },
      ],
    });
    const { exitCode, json } = await runHook('post-tool-batch.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('Read');
    expect(json.hookSpecificOutput.additionalContext).toContain('Grep');
  });

  it('blocks on critical build failures', async () => {
    const input = baseInput('PostToolBatch', {
      tool_results: [
        { tool_name: 'Bash', tool_use_id: 'tu1', tool_input: { command: 'npm run build' }, error: 'exit 1' },
      ],
    });
    const { exitCode, json } = await runHook('post-tool-batch.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.decision).toBe('block');
    expect(json.reason).toContain('Build failed');
  });
});
