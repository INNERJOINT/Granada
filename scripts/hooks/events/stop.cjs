#!/usr/bin/env node
// Hook: Stop
// Fires: when Claude finishes responding
// Decision control: exit 2 prevents Claude from stopping (continues conversation)
//                   JSON decision:"block" also prevents stopping

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
  effort,
  // Stop-specific
  stop_hook_active,       // boolean — true if a Stop hook is already preventing stop
  last_assistant_message, // Claude's last response text
} = input;

// --- Business logic example ---
// Prevent stopping if Claude hasn't run tests after making changes
if (!stop_hook_active && last_assistant_message) {
  const madeChanges = /\b(wrote|edited|created|modified|updated)\b/i.test(last_assistant_message);
  const ranTests = /\b(test|spec|jest|vitest|pytest|cargo test)\b/i.test(last_assistant_message);

  if (madeChanges && !ranTests) {
    const output = {
      decision: 'block',
      reason: 'You made code changes but did not run tests. Please run the test suite before finishing.',
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
}

// --- Decision control ---
// Option 1: exit 0 = allow Claude to stop normally
// Option 2: exit 2 = prevent stopping, Claude continues the conversation
// Option 3: JSON decision:"block" + reason = prevent stopping with reason shown to Claude
//
// {
//   decision: "block",
//   reason: "string shown to Claude explaining why it should continue"
// }
//
// Note: stop_hook_active prevents infinite loops — if already true,
// another Stop hook is already active, so be careful not to block again

process.exit(0);
