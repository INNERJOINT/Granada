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

export function parseCommand(command) {
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

  return tokens;
}

export function translateWithCommand(markdown, config, { cwd, env, spawn }) {
  if (env.TRANSLATE_MD_ZH_MOCK_TEXT !== undefined) {
    return Promise.resolve(env.TRANSLATE_MD_ZH_MOCK_TEXT);
  }

  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 300000;
  const prompt = buildPrompt(markdown);
  const [command, ...args] = parseCommand(config.command);

  return new Promise((resolve, reject) => {
    const childEnv = { ...env };
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
