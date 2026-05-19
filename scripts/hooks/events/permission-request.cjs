#!/usr/bin/env node
// Hook: PermissionRequest
// Fires: when a permission dialog is about to be shown to the user
// Decision control: hookSpecificOutput.decision.behavior = "allow"|"deny"
//   Can also modify input, apply permission rules, or interrupt Claude

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
  // PermissionRequest-specific
  tool_name,              // the tool requesting permission
  tool_input,             // the tool's input parameters
  permission_suggestions, // array of "always allow" options the user would see
  // permission_suggestions shape:
  // [{ type: "addRules", rules: [{toolName, ruleContent?}], behavior: "allow"|"deny"|"ask", destination: "localSettings"|"projectSettings"|"userSettings"|"session" }]
} = input;

// --- Business logic example ---
// Auto-approve git status/log/diff commands
if (tool_name === 'Bash') {
  const cmd = tool_input.command || '';
  const safeGitCmds = /^git\s+(status|log|diff|branch|show|remote|tag)/;
  if (safeGitCmds.test(cmd)) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
        },
        // Optionally persist the rule so user isn't prompted again
        updatedPermissions: [{
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'git status *' }],
          behavior: 'allow',
          destination: 'session',
        }],
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  // Auto-deny dangerous commands
  if (/rm\s+-rf\s+\//.test(cmd)) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Destructive filesystem operations are blocked by policy',
          interrupt: false,  // set true to stop Claude entirely
        },
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
}

// Allow with modified input
if (tool_name === 'Bash' && /npm publish/.test(tool_input.command || '')) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'allow',
        updatedInput: {
          command: tool_input.command + ' --dry-run',
          description: tool_input.description,
        },
      },
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// --- Decision control ---
// {
//   hookSpecificOutput: {
//     hookEventName: "PermissionRequest",
//     decision: {
//       behavior: "allow" | "deny",
//       updatedInput: { ... },           // allow only: modify tool input
//       message: "string",               // deny only: shown to Claude
//       interrupt: true|false,           // deny only: stop Claude entirely
//     },
//     updatedPermissions: [              // allow only: persist permission rules
//       {
//         type: "addRules"|"replaceRules"|"removeRules"|"setMode"|"addDirectories"|"removeDirectories",
//         rules: [{ toolName: "Bash", ruleContent: "git *" }],
//         behavior: "allow"|"deny"|"ask",
//         destination: "session"|"localSettings"|"projectSettings"|"userSettings",
//       }
//     ],
//   }
// }

// Default: no output = show the permission dialog to user as normal
process.exit(0);
