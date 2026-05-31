#!/usr/bin/env node
'use strict';

const fs = require('fs');

// Fixed map prevents input-controlled import paths.
const EVENT_IMPORTS = {
  PreToolUse: './pre-tool-use/index.js',
  'pre-tool-use': './pre-tool-use/index.js',
};

async function main() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(1);
  }

  const eventName = input && input.hook_event_name;
  const importTarget = EVENT_IMPORTS[eventName] || EVENT_IMPORTS.PreToolUse;

  const slice = await import(importTarget);
  const handler = slice.handlePreToolUseHook;
  const output = await handler(input, {});

  if (output !== null && output !== undefined) {
    process.stdout.write(JSON.stringify(output));
  }
  process.exit(0);
}

main().catch(() => {
  process.exit(1);
});
