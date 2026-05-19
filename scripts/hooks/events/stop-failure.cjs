#!/usr/bin/env node
// Hook: StopFailure
// Fires: when the turn ends due to an API error
// Decision control: None — output and exit code are ignored

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
  // StopFailure-specific
  error,                  // error message string
  error_details,          // additional error details (optional)
  last_assistant_message, // Claude's last response before the error (optional)
} = input;

// --- Business logic example ---
// Log API errors for monitoring
const logEntry = {
  timestamp: new Date().toISOString(),
  session_id,
  error,
  error_details: error_details || null,
  last_message_preview: last_assistant_message
    ? last_assistant_message.slice(0, 200)
    : null,
};
fs.appendFileSync('/tmp/claude-api-errors.log', JSON.stringify(logEntry) + '\n');

// Send notification on repeated failures (example: write to a webhook)
// No decision control — this event is purely for side effects

// --- Decision control ---
// NONE. Output and exit code are completely ignored.
// This event exists solely for logging/monitoring/alerting.

process.exit(0);
