#!/usr/bin/env node
// Hook: TaskCreated
// Fires: when a task is being created via TaskCreate
// Decision control: exit 2 rolls back the task creation
//                   JSON continue:false also stops the teammate

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
  // TaskCreated-specific
  task_id,            // unique task identifier
  task_subject,      // task title/subject
  task_description,  // task description (optional)
  teammate_name,     // assigned teammate (optional)
  team_name,         // team name (optional)
} = input;

// --- Business logic example ---
// Limit the number of concurrent tasks
const maxTasks = 10;
const taskLogFile = '/tmp/claude-active-tasks.json';
let activeTasks = [];
try {
  activeTasks = JSON.parse(fs.readFileSync(taskLogFile, 'utf8'));
} catch (e) { activeTasks = []; }

if (activeTasks.length >= maxTasks) {
  process.stderr.write(`Task limit reached (${maxTasks}). Complete existing tasks before creating new ones.`);
  process.exit(2);  // Rolls back task creation
}

// Track the new task
activeTasks.push({ task_id, task_subject, created_at: new Date().toISOString() });
fs.writeFileSync(taskLogFile, JSON.stringify(activeTasks, null, 2));

// --- Decision control ---
// Option 1: exit 0 = allow task creation
// Option 2: exit 2 = roll back task creation (stderr as feedback)
// Option 3: JSON { continue: false, stopReason: "..." } = stop the teammate entirely

process.exit(0);
