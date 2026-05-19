#!/usr/bin/env node
// Hook: PreToolUse
// Fires: before a tool call executes
// Decision control: richest of all hooks — allow/deny/ask/defer via hookSpecificOutput
//   - permissionDecision: "allow" | "deny" | "ask" | "defer"
//   - updatedInput: modify tool input before execution
//   - additionalContext: inject context for Claude
// Multiple hooks conflict resolution: deny > defer > ask > allow

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
  effort,           // { level: "low"|"medium"|"high"|"xhigh"|"max" }
  // PreToolUse-specific
  tool_name,        // "Bash" | "Write" | "Edit" | "Read" | "Glob" | "Grep" | "WebFetch" | "WebSearch" | "Agent" | "AskUserQuestion" | "ExitPlanMode" | "mcp__<server>__<tool>"
  tool_input,       // tool-specific input object (varies by tool_name)
  tool_use_id,      // unique ID for this tool call
} = input;

// --- Tool input shapes by tool_name ---
// Bash:            { command: string, description?: string, timeout?: number }
// Write:           { file_path: string, content: string }
// Edit:            { file_path: string, old_string: string, new_string: string }
// Read:            { file_path: string, offset?: number, limit?: number }
// Glob:            { pattern, path?: string }
// Grep:            { pattern: string, path?: string, include?: string }
// WebFetch:        { url: string }
// WebSearch:       { query: string }
// Agent:           { prompt: string, subagent_type?: string, model?: string }
// AskUserQuestion: { questions: [...], answers?: {...} }
// ExitPlanMode:    { plan: string }

// --- Business logic example ---
// Block dangerous Bash commands
if (tool_name === 'Bash') {
  const cmd = tool_input.command || '';
  const dangerous = [
    /\brm\s+-rf\s+\//,       // rm -rf /
    /\bgit\s+push\s+.*--force/,
    /\bdrop\s+database\b/i,
    /\bgit\s+reset\s+--hard\b/,
  ];
  for (const pattern of dangerous) {
    if (pattern.test(cmd)) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Blocked dangerous command: ${cmd.slice(0, 100)}`,
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }
  }
}

// Auto-approve read-only operations
if (tool_name === 'Read' || tool_name === 'Glob' || tool_name === 'Grep') {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Read-only operation auto-approved',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// Modify tool input example: force --dry-run on npm publish
if (tool_name === 'Bash' && /npm publish/.test(tool_input.command || '')) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Added --dry-run to npm publish',
      updatedInput: {
        command: tool_input.command.replace('npm publish', 'npm publish --dry-run'),
        description: tool_input.description,
        timeout: tool_input.timeout,
      },
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// Escalate to user for Write operations on config files
if (tool_name === 'Write' && /\.(env|config|ya?ml)$/.test(tool_input.file_path || '')) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `Writing to config file: ${tool_input.file_path}`,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// --- Decision control summary ---
// {
//   hookSpecificOutput: {
//     hookEventName: "PreToolUse",
//     permissionDecision: "allow"|"deny"|"ask"|"defer",
//     permissionDecisionReason: "string (deny→shown to Claude, allow/ask→shown to user)",
//     updatedInput: { ...modified tool input (replaces entire input object) },
//     additionalContext: "string injected into Claude's context",
//   }
// }
//
// "defer" — only works in non-interactive mode (-p flag)
//   Process exits with stop_reason:"tool_deferred", caller resumes later
//   Only works for single tool calls (not batches)

// Default: allow without explicit decision (no output needed)
process.exit(0);
