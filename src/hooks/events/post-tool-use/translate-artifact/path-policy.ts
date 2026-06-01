import path from 'node:path';
import type { HookInput } from '../../../types/hook.js';
import type { TranslationConfig } from './config.js';

export function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function getWrittenFilePath(input: HookInput): string | null {
  const response = input.tool_response;
  const responsePath = response && typeof response === 'object' ? response.filePath : null;
  if (typeof responsePath === 'string' && responsePath) return responsePath;

  const inputPath = input.tool_input?.file_path;
  return typeof inputPath === 'string' && inputPath ? inputPath : null;
}

export function getCandidateReason(input: HookInput): string | null {
  if (!input) return 'invalid-input';
  if (input.hook_event_name !== 'PostToolUse') return `event-${input.hook_event_name || 'unknown'}`;
  if (input.tool_name !== 'Write') return `tool-${input.tool_name || 'unknown'}`;
  if (!getWrittenFilePath(input)) return 'missing-file-path';
  return null;
}

export function resolveArtifactPaths(cwd: string, filePath: string, config: TranslationConfig): { sourcePath: string; targetPath?: string; skipped?: boolean; reason?: string } {
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
