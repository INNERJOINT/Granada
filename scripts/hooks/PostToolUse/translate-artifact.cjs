#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

const LOG_LEVELS = { V: 0, D: 1, I: 2, W: 3, E: 4 };
const LOG_NAMES = { V: 'verbose', D: 'debug', I: 'info', W: 'warn', E: 'error' };

function getGranadaDebugLevel() {
  const raw = String(process.env.GRANADA_DEBUG || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === '1' || raw === 'TRUE' || raw === 'YES' || raw === 'ON') return 'D';
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, raw) ? raw : null;
}

function debugLog(level, message) {
  const threshold = getGranadaDebugLevel();
  if (!threshold || LOG_LEVELS[level] < LOG_LEVELS[threshold]) return;
  process.stderr.write(`[granada:translate-artifact][${LOG_NAMES[level]}] ${message}\n`);
}

function sanitizeWarning(message) {
  return String(message || 'translation failed')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, 500);
}

function warning(message) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `markdown translation warning: ${sanitizeWarning(message)}`,
    },
  });
}

function parseInput(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

function stripOptionalQuotes(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};

  const lines = match[1].split('\n');
  const metadata = {};

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const scalar = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!scalar) continue;

    const key = scalar[1].trim();
    const value = scalar[2].trim();

    if (value) {
      metadata[key] = stripOptionalQuotes(value);
      continue;
    }

    const items = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const item = lines[j].match(/^\s+-\s*(.+?)\s*$/);
      if (!item) break;
      items.push(stripOptionalQuotes(item[1]));
      i = j;
    }
    if (items.length > 0) {
      metadata[key] = `[${items.join(',')}]`;
    }
  }

  return metadata;
}

