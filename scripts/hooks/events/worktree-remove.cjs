#!/usr/bin/env node
// Hook: WorktreeRemove
// Fires: when a worktree is being removed (session exit or subagent finish)
// Decision control: None — failures are logged in debug mode only

const fs = require('fs');
const { execSync } = require('child_process');
const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));

// --- Input fields ---
const {
  session_id,
  transcript_path,
  cwd,
  hook_event_name,
  agent_id,
  agent_type,
  // WorktreeRemove-specific
  worktree_path,  // path to the worktree being removed
} = input;

// --- Business logic example ---
// Clean up the worktree and its branch
try {
  // Remove the git worktree
  execSync(`git worktree remove "${worktree_path}" --force`, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Optionally delete the branch
  const branchName = worktree_path.split('/').pop();
  try {
    execSync(`git branch -D "worktree/${branchName}"`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) { /* branch may not exist or have different name */ }

  fs.appendFileSync('/tmp/claude-worktrees.log',
    `[${new Date().toISOString()}] Removed worktree: ${worktree_path}\n`);
} catch (e) {
  // Failures are only logged in debug mode
  process.stderr.write(`Worktree removal warning: ${e.message}`);
}

// --- Decision control ---
// NONE. Failures are logged in debug mode only.
// This hook is for cleanup side effects (removing branches, cleaning caches, etc.)

process.exit(0);
