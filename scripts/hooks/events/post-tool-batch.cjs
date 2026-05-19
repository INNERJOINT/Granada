#!/usr/bin/env node
// Hook: PostToolBatch
// Fires: after a full batch of parallel tool calls resolves, before the next model call
// Decision control: exit 2 stops the agentic loop before the next model call
//                   JSON decision:"block" also stops with reason

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
  effort,
  // PostToolBatch-specific
  tool_results,  // array of results from the batch
  // Each element: { tool_name, tool_use_id, tool_input, tool_response?, error? }
} = input;

// --- Business logic example ---
// Check if any tool in the batch failed and stop if critical
const failures = (tool_results || []).filter(r => r.error);
const criticalFailure = failures.some(f =>
  f.tool_name === 'Bash' && /\b(build|compile)\b/.test(f.tool_input?.command || '')
);

if (criticalFailure) {
  const output = {
    decision: 'block',
    reason: `Build failed in batch. Fix errors before continuing. Failures: ${failures.map(f => f.tool_name).join(', ')}`,
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// Inject summary context about the batch
const summary = (tool_results || []).map(r =>
  `${r.tool_name}${r.error ? ' (FAILED)' : ''}`
).join(', ');

const output = {
  hookSpecificOutput: {
    hookEventName: 'PostToolBatch',
    additionalContext: `Batch completed: ${summary}`,
  },
};

process.stdout.write(JSON.stringify(output));

// --- Decision control ---
// Option 1: exit 0 = continue to next model call
// Option 2: exit 2 = stop the agentic loop (stderr shown to Claude)
// Option 3: JSON decision:"block" + reason = stop with reason
// Option 4: JSON hookSpecificOutput.additionalContext = inject context
//
// {
//   decision: "block",
//   reason: "string shown to Claude"
// }

process.exit(0);
