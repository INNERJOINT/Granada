#!/usr/bin/env node
// Hook: TeammateIdle
// Fires: when an agent team teammate is about to go idle
// Decision control: exit 2 prevents the teammate from going idle (continues working)
//                   JSON continue:false stops the teammate entirely

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
  // TeammateIdle-specific
  teammate_name,  // name of the teammate about to go idle
  team_name,      // name of the team
} = input;

// --- Business logic example ---
// Keep a teammate working if there are pending tasks
const pendingTasksFile = '/tmp/claude-pending-tasks.json';
let hasPending = false;
try {
  const tasks = JSON.parse(fs.readFileSync(pendingTasksFile, 'utf8'));
  hasPending = tasks.some(t => t.assignee === teammate_name && t.status !== 'done');
} catch (e) { /* no task file */ }

if (hasPending) {
  process.stderr.write(`${teammate_name} still has pending tasks, preventing idle`);
  process.exit(2);  // Prevents teammate from going idle
}

// --- Decision control ---
// Option 1: exit 0 = allow teammate to go idle
// Option 2: exit 2 = prevent idle (teammate continues working), stderr as feedback
// Option 3: JSON { continue: false, stopReason: "..." } = stop the teammate entirely
//
// {
//   "continue": false,
//   "stopReason": "All work complete, teammate can shut down"
// }

process.exit(0);
