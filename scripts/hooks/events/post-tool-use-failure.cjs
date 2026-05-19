#!/usr/bin/env node
// Hook: PostToolUseFailure
// Fires: after a tool call fails
// Decision control: top-level decision:"block" stops the agentic loop
//                   exit 2 = non-blocking (shows stderr to Claude)
//                   additionalContext injects info for Claude

const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

// --- Input fields ---
const {
  session_id,
  transcript_path,
  cwd,
  permission_mode,
  agent_id,
  agent_type,
  hook_event_name,
  effort,
  // PostToolUseFailure-specific
  tool_name,        // the tool that failed
  tool_input,       // the input that was passed to the tool
  tool_use_id,      // unique ID for this tool call
  error,            // error message string
  is_interrupt,     // boolean — true if failure was due to user interrupt
} = input;

// --- Business logic example ---
// Log all tool failures for debugging
const logEntry = {
  timestamp: new Date().toISOString(),
  tool_name,
  tool_input,
  error,
  is_interrupt,
  session_id,
};
fs.appendFileSync('/tmp/claude-tool-failures.log', JSON.stringify(logEntry) + '\n');

// If a build command failed, inject helpful context
if (tool_name === 'Bash' && /\b(build|compile|tsc)\b/.test(tool_input.command || '')) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: 'Build failed. Check for type errors and missing imports before retrying.',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// Stop processing if too many failures in this session
// (In practice you'd track this in a file or env var)

// --- Decision control ---
// Option 1: exit 0 = no action (tool already failed, execution continues)
// Option 2: exit 2 = non-blocking, stderr shown to Claude
// Option 3: JSON decision:"block" + reason = stops the agentic loop
// Option 4: JSON hookSpecificOutput.additionalContext = inject context
//
// {
//   decision: "block",
//   reason: "Too many failures, stopping execution"
// }

process.exit(0);
