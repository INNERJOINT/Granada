#!/usr/bin/env node
// Hook: FileChanged
// Fires: when a watched file changes on disk
// Decision control: None (exit 2 shows stderr to user only)
//                   Supports watchPaths and additionalContext output

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
  // FileChanged-specific
  file_path,  // path to the file that changed
  event,      // type of change: 'change' | 'create' | 'delete'
} = input;

// Business logic example ---
// React to package.json changes
if (file_path.endsWith('package.json') && event === 'change') {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'FileChanged',
      additionalContext: `package.json was modified externally. You may need to run npm install.`,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// React to .env file changes (direnv-like behavior)
if (file_path.endsWith('.env') && event !== 'delete') {
  try {
    const envContent = fs.readFileSync(file_path, 'utf8');
    const vars = envContent.split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=')[0])
      .join(', ');
    const output = {
      hookSpecificOutput: {
        hookEventName: 'FileChanged',
        additionalContext: `Environment file changed. Updated vars: ${vars}`,
      },
    };
    process.stdout.write(JSON.stringify(output));
  } catch (e) { /* ignore read errors */ }
  process.exit(0);
}

// --- Decision control ---
// No blocking capability. Supports:
// - hookSpecificOutput.additionalContext: inject context for Claude
// - hookSpecificOutput.watchPaths: update watched file list
// Exit 2 shows stderr to user only (non-blocking)
//
// Note: The matcher field in the hook config specifies which filenames to watch.
// FileChanged only fires for files registered via watchPaths from
// SessionStart, CwdChanged, or FileChanged hooks.

process.exit(0);
