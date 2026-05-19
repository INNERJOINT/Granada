#!/usr/bin/env node
// Hook: ConfigChange
// Fires: when a configuration file changes during a session
// Decision control: exit 2 blocks the configuration change from taking effect
//                   (except policy_settings which cannot be blocked)

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
  // ConfigChange-specific
  source,     // which config changed (e.g. "user_settings", "project_settings", "local_settings", "policy_settings")
  file_path,  // path to the changed config file (optional)
} = input;

// --- Business logic example ---
// Block changes to project settings from subagents
if (source === 'project_settings' && agent_id) {
  process.stderr.write('Subagents cannot modify project settings');
  process.exit(2);  // Blocks the config change
}

// Log config changes for audit
fs.appendFileSync('/tmp/claude-config-changes.log',
  `[${new Date().toISOString()}] Config changed: ${source} (${file_path || 'unknown path'})\n`);

// --- Decision control ---
// Option 1: exit 0 = allow config change to take effect
// Option 2: exit 2 = block the change (except policy_settings)
// Option 3: JSON decision:"block" + reason = block with reason
//
// {
//   decision: "block",
//   reason: "Config changes are locked during deployment"
// }
//
// Note: policy_settings changes CANNOT be blocked regardless of hook output

process.exit(0);
