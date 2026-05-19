#!/usr/bin/env node
// Hook: PermissionDenied
// Fires: when a tool call is denied by the auto mode classifier
// Decision control: hookSpecificOutput.retry = true tells model it may retry
//                   Exit code and stderr are ignored (denial already occurred)

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
  // PermissionDenied-specific
  tool_name,    // the tool that was denied
  tool_input,   // the input that was attempted
  tool_use_id,  // unique ID for this tool call
  reason,       // why it was denied
} = input;

// --- Business logic example ---
// Log denied operations for audit
const logEntry = {
  timestamp: new Date().toISOString(),
  tool_name,
  tool_input,
  reason,
  session_id,
};
fs.appendFileSync('/tmp/claude-permission-denied.log', JSON.stringify(logEntry) + '\n');

// Allow retry for certain safe operations that were incorrectly denied
const retryable = (
  tool_name === 'Bash' &&
  /^(ls|cat|echo|pwd|which|type|file)\b/.test(tool_input.command || '')
);

if (retryable) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PermissionDenied',
      retry: true,  // tells the model it may retry the denied tool call
    },
  };
  process.stdout.write(JSON.stringify(output));
}

// --- Decision control ---
// Only one option: { hookSpecificOutput: { hookEventName: "PermissionDenied", retry: true } }
// - retry: true = model may retry the denied tool call
// - Exit code and stderr are ignored (denial already occurred)
// - No blocking capability (the denial already happened)

process.exit(0);
