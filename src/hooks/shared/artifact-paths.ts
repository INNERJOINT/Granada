import path from 'node:path';
import type { HookDeps } from '../types/hook.js';

const TIMESTAMP_PREFIX = /^\d{8}-\d{6}-/;
const TRANSLATION_LANG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

export function stripLeadingTimestamp(basename: string): string {
  return basename.replace(TIMESTAMP_PREFIX, '');
}

export function getTranslationLang(env: HookDeps['env'] = {}): string {
  const lang = String(env.GRANADA_TRANSLATE_LANG || 'zh').trim().toLowerCase();
  if (!TRANSLATION_LANG.test(lang)) throw new Error('GRANADA_TRANSLATE_LANG must be a language code such as zh, en, ja, or pt-br');
  return lang;
}

export function hasTranslationSuffix(basename: string, lang = 'zh'): boolean {
  const sourceBase = stripLeadingTimestamp(basename);
  return sourceBase.endsWith('_zh.md') || sourceBase.endsWith(`_${lang}.md`);
}

export function getTranslatedSiblingPath(sourcePath: string, lang = 'zh'): string {
  const basename = path.basename(sourcePath);
  return path.join(path.dirname(sourcePath), `${basename.slice(0, -3)}_${lang}.md`);
}