function parseList(value) {
  if (!value) return [];
  const trimmed = stripOptionalQuotes(value);
  if (!trimmed) return [];

  const raw = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;

  return raw
    .split(',')
    .map(item => stripOptionalQuotes(item))
    .filter(Boolean);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readConfig(cwd) {
  const skillPathArg = process.argv[2] || 'skills/aosp-feature-export/SKILL.md';

  const root = path.resolve(cwd);
  const skillPath = path.resolve(root, skillPathArg);
  if (!isInside(root, skillPath) || path.basename(skillPath) !== 'SKILL.md') {
    throw new Error('invalid SKILL.md path argument');
  }

  const metadata = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
  const dirs = parseList(metadata['translate-dirs']);
  if (dirs.length === 0) {
    throw new Error(`missing translate-dirs in ${skillPath}`);
  }

  return {
    dirs,
    command: process.env.GRANADA_TRANSLATE_COMMAND || 'claude -p --model sonnet',
    timeoutMs: Number.parseInt(metadata['translate-timeout-ms'] || process.env.TRANSLATE_MD_ZH_TIMEOUT_MS || '300000', 10),
  };
}

function getWrittenFilePath(input) {
  const responsePath = input && input.tool_response && input.tool_response.filePath;
  if (typeof responsePath === 'string' && responsePath) return responsePath;

  const inputPath = input && input.tool_input && input.tool_input.file_path;
  return typeof inputPath === 'string' && inputPath ? inputPath : null;
}

function getCandidateReason(input) {
  if (!input) return 'invalid-input';
  if (input.hook_event_name !== 'PostToolUse') return `event-${input.hook_event_name || 'unknown'}`;
  if (input.tool_name !== 'Write') return `tool-${input.tool_name || 'unknown'}`;
  if (!getWrittenFilePath(input)) return 'missing-file-path';
  return null;
}

function resolvePaths(cwd, filePath, config) {
  const root = path.resolve(cwd);
  const sourcePath = path.resolve(root, filePath);
  const allowedDirs = config.dirs.map(dir => path.resolve(root, dir));
  if (!allowedDirs.some(dir => isInside(dir, sourcePath))) {
    return { skipped: true, reason: 'outside-translate-dirs', sourcePath };
  }

  const basename = path.basename(sourcePath);
  if (!basename.endsWith('.md')) {
    return { skipped: true, reason: 'not-markdown', sourcePath };
  }
  if (basename.endsWith('_zh.md')) {
    return { skipped: true, reason: 'already-zh', sourcePath };
  }
  if (basename.endsWith('-partial.md')) {
    return { skipped: true, reason: 'partial-markdown', sourcePath };
  }

  const targetPath = path.join(path.dirname(sourcePath), `${basename.slice(0, -3)}_zh.md`);
  return { sourcePath, targetPath };
}

function buildPrompt(markdown) {
  return [
    'Translate the following Markdown document to Simplified Chinese.',
    'Preserve Markdown structure exactly.',
    'Preserve code blocks, inline code, file paths, URLs, commands, symbols, identifiers, log tags, stack traces, and raw code exactly unless the text is explanatory prose.',
    'Return only the translated Markdown, with no preface or commentary.',
    '',
    markdown,
  ].join('\n');
}

function parseCommand(command) {
  const tokens = [];
  let current = '';
  let quote = null;

  for (const char of String(command || '')) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) throw new Error('translate-command has unmatched quotes');
  if (current) tokens.push(current);
  if (tokens.length === 0) throw new Error('translate-command is empty');

  const unsafe = /[;&|<>`\r\n]/;
  if (tokens.some(token => unsafe.test(token))) {
    throw new Error('translate-command contains unsafe shell metacharacters');
  }

  const allowed = new Set(parseList(process.env.TRANSLATE_MD_ZH_ALLOWED_COMMANDS || 'claude'));
  const commandName = path.basename(tokens[0]);
  if (!allowed.has(commandName)) {
    throw new Error(`translate-command executable "${commandName}" is not allowed`);
  }

  if (commandName === 'claude') {
    const isBarePrint = tokens.length === 2 && tokens[1] === '-p';
    const isModelPrint = tokens.length === 4 && tokens[1] === '-p' && tokens[2] === '--model' && !tokens[3].startsWith('-');
    if (!isBarePrint && !isModelPrint) {
      throw new Error('translate-command for claude must be "claude -p" or "claude -p --model <model>"');
    }
  }

  return tokens;
}

function translateWithCommand(markdown, config, cwd) {
  if (process.env.TRANSLATE_MD_ZH_MOCK_TEXT !== undefined) {
    return Promise.resolve(process.env.TRANSLATE_MD_ZH_MOCK_TEXT);
  }

  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 300000;
  const prompt = buildPrompt(markdown);
  const [command, ...args] = parseCommand(config.command);

  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.NODE_OPTIONS;

    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });

    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('translation command timed out'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.resume();
    child.stdin.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`translation command exited with ${code}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error('translation command returned no text'));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(prompt);
  });
}

async function main() {
  const input = parseInput(readStdin());
  const candidateReason = getCandidateReason(input);
  if (candidateReason) {
    debugLog('D', `skip reason=${candidateReason}`);
    return;
  }

  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const filePath = getWrittenFilePath(input);
  const config = readConfig(cwd);
  const paths = resolvePaths(cwd, filePath, config);
  if (!paths || paths.skipped) {
    debugLog('D', `skip reason=${paths ? paths.reason : 'unknown'} source=${paths && paths.sourcePath ? paths.sourcePath : filePath}`);
    return;
  }

  const { sourcePath, targetPath } = paths;
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  debugLog('I', `translate start source=${sourcePath} target=${targetPath}`);

  try {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const translated = await translateWithCommand(source, config, cwd);
    fs.writeFileSync(tempPath, translated, 'utf8');
    fs.renameSync(tempPath, targetPath);
    debugLog('I', `translate success source=${sourcePath} target=${targetPath}`);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    const message = error instanceof Error ? error.message : String(error);
    debugLog('E', `translate failed source=${sourcePath} target=${targetPath} error=${sanitizeWarning(message)}`);
    warning(message);
  }
}

main().catch(error => {
  warning(error instanceof Error ? error.message : String(error));
});
