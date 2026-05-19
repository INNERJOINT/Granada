#!/usr/bin/env node
// Hook: CwdChanged
// Fires: when the working directory changes (e.g. Claude executes a cd command)
// Decision control: None (exit 2 shows stderr to user only)
//                   Supports watchPaths output for FileChanged registration

const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

// --- Input fields ---
const {
  session_id,
  transcript_path,
  cwd,
  hook_event_name,
  agent_id,
  agent_type,
  // CwdChanged-specific
  old_cwd,  // previous working directory
  new_cwd,  // new working directory
} = input;

// --- Business logic example ---
// Log directory changes
fs.appendFileSync('/tmp/claude-cwd.log',
  `[${new Date().toISOString()}] cd: ${old_cwd} -> ${new_cwd}\n`);

// Register file watchers for the new directory (e.g. for direnv-like behavior)
const path = require('path');
const envFile = path.join(new_cwd, '.env');
const watchPaths = [];
if (fs.existsSync(envFile)) {
  watchPaths.push(envFile);
}

const output = {
  hookSpecificOutput: {
    hookEventName: 'CwdChanged',
    watchPaths,  // register these paths for FileChanged events
  },
};

process.stdout.write(JSON.stringify(output));

// --- Decision control ---
// No blocking capability. Supports:
// - hookSpecificOutput.watchPaths: register file paths for FileChanged events
// - hookSpecificOutput.additionalContext: inject context for Claude
// Exit 2 shows stderr to user only (non-blocking)

process.exit(0);
