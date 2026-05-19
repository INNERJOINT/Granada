#!/usr/bin/env node
// Hook: UserPromptExpansion
// Fires: when a user-typed command expands into a prompt (e.g. slash commands)
// Decision control: exit 2 blocks the expansion
//                   JSON decision:"block" also blocks with reason

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
  // UserPromptExpansion-specific
  command_name,     // the slash command name (e.g. "review")
  original_command, // the full command as typed by user
  expanded_prompt,  // the expanded prompt text that will be sent to Claude
} = input;

// --- Business logic example ---
// Block certain command expansions in production branches
const { execSync } = require('child_process');
let branch = '';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
} catch (e) { /* not a git repo */ }

const blockedInProd = ['autopilot', 'ralph'];
if (branch === 'main' && blockedInProd.includes(command_name)) {
  process.stderr.write(`Blocked: /${command_name} is not allowed on the main branch`);
  process.exit(2);
}

// --- Decision control ---
// Option 1: exit 0 = allow expansion to proceed
// Option 2: exit 2 = block the expansion (stderr shown to user)
// Option 3: JSON decision:"block" with reason
// Option 4: JSON additionalContext = inject context alongside the expanded prompt

const output = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptExpansion',
    additionalContext: `Command /${command_name} expanded on branch: ${branch}`,
  },
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
