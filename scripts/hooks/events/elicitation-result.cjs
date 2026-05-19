#!/usr/bin/env node
// Hook: ElicitationResult
// Fires: after a user responds to an MCP elicitation, before the response is sent back
// Decision control: hookSpecificOutput.action can override the user's response
//                   exit 2 blocks the response (action becomes decline)

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
  // ElicitationResult-specific
  mcp_server_name,  // name of the MCP server
  elicitation_id,   // unique ID for this elicitation (optional)
  mode,             // elicitation mode (optional)
  action,           // user's chosen action: "accept" | "decline" | "cancel"
  content,          // user's form field values (optional, present when action="accept")
} = input;

// --- Business logic example ---
// Audit all elicitation responses
fs.appendFileSync('/tmp/claude-elicitation-audit.log',
  `[${new Date().toISOString()}] ${mcp_server_name}: action=${action} content=${JSON.stringify(content || {})}\n`);

// Override: block sensitive data from being sent to certain servers
if (action === 'accept' && content) {
  const sensitiveFields = ['password', 'token', 'secret', 'api_key'];
  const hasSensitive = Object.keys(content).some(k =>
    sensitiveFields.some(s => k.toLowerCase().includes(s))
  );
  if (hasSensitive) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'ElicitationResult',
        action: 'decline',  // override user's accept to decline
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
}

// Modify content before sending (e.g. sanitize or transform)
if (action === 'accept' && content && content.email) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'ElicitationResult',
      action: 'accept',
      content: {
        ...content,
        email: content.email.toLowerCase().trim(),  // normalize email
      },
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// --- Decision control ---
// Option 1: exit 0 with no output = send user's response as-is
// Option 2: exit 2 = block the response (action becomes decline)
// Option 3: JSON hookSpecificOutput to override:
//
// {
//   hookSpecificOutput: {
//     hookEventName: "ElicitationResult",
//     action: "accept" | "decline" | "cancel",
//     content: { ... }  // override form field values
//   }
// }

process.exit(0);
