import { describe, it, expect } from 'vitest';
import { runHook, baseInput } from './helper.js';

describe('ConfigChange', () => {
  it('exits 0 for normal config changes', async () => {
    const input = baseInput('ConfigChange', {
      source: 'user_settings',
      file_path: '~/.claude/settings.json',
    });
    const { exitCode, json } = await runHook('config-change.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('InstructionsLoaded', () => {
  it('exits 0 (no decision control)', async () => {
    const input = baseInput('InstructionsLoaded', {
      file_path: '/project/CLAUDE.md',
      memory_type: 'claude_md',
      load_reason: 'session_start',
    });
    const { exitCode, json } = await runHook('instructions-loaded.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('CwdChanged', () => {
  it('returns watchPaths output', async () => {
    const input = baseInput('CwdChanged', {
      old_cwd: '/tmp',
      new_cwd: '/home/user/project',
    });
    const { exitCode, json } = await runHook('cwd-changed.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('CwdChanged');
    expect(json.hookSpecificOutput.watchPaths).toBeInstanceOf(Array);
  });
});

describe('FileChanged', () => {
  it('returns additionalContext for package.json changes', async () => {
    const input = baseInput('FileChanged', {
      file_path: 'package.json',
      event: 'change',
    });
    const { exitCode, json } = await runHook('file-changed.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.additionalContext).toContain('npm install');
  });

  it('exits 0 with no output for unmatched files', async () => {
    const input = baseInput('FileChanged', {
      file_path: 'README.md',
      event: 'change',
    });
    const { exitCode, json } = await runHook('file-changed.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('Notification', () => {
  it('returns terminalSequence for desktop notification', async () => {
    const input = baseInput('Notification', {
      notification_type: 'info',
      message: 'Task complete',
      title: 'Claude',
    });
    const { exitCode, json } = await runHook('notification.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.terminalSequence).toContain('777;notify');
  });
});

describe('PreCompact', () => {
  it('exits 0 when no lock file exists', async () => {
    const input = baseInput('PreCompact', { trigger: 'auto' });
    const { exitCode } = await runHook('pre-compact.cjs', input);
    expect(exitCode).toBe(0);
  });
});

describe('PostCompact', () => {
  it('exits 0 with no output', async () => {
    const input = baseInput('PostCompact', {
      trigger: 'auto',
      compact_summary: 'Compacted 50 messages into summary.',
    });
    const { exitCode, json } = await runHook('post-compact.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('Elicitation', () => {
  it('auto-accepts OAuth for trusted servers', async () => {
    const input = baseInput('Elicitation', {
      mcp_server_name: 'github',
      message: 'Authorize access?',
      mode: 'oauth',
      url: 'https://github.com/login/oauth',
    });
    const { exitCode, json } = await runHook('elicitation.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.action).toBe('accept');
  });

  it('exits 0 with no output for unknown servers without oauth', async () => {
    const input = baseInput('Elicitation', {
      mcp_server_name: 'custom_server',
      message: 'Enter your name',
    });
    const { exitCode, json } = await runHook('elicitation.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('ElicitationResult', () => {
  it('exits 0 with no output for normal responses', async () => {
    const input = baseInput('ElicitationResult', {
      mcp_server_name: 'github',
      action: 'accept',
      content: { confirm: true },
    });
    const { exitCode, json } = await runHook('elicitation-result.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('WorktreeRemove', () => {
  it('exits 0 even when worktree does not exist', async () => {
    const input = baseInput('WorktreeRemove', {
      worktree_path: '/tmp/nonexistent-worktree-xyz',
    });
    const { exitCode } = await runHook('worktree-remove.cjs', input);
    expect(exitCode).toBe(0);
  });
});

describe('WorktreeCreate', () => {
  it('exits non-zero when git worktree creation fails (non-git cwd)', async () => {
    const input = baseInput('WorktreeCreate', { name: 'test-wt' });
    const { exitCode } = await runHook('worktree-create.cjs', input);
    expect(exitCode).not.toBe(0);
  });
});
