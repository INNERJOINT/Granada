#!/usr/bin/env node
// Hook: SessionStart
// Fires: when a session begins or resumes
// Decision control: No blocking (exit 2 shows stderr to user only)
// Special: only hook event that receives `model` field; supports env var persistence

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
  // SessionStart-specific
  source,       // 'startup' | 'resume' | 'clear' | 'compact'
  model,        // model name (only present on SessionStart)
} = input;

// --- Business logic example ---
// Log session start info for debugging
const logLine = `[${new Date().toISOString()}] Session ${source}: ${session_id} (model: ${model || 'unknown'})\n`;
fs.appendFileSync('/tmp/claude-sessions.log', logLine);

// --- Decision control ---
// SessionStart supports:
// 1. additionalContext: inject context for Claude at conversation start
// 2. initialUserMessage: prepend a message before the user's first prompt
// 3. env: persist environment variables for the session
// 4. watchPaths: register file paths for FileChanged events

const output = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    // Inject context Claude will see as a system reminder
    additionalContext: `Session started at ${new Date().toISOString()}. Working directory: ${cwd}`,
    // Persist env vars for the entire session (all hooks and Bash tool inherit these)
    env: {
      PROJECT_ROOT: cwd,
      SESSION_SOURCE: source,
    },
    // Watch specific files for changes (triggers FileChanged events)
    // watchPaths: ['package.json', 'tsconfig.json'],
  },
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
