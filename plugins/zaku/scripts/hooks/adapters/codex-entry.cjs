#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function sanitizeWarning(message) {
  return String(message || 'hook failed')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, 500);
}

function writeFallbackWarning(message) {
  process.stdout.write(JSON.stringify({
    systemMessage: `hook warning: ${sanitizeWarning(message)}`,
  }));
}

import('../../../dist/adapters/codex-entry.js')
  .then(({ main }) => main({
    argv: process.argv,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
    pluginRoot: path.resolve(__dirname, '../../..'),
    pid: process.pid,
    now: Date.now,
    spawn,
    fs,
  }))
  .catch(error => {
    writeFallbackWarning(error instanceof Error ? error.message : String(error));
  });
