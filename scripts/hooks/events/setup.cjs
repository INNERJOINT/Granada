#!/usr/bin/env node
// Hook: Setup
// Fires: when Claude Code starts with --init-only, or with --init/--maintenance in -p mode
// Decision control: No blocking (exit 2 shows stderr to user only)
// Purpose: one-time preparation in CI or scripts

const fs = require('fs');
const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));

// --- Input fields ---
const {
  session_id,
  transcript_path,
  cwd,
  permission_mode,
  agent_id,
  agent_type,
  hook_event_name,
  // Setup-specific
  trigger,  // 'init' | 'maintenance'
} = input;

// --- Business logic example ---
if (trigger === 'init') {
  // First-time setup: install dependencies, create directories, etc.
  fs.appendFileSync('/tmp/claude-setup.log',
    `[${new Date().toISOString()}] Init setup in ${cwd}\n`);
} else if (trigger === 'maintenance') {
  // Periodic maintenance: clean caches, update indexes, etc.
  fs.appendFileSync('/tmp/claude-setup.log',
    `[${new Date().toISOString()}] Maintenance run in ${cwd}\n`);
}

// --- Decision control ---
// Setup supports additionalContext and env (same as SessionStart)
const output = {
  hookSpecificOutput: {
    hookEventName: 'Setup',
    additionalContext: `Setup completed (trigger: ${trigger})`,
    env: {
      SETUP_COMPLETED: 'true',
      SETUP_TRIGGER: trigger,
    },
  },
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
