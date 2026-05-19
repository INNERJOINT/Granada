#!/usr/bin/env node
// Hook: Notification
// Fires: when Claude Code sends a notification
// Decision control: None (exit 2 shows stderr to user only)

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
  // Notification-specific
  message,            // notification message text
  title,              // notification title (optional)
  notification_type,  // type of notification
} = input;

// --- Business logic example ---
// Forward notifications to a desktop notification system
const output = {
  // Use terminalSequence to emit a desktop notification
  terminalSequence: `\x1b]777;notify;${title || 'Claude Code'};${message}\x07`,
};

process.stdout.write(JSON.stringify(output));

// Also log to file
fs.appendFileSync('/tmp/claude-notifications.log',
  `[${new Date().toISOString()}] [${notification_type}] ${title || ''}: ${message}\n`);

// --- Decision control ---
// No blocking capability. Supports:
// - terminalSequence: emit desktop notifications via terminal escape sequences
// - systemMessage: show a warning to the user
// Exit 2 shows stderr to user only (non-blocking)

process.exit(0);
