#!/usr/bin/env node
// Hook: Elicitation
// Fires: when an MCP server requests user input during a tool call
// Decision control: hookSpecificOutput.action = "accept"|"decline"|"cancel"
//                   exit 2 denies the elicitation

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
  // Elicitation-specific
  mcp_server_name,   // name of the MCP server requesting input
  message,           // message/prompt from the MCP server
  mode,              // elicitation mode (optional, e.g. "oauth")
  url,               // URL associated with the elicitation (optional, e.g. OAuth URL)
  elicitation_id,    // unique ID for this elicitation (optional)
  requested_schema,  // JSON schema for expected response fields (optional)
} = input;

// --- Business logic example ---
// Auto-accept OAuth flows for trusted servers
const trustedServers = ['github', 'gitlab', 'atlassian'];
if (mode === 'oauth' && trustedServers.includes(mcp_server_name)) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'Elicitation',
      action: 'accept',
      content: {},  // form field values (empty for OAuth redirect)
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// Auto-decline elicitations from untrusted servers
const blockedServers = ['unknown_server'];
if (blockedServers.includes(mcp_server_name)) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'Elicitation',
      action: 'decline',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// Auto-fill form fields based on schema
if (requested_schema && requested_schema.properties) {
  const content = {};
  // Example: auto-fill known fields
  if (requested_schema.properties.username) {
    content.username = process.env.USER || 'developer';
  }
  if (requested_schema.properties.confirm) {
    content.confirm = true;
  }
  if (Object.keys(content).length > 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'Elicitation',
        action: 'accept',
        content,
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
}

// --- Decision control ---
// Option 1: exit 0 with no output = show elicitation to user normally
// Option 2: exit 2 = deny the elicitation
// Option 3: JSON hookSpecificOutput with action:
//
// {
//   hookSpecificOutput: {
//     hookEventName: "Elicitation",
//     action: "accept",    // accept with form values
//     content: { field_name: "value", ... }
//   }
// }
// OR
// {
//   hookSpecificOutput: {
//     hookEventName: "Elicitation",
//     action: "decline"    // politely decline
//   }
// }
// OR
// {
//   hookSpecificOutput: {
//     hookEventName: "Elicitation",
//     action: "cancel"     // cancel the entire operation
//   }
// }

process.exit(0);
