#!/usr/bin/env node
// Hook: TaskCompleted
// Fires: when a task is being marked as completed
// Decision control: exit 2 prevents the task from being marked as completed
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
  // TaskCompleted-specific
  task_id,            // unique task identifier
  task_subject,       // task title/subject
  task_description,   // task description (optional)
  teammate_name,      // assigned teammate (optional)
  team_name,          // team name (optional)
} = input;

// --- Business logic example ---
// Verify task completion by checking if tests pass
if (task_subject && /\b(implement|fix|refactor)\b/i.test(task_subject)) {
  const { execSync } = require('child_process');
  try {
    execSync('npm test --silent 2>/dev/null', { cwd, timeout: 30000 });
  } catch (e) {
    process.stderr.write(`Cannot mark task "${task_subject}" complete: tests are failing`);
    process.exit(2);  // Prevents task from being marked as completed
  }
}

// Remove from active tasks tracking
const taskLogFile = '/tmp/claude-active-tasks.json';
try {
  let tasks = JSON.parse(fs.readFileSync(taskLogFile, 'utf8'));
  tasks = tasks.filter(t => t.task_id !== task_id);
  fs.writeFileSync(taskLogFile, JSON.stringify(tasks, null, 2));
} catch (e) { /* no task file */ }

// --- Decision control ---
// Option 1: exit 0 = allow task to be marked complete
// Option 2: exit 2 = prevent completion (stderr as feedback to Claude)
// Option 3: JSON { continue: false, stopReason: "..." } = stop the teammate entirely

process.exit(0);
