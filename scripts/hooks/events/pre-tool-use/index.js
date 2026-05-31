const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bgit\s+push\s+.*--force/,
  /\bdrop\s+database\b/i,
  /\bgit\s+reset\s+--hard\b/,
];

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

const CONFIG_FILE_PATTERN = /\.(env|config|ya?ml)$/;

function denyDangerousBash(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  const cmd = (toolInput && toolInput.command) || '';
  for (const pattern of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Blocked dangerous command: ${cmd.slice(0, 100)}`,
        },
      };
    }
  }
  return null;
}

function allowReadOnly(toolName) {
  if (!READ_ONLY_TOOLS.has(toolName)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Read-only operation auto-approved',
    },
  };
}

function npmPublishDryRun(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  const cmd = (toolInput && toolInput.command) || '';
  if (!/npm publish/.test(cmd)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Added --dry-run to npm publish',
      updatedInput: {
        command: cmd.replace('npm publish', 'npm publish --dry-run'),
        description: toolInput.description,
        timeout: toolInput.timeout,
      },
    },
  };
}

function askConfigWrite(toolName, toolInput) {
  if (toolName !== 'Write') return null;
  const filePath = (toolInput && toolInput.file_path) || '';
  if (!CONFIG_FILE_PATTERN.test(filePath)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `Writing to config file: ${filePath}`,
    },
  };
}

export function handlePreToolUseHook(input, _deps) {
  const safeInput = input || {};
  const { tool_name: toolName, tool_input: toolInput } = safeInput;

  const decisions = [
    () => denyDangerousBash(toolName, toolInput),
    () => allowReadOnly(toolName),
    () => npmPublishDryRun(toolName, toolInput),
    () => askConfigWrite(toolName, toolInput),
  ];

  for (const decide of decisions) {
    const output = decide();
    if (output) return output;
  }

  return null;
}
