import path from 'node:path';
import { sanitizeLogMessage } from '../../../shared/logger.js';
import type { HookDeps, HookInput, HookObjectOutput } from '../../../types/hook.js';
import { getTranslatedSiblingPath, getTranslationLang, stripLeadingTimestamp } from '../../../shared/artifact-paths.js';
import { getPostToolUseCandidateReason, getToolFilePath, resolveGranadaArtifactSource } from '../../../shared/artifact-source-policy.js';

type CopyPair = {
  source: string;
  destination: string;
};

export type TimestampArtifactResult = {
  prefix: string;
  copied: CopyPair[];
};

function warningOutput(message: unknown): HookObjectOutput {
  return {
    systemMessage: `markdown timestamp warning: ${sanitizeLogMessage(message, 'timestamp failed')}`,
  };
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

function getPlannedCopies(sourcePath: string, prefix: string, lang: string, fs: HookDeps['fs']): CopyPair[] {
  const pairs: CopyPair[] = [{ source: sourcePath, destination: getDestinationPath(sourcePath, prefix) }];
  const siblingPath = getTranslatedSiblingPath(sourcePath, lang);
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

export function processTimestampArtifact(sourcePath: string, deps: HookDeps): TimestampArtifactResult {
  const logger = deps.logger || { log() {} };
  if (!deps.fs) throw new Error('missing fs dependency');

  const prefix = formatEast8Prefix(typeof deps.now === 'function' ? deps.now() : Date.now());
  const lang = getTranslationLang(deps.env);
  const pairs = getPlannedCopies(path.resolve(sourcePath), prefix, lang, deps.fs);
  const collision = detectCollision(pairs, deps.fs);
  if (collision) {
    throw new Error(`destination already exists; source=${collision.source} destination=${collision.destination}`);
  }

  const copied: CopyPair[] = [];
  for (const pair of pairs) {
    if (pair.source === pair.destination) continue;
    logger.log('I', `timestamp copy source=${pair.source} destination=${pair.destination}`);
    deps.fs.copyFileSync(pair.source, pair.destination);
    copied.push(pair);
  }

  return { prefix, copied };
}

export function handleTimestampArtifactHook(input: HookInput, deps: HookDeps): HookObjectOutput | null {
  const logger = deps.logger || { log() {} };
  const candidateReason = getPostToolUseCandidateReason(input);
  if (candidateReason) {
    logger.log('D', `skip reason=${candidateReason}`);
    return null;
  }
  if (!deps.fs) throw new Error('missing fs dependency');

  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : deps.cwd;
  if (!cwd) throw new Error('missing cwd');
  const filePath = getToolFilePath(input);
  if (!filePath) return null;

  const resolved = resolveGranadaArtifactSource(cwd, filePath, {
    rejectTimestampedDerivative: false,
    lang: getTranslationLang(deps.env),
  });
  if ('skipped' in resolved) {
    logger.log('D', `skip reason=${resolved.reason || 'unknown'} source=${resolved.sourcePath || filePath}`);
    return null;
  }

  try {
    processTimestampArtifact(resolved.sourcePath, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.log('W', message);
    return warningOutput(message);
  }

  return null;
}
