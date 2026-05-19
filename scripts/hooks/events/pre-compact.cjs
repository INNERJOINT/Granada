#!/usr/bin/env node
// Hook: PreCompact
// Fires: before context compaction
// Decision control: exit 2 blocks compaction
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
  // PreCompact-specific
  trigger,               // what triggered compaction (e.g. "auto", "manual")
  custom_instructions,   // custom compaction instructions (optional)
} = input;

// --- Business logic example ---
// Save important state before compaction wipes context
const stateFile = '/tmp/claude-pre-compact-state.json';
const state = {
  timestamp: new Date().toISOString(),
  session_id,
  trigger,
  cwd,
};
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

// Block compaction if in the middle of a critical operation
const lockFile = '/tmp/claude-no-compact.lock';
if (fs.existsSync(lockFile)) {
  const output = {
    decision: 'block',
    reason: 'Compaction blocked: critical operation in progress. Remove /tmp/claude-no-compact.lock when done.',
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// --- Decision control ---
// Option 1: exit 0 = allow compaction to proceed
// Option 2: exit 2 = block compaction (stderr shown to user)
// Option 3: JSON decision:"block" + reason = block with reason
//
// {
//   decision: "block",
//   reason: "string explaining why compaction should not happen"
// }

process.exit(0);
