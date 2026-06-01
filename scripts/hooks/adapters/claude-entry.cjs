#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');

const ROUTES = Object.freeze({
  PostToolUse: Object.freeze({
    'translate-artifact': '../handlers/post-tool-use/translate-artifact.js',
  }),
});

function parseInput(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

function sanitizeWarning(message) {
  return String(message || 'hook failed')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, 500);
}

function warningOutput(eventName, message) {
  return {
    hookSpecificOutput: {
      hookEventName: eventName || 'PostToolUse',
      additionalContext: `hook warning: ${sanitizeWarning(message)}`,
    },
  };
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function resolveRoute(eventName, handlerName) {
  const eventRoutes = ROUTES[eventName];
  if (!eventRoutes) return null;
  return eventRoutes[handlerName || 'index'] || null;
}

async function main() {
  const input = parseInput(fs.readFileSync(0, 'utf8'));
  if (!input) return;

  const handlerName = process.argv[2];
  const route = resolveRoute(input.hook_event_name, handlerName);
  if (!route) return;

  const [{ createLogger }, handlerModule] = await Promise.all([
    import('../shared/logger.js'),
    import(route),
  ]);

  const output = await handlerModule.handle(input, {
    fs,
    spawn,
    env: process.env,
    cwd: process.cwd(),
    skillPathArg: process.argv[3],
    pid: process.pid,
    now: Date.now,
    logger: createLogger({
      env: process.env,
      stderr: process.stderr,
      prefix: `granada:${input.hook_event_name}:${handlerName || 'index'}`,
    }),
  });

  if (output !== null && output !== undefined) writeJson(output);
}

main().catch(error => {
  writeJson(warningOutput('PostToolUse', error instanceof Error ? error.message : String(error)));
});
