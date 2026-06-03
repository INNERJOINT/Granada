import path from 'node:path';
import { sanitizeLogMessage } from '../../../shared/logger.js';
import type { HookDeps, HookInput, HookObjectOutput } from '../../../types/hook.js';
import { getZhSiblingPath, stripLeadingTimestamp } from '../../../shared/artifact-paths.js';
import { getCandidateReason, getWrittenFilePath, isInside } from '../translate-artifact/path-policy.js';

type CopyPair = {
  source: string;
  destination: string;
};

function warningOutput(message: unknown): HookObjectOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `markdown timestamp warning: ${sanitizeLogMessage(message, 'timestamp failed')}`,
    },
  };
}

function hasGranadaSegment(filePath: string): boolean {
  return filePath.split(path.sep).includes('.granada');
}

function resolveSourcePath(cwd: string, filePath: string): { sourcePath: string; skipped?: boolean; reason?: string } {
  const root = path.resolve(cwd);
  const granadaRoot = path.join(root, '.granada');
  const sourcePath = path.resolve(root, filePath);
  const basename = path.basename(sourcePath);

  if (!hasGranadaSegment(sourcePath) || !isInside(granadaRoot, sourcePath)) return { sourcePath, skipped: true, reason: 'outside-granada' };
  if (!basename.endsWith('.md')) return { sourcePath, skipped: true, reason: 'not-markdown' };
  if (basename.endsWith('_zh.md')) return { sourcePath, skipped: true, reason: 'already-zh' };
  if (basename.endsWith('-partial.md')) return { sourcePath, skipped: true, reason: 'partial-markdown' };
  return { sourcePath };
}

function formatEast8Prefix(epochMs: number): string {
  const date = new Date(epochMs + 8 * 60 * 60 * 1000);
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-`;
}

function getDestinationPath(sourcePath: string, prefix: string): string {
  return path.join(path.dirname(sourcePath), `${prefix}${stripLeadingTimestamp(path.basename(sourcePath))}`);
}

function getPlannedCopies(sourcePath: string, prefix: string, fs: HookDeps['fs']): CopyPair[] {
  const pairs: CopyPair[] = [{ source: sourcePath, destination: getDestinationPath(sourcePath, prefix) }];
  const siblingPath = getZhSiblingPath(sourcePath);
  if (fs?.existsSync(siblingPath)) {
    pairs.push({ source: siblingPath, destination: getDestinationPath(siblingPath, prefix) });
  }
  return pairs;
}

function detectCollision(pairs: CopyPair[], fs: HookDeps['fs']): CopyPair | null {
  for (const pair of pairs) {
    if (pair.source !== pair.destination && fs?.existsSync(pair.destination)) return pair;
  }
  return null;
}

export function handleTimestampArtifactHook(input: HookInput, deps: HookDeps): HookObjectOutput | null {
  const logger = deps.logger || { log() {} };
  const candidateReason = getCandidateReason(input);
  if (candidateReason) {
    logger.log('D', `skip reason=${candidateReason}`);
    return null;
  }
  if (!deps.fs) throw new Error('missing fs dependency');

  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : deps.cwd;
  if (!cwd) throw new Error('missing cwd');
  const filePath = getWrittenFilePath(input);
  if (!filePath) return null;

  const resolved = resolveSourcePath(cwd, filePath);
  if (resolved.skipped) {
    logger.log('D', `skip reason=${resolved.reason || 'unknown'} source=${resolved.sourcePath}`);
    return null;
  }

  const prefix = formatEast8Prefix(typeof deps.now === 'function' ? deps.now() : Date.now());
  const pairs = getPlannedCopies(resolved.sourcePath, prefix, deps.fs);
  const collision = detectCollision(pairs, deps.fs);
  if (collision) {
    const message = `destination already exists; source=${collision.source} destination=${collision.destination}`;
    logger.log('W', message);
    return warningOutput(message);
  }

  for (const pair of pairs) {
    if (pair.source === pair.destination) continue;
    logger.log('I', `timestamp copy source=${pair.source} destination=${pair.destination}`);
    deps.fs.copyFileSync(pair.source, pair.destination);
  }

  return null;
}
