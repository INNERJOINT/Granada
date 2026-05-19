#!/usr/bin/env node
// Hook: SubagentStop
// Fires: when a subagent finishes
// Decision control: exit 2 prevents the subagent from stopping
//                   JSON decision:"block" also prevents stopping

const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

// --- Input fields ---
const {
  session_id,
  transcript_path,
  cwd,
  permission_mode,
  hook_event_name,
  effort,
  // SubagentStop-specific
  agent_id,                // unique identifier for this subagent
  agent_type,              // agent name (e.g. "Explore", "security-reviewer")
  agent_transcript_path,   // path to the subagent's transcript
  stop_hook_active,        // boolean — true if a stop hook is already active
  last_assistant_message,  // subagent's last response text
} = input;

// --- Business logic example ---
// Log subagent completion
fs.appendFileSync('/tmp/claude-subagents.log',
  `[${new Date().toISOString()}] STOP ${agent_type} (${agent_id})\n`);

// Prevent stopping if the subagent didn't complete its task
if (!stop_hook_active && agent_type === 'executor') {
  const incomplete = last_assistant_message &&
    /\b(TODO|not yet|incomplete|WIP)\b/i.test(last_assistant_message);
  if (incomplete) {
    const output = {
      decision: 'block',
      reason: 'Executor subagent has incomplete work. Continue until all tasks are done.',
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
}

// --- Decision control ---
// Option 1: exit 0 = allow subagent to stop normally
// Option 2: exit 2 = prevent subagent from stopping (continues working)
// Option 3: JSON decision:"block" + reason = prevent stopping with reason
//
// Note: In skill frontmatter, Stop hooks are auto-converted to SubagentStop

process.exit(0);
