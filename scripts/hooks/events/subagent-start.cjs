#!/usr/bin/env node
// Hook: SubagentStart
// Fires: when a subagent is spawned
// Decision control: None (exit 2 shows stderr to user only)
//                   Supports additionalContext and env (like SessionStart)

const fs = require('fs');
const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));

// --- Input fields ---
const {
  session_id,
  transcript_path,
  cwd,
  permission_mode,
  hook_event_name,
  // SubagentStart-specific
  agent_id,    // unique identifier for this subagent
  agent_type,  // agent name (e.g. "Explore", "security-reviewer", custom name)
} = input;

// --- Business logic example ---
// Log subagent spawns for monitoring
fs.appendFileSync('/tmp/claude-subagents.log',
  `[${new Date().toISOString()}] START ${agent_type} (${agent_id})\n`);

// Inject context for the subagent
const output = {
  hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext: `Subagent ${agent_type} started. Working directory: ${cwd}`,
    env: {
      PARENT_SESSION_ID: session_id,
      AGENT_TYPE: agent_type,
    },
  },
};

process.stdout.write(JSON.stringify(output));

// --- Decision control ---
// No blocking capability. Supports:
// - hookSpecificOutput.additionalContext: inject context for the subagent
// - hookSpecificOutput.env: persist env vars for the subagent's session

process.exit(0);
