#!/usr/bin/env node
// Hook: WorktreeCreate
// Fires: when a worktree is being created via --worktree or isolation:"worktree"
// Decision control: hook REPLACES default git behavior — must print worktree path on stdout
//                   Any non-zero exit code causes worktree creation to fail

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));

// --- Input fields ---
const {
  session_id,
  transcript_path,
  cwd,
  hook_event_name,
  agent_id,
  agent_type,
  // WorktreeCreate-specific
  name,  // requested worktree name/identifier
} = input;

// --- Business logic example ---
// Create a worktree with a custom naming convention and branch strategy
const worktreeBase = path.join(cwd, '..', '.worktrees');
const worktreePath = path.join(worktreeBase, `claude-${name}-${Date.now()}`);
const branchName = `worktree/${name}`;

try {
  // Ensure base directory exists
  fs.mkdirSync(worktreeBase, { recursive: true });

  // Create the git worktree
  execSync(`git worktree add -b "${branchName}" "${worktreePath}" HEAD`, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Output the worktree path — this is REQUIRED for success
  // Claude Code reads this path from stdout to know where the worktree is
  process.stdout.write(worktreePath);
  process.exit(0);
} catch (e) {
  process.stderr.write(`Failed to create worktree: ${e.message}`);
  process.exit(1);  // Any non-zero = creation fails
}

// --- Decision control ---
// This hook REPLACES the default worktree creation behavior.
// - stdout must contain the worktree path on success
// - For HTTP hooks: return hookSpecificOutput.worktreePath
// - Any non-zero exit code = worktree creation fails
// - Hook failure or missing path = creation fails
//
// {
//   hookSpecificOutput: {
//     hookEventName: "WorktreeCreate",
//     worktreePath: "/path/to/worktree"  // HTTP hook variant
//   }
// }
