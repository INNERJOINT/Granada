#!/usr/bin/env node
// Hook: UserPromptSubmit
// Fires: when user submits a prompt, before Claude processes it
// Decision control: exit 2 blocks prompt processing and erases the prompt
//                   JSON decision:"block" also blocks with reason

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
  // UserPromptSubmit-specific
  prompt,  // the user's submitted prompt text
} = input;

// --- Business logic example ---
// Block prompts that contain sensitive patterns
const blockedPatterns = [
  /password\s*[:=]\s*\S+/i,
  /api[_-]?key\s*[:=]\s*\S+/i,
  /secret\s*[:=]\s*\S+/i,
];

for (const pattern of blockedPatterns) {
  if (pattern.test(prompt)) {
    process.stderr.write(`Blocked: prompt appears to contain a secret (matched ${pattern})`);
    process.exit(2);  // Blocks prompt processing, erases the prompt
  }
}

// --- Decision control ---
// Option 1: exit 0 with no output = allow prompt to proceed
// Option 2: exit 2 = block prompt (stderr shown to Claude as error)
// Option 3: JSON with decision:"block" = block with reason
// Option 4: JSON with additionalContext = inject context alongside the prompt

const output = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: `User prompt submitted at ${new Date().toISOString()}`,
  },
};

process.stdout.write(JSON.stringify(output));
process.exit(0);
