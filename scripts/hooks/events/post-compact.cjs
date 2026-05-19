#!/usr/bin/env node
// Hook: PostCompact
// Fires: after context compaction completes
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
  // PostCompact-specific
  trigger,          // what triggered compaction (e.g. "auto", "manual")
  compact_summary,  // the compaction summary text
} = input;

// --- Business logic example ---
// Log compaction events with summary preview
const preview = compact_summary
  ? compact_summary.slice(0, 300)
  : '(no summary)';

fs.appendFileSync('/tmp/claude-compaction.log',
  `[${new Date().toISOString()}] Compacted (trigger: ${trigger})\n  Summary: ${preview}\n`);

// Restore state that was saved in PreCompact
const stateFile = '/tmp/claude-pre-compact-state.json';
if (fs.existsSync(stateFile)) {
  try {
    const preState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    fs.appendFileSync('/tmp/claude-compaction.log',
      `  Pre-compact state restored from: ${preState.timestamp}\n`);
  } catch (e) { /* ignore */ }
}

// --- Decision control ---
// NONE. Exit 2 shows stderr to user only (non-blocking).
// This event is for post-compaction side effects:
// - Restoring state
// - Logging
// - Notifying external systems

process.exit(0);
