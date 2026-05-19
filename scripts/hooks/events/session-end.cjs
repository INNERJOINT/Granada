#!/usr/bin/env node
// Hook: SessionEnd
// Fires: when a session terminates
// Decision control: None (used for side effects like logging or cleanup)

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
  // SessionEnd-specific
  reason,  // 'clear' | 'resume' | 'logout' | 'prompt_input_exit' | 'other' | 'bypass_permissions_disabled'
} = input;

// --- Business logic example ---
const logLine = `[${new Date().toISOString()}] Session ended: ${session_id} (reason: ${reason})\n`;
fs.appendFileSync('/tmp/claude-sessions.log', logLine);

// No decision control available for SessionEnd
// Exit 0 to indicate success
process.exit(0);
