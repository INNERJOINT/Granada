#!/usr/bin/env node
// Hook: PostToolUse
// Fires: after a tool call succeeds
// Decision control: top-level decision:"block" (tool already ran, stderr shown to Claude)
//                   additionalContext injects info for Claude
//                   updatedMCPToolOutput can modify MCP tool results

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
  // PostToolUse-specific
  tool_name,        // same values as PreToolUse
  tool_input,       // the input that was passed to the tool
  tool_response,    // the tool's output/result
  tool_use_id,      // unique ID for this tool call
} = input;

// --- Business logic example ---
// After a Write/Edit, remind Claude about generated files
if ((tool_name === 'Write' || tool_name === 'Edit') && tool_input.file_path) {
  const generatedPatterns = [
    /\.generated\./,
    /\/generated\//,
    /\/dist\//,
    /\.min\.(js|css)$/,
  ];
  const isGenerated = generatedPatterns.some(p => p.test(tool_input.file_path));
  if (isGenerated) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `Warning: ${tool_input.file_path} appears to be a generated file. Edit the source instead.`,
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
}

// Block further processing if a test command failed
if (tool_name === 'Bash' && /\b(test|spec|jest|vitest|mocha)\b/.test(tool_input.command || '')) {
  const responseStr = typeof tool_response === 'string' ? tool_response : JSON.stringify(tool_response);
  if (/FAIL|ERROR|failed/i.test(responseStr)) {
    const output = {
      decision: 'block',
      reason: 'Tests failed. Fix the failing tests before continuing.',
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
}

// --- Decision control ---
// Option 1: exit 0 with no output = no action
// Option 2: exit 2 = non-blocking (tool already ran), stderr shown to Claude
// Option 3: JSON decision:"block" + reason = stops the agentic loop
// Option 4: JSON hookSpecificOutput.additionalContext = inject context
// Option 5: JSON hookSpecificOutput.updatedMCPToolOutput = modify MCP tool result
//
// {
//   decision: "block",
//   reason: "string shown to Claude"
// }
// OR
// {
//   hookSpecificOutput: {
//     hookEventName: "PostToolUse",
//     additionalContext: "string injected into Claude's context",
//     updatedMCPToolOutput: { ... }  // replaces MCP tool output
//   }
// }

process.exit(0);
