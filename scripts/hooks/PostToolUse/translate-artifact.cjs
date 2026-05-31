#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');

function parseInput(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

function sanitizeWarning(message) {
  return String(message || 'translation failed')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, 500);
}

function warningOutput(message) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `markdown translation warning: ${sanitizeWarning(message)}`,
    },
  };
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

async function main() {
  const input = parseInput(fs.readFileSync(0, 'utf8'));
  const [{ createLogger }, { handleTranslateArtifactHook }] = await Promise.all([
    import('../shared/logger.js'),
    import('../events/post-tool-use/translate-artifact/index.js'),
  ]);
  const output = await handleTranslateArtifactHook(input, {
    fs,
    spawn,
    env: process.env,
    cwd: process.cwd(),
    skillPathArg: process.argv[2],
    pid: process.pid,
    now: Date.now,
    logger: createLogger({
      env: process.env,
      stderr: process.stderr,
      prefix: 'granada:translate-artifact',
    }),
  });

  if (output !== null && output !== undefined) writeJson(output);
}

main().catch(error => {
  writeJson(warningOutput(error instanceof Error ? error.message : String(error)));
});
