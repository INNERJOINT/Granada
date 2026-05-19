#!/usr/bin/env node
// Hook: InstructionsLoaded
// Fires: when a CLAUDE.md or .claude/rules/*.md file is loaded into context
// Decision control: None (exit code is ignored)

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
  // InstructionsLoaded-specific
  file_path,          // path to the loaded instructions file
  memory_type,        // type of memory file (e.g. "claude_md", "rules")
  load_reason,        // why it was loaded (e.g. "session_start", "lazy_load")
  globs,              // glob patterns that triggered the load (optional)
  trigger_file_path,  // file that triggered lazy loading (optional)
  parent_file_path,   // parent file that imported this one (optional)
} = input;

// --- Business logic example ---
// Log which instruction files are loaded and when
fs.appendFileSync('/tmp/claude-instructions.log',
  `[${new Date().toISOString()}] Loaded: ${file_path} (reason: ${load_reason}, type: ${memory_type})\n`);

// Track loaded files for debugging
if (globs) {
  fs.appendFileSync('/tmp/claude-instructions.log',
    `  Triggered by globs: ${JSON.stringify(globs)}\n`);
}
if (trigger_file_path) {
  fs.appendFileSync('/tmp/claude-instructions.log',
    `  Trigger file: ${trigger_file_path}\n`);
}

// --- Decision control ---
// NONE. Exit code is completely ignored.
// This event is purely informational — used for logging/monitoring
// which instruction files are being loaded into context.

process.exit(0);
