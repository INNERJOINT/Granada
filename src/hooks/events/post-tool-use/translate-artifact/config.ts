import path from 'node:path';
import type { HookDeps } from '../../../types/hook.js';
import { getTranslationLang } from '../../../shared/artifact-paths.js';
import { isInside } from './path-policy.js';

export interface TranslationConfig {
  dirs: string[];
  command: string;
  timeoutMs: number;
  lang: string;
  targetLanguage: string;
  enabled: boolean;
}

function stripOptionalQuotes(value: unknown): string {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};

  const lines = match[1].split('\n');
  const metadata: Record<string, string> = {};

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

    const items: string[] = [];
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

export function parseList(value: unknown): string[] {
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

function isTranslationEnabled(value: unknown): boolean {
  const normalized = String(value ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off', 'disabled'].includes(normalized);
}

function getTargetLanguage(lang: string): string {
  const names: Record<string, string> = {
    zh: 'Simplified Chinese',
    'zh-cn': 'Simplified Chinese',
    'zh-tw': 'Traditional Chinese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    pt: 'Portuguese',
    'pt-br': 'Brazilian Portuguese',
  };
  return names[lang] || lang;
}

function getDefaultTranslationCommand(): string {
  return 'claude -p --model haiku --no-session-persistence';
}

export function readTranslationConfig(cwd: string, { fs, env = {}, pluginRoot, skillPathArg }: HookDeps): TranslationConfig {
  if (!fs) throw new Error('missing fs dependency');
  const root = path.resolve(cwd);
  const configRoot = skillPathArg ? root : path.resolve(pluginRoot || root);
  const skillPath = path.resolve(configRoot, skillPathArg || 'skills/aosp-feature-export/SKILL.md');
  if (!isInside(configRoot, skillPath) || path.basename(skillPath) !== 'SKILL.md') {
    throw new Error('invalid SKILL.md path argument');
  }

  const metadata = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
  const dirs = parseList(metadata['artifacts-dirs']);
  if (dirs.length === 0) {
    throw new Error(`missing artifacts-dirs in ${skillPath}`);
  }

  const lang = getTranslationLang(env);
  return {
    dirs,
    command: env.GRANADA_TRANSLATE_COMMAND || getDefaultTranslationCommand(),
    timeoutMs: Number.parseInt(metadata['translate-timeout-ms'] || env.TRANSLATE_MD_ZH_TIMEOUT_MS || '300000', 10),
    lang,
    targetLanguage: getTargetLanguage(lang),
    enabled: isTranslationEnabled(env.GRANADA_TRANSLATE_ENABLE),
  };
}
