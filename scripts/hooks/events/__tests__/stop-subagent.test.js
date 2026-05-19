import { describe, it, expect } from 'vitest';
import { runHook, baseInput } from './helper.js';

describe('Stop', () => {
  it('blocks when changes made without tests', async () => {
    const input = baseInput('Stop', {
      stop_hook_active: false,
      last_assistant_message: 'I wrote the new component to src/Button.tsx.',
    });
    const { exitCode, json } = await runHook('stop.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.decision).toBe('block');
    expect(json.reason).toContain('test');
  });

  it('allows stop when tests were run', async () => {
    const input = baseInput('Stop', {
      stop_hook_active: false,
      last_assistant_message: 'I wrote the component and ran jest tests. All passing.',
    });
    const { exitCode, json } = await runHook('stop.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });

  it('allows stop when no changes were made', async () => {
    const input = baseInput('Stop', {
      stop_hook_active: false,
      last_assistant_message: 'Here is the explanation you asked for.',
    });
    const { exitCode, json } = await runHook('stop.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('StopFailure', () => {
  it('exits 0 with no output (side-effect only)', async () => {
    const input = baseInput('StopFailure', {
      error: 'API timeout',
      error_details: 'Connection reset',
      last_assistant_message: 'partial response',
    });
    const { exitCode, json } = await runHook('stop-failure.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('SubagentStart', () => {
  it('returns additionalContext and env', async () => {
    const input = baseInput('SubagentStart', {
      agent_id: 'agent-001',
      agent_type: 'Explore',
    });
    const { exitCode, json } = await runHook('subagent-start.cjs', input);
    expect(exitCode).toBe(0);
    expect(json.hookSpecificOutput.hookEventName).toBe('SubagentStart');
    expect(json.hookSpecificOutput.env.AGENT_TYPE).toBe('Explore');
  });
});

describe('SubagentStop', () => {
  it('exits 0 for completed subagents', async () => {
    const input = baseInput('SubagentStop', {
      agent_id: 'agent-001',
      agent_type: 'Explore',
      agent_transcript_path: '/tmp/agent.jsonl',
      stop_hook_active: false,
      last_assistant_message: 'Search complete. Found 3 results.',
    });
    const { exitCode, json } = await runHook('subagent-stop.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('TeammateIdle', () => {
  it('exits 0 when no pending tasks', async () => {
    const input = baseInput('TeammateIdle', {
      teammate_name: 'worker-1',
      team_name: 'dev-team',
    });
    const { exitCode, json } = await runHook('teammate-idle.cjs', input);
    expect(exitCode).toBe(0);
    expect(json).toBeNull();
  });
});

describe('TaskCreated', () => {
  it('exits 0 for normal task creation', async () => {
    const input = baseInput('TaskCreated', {
      task_id: 'task-001',
      task_subject: 'Fix login bug',
      task_description: 'Users cannot log in',
    });
    const { exitCode } = await runHook('task-created.cjs', input);
    expect(exitCode).toBe(0);
  });
});

describe('TaskCompleted', () => {
  it('exits 0 for non-implementation tasks', async () => {
    const input = baseInput('TaskCompleted', {
      task_id: 'task-001',
      task_subject: 'Research options',
    });
    const { exitCode } = await runHook('task-completed.cjs', input);
    expect(exitCode).toBe(0);
  });
});
