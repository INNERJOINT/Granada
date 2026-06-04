import path from 'node:path';
import { sanitizeLogMessage } from '../../../shared/logger.js';
import type { HookDeps, HookInput, HookObjectOutput } from '../../../types/hook.js';
import { getTranslatedSiblingPath, hasTranslationSuffix, stripLeadingTimestamp } from '../../../shared/artifact-paths.js';
import { readTranslationConfig } from './config.js';
import { translateWithCommand } from './command.js';
import { getCandidateReason, getWrittenFilePath, resolveArtifactPaths } from './path-policy.js';

export type TranslateArtifactResult = {
  sourcePath: string;
  targetPath: string;
  readSourcePath: string;
} | null;

function warningOutput(message: unknown, hookEventName = 'PostToolUse'): HookObjectOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext: `markdown translation warning: ${sanitizeLogMessage(message, 'translation failed')}`,
    },
  };
}

function cleanupTemp(fs: HookDeps['fs'], tempPath: string | undefined): void {
  if (!fs || !tempPath) return;
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {}
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTimestampedSourcePath(sourcePath: string, lang: string, fs: HookDeps['fs']): string | null {
  if (!fs) return null;
  const sourceDir = path.dirname(sourcePath);
  const sourceBase = stripLeadingTimestamp(path.basename(sourcePath));
  if (hasTranslationSuffix(sourceBase, lang)) return null;
  const pattern = new RegExp(`^\\d{8}-\\d{6}-${escapeRegex(sourceBase)}$`);
  const candidates = fs.readdirSync(sourceDir)
    .filter(name => pattern.test(name) && !hasTranslationSuffix(name, lang))
    .sort()
    .reverse();
  return candidates[0] ? path.join(sourceDir, candidates[0]) : null;
}

function maybeCompensateTimestampedTarget(sourcePath: string, targetPath: string, lang: string, deps: HookDeps): string {
  if (!deps.fs || deps.fs.existsSync(sourcePath) || !deps.fs.existsSync(targetPath)) return targetPath;
  const timestampedSourcePath = findTimestampedSourcePath(sourcePath, lang, deps.fs);
  if (!timestampedSourcePath) return targetPath;
  const timestampedTargetPath = getTranslatedSiblingPath(timestampedSourcePath, lang);
  if (timestampedTargetPath === targetPath) return targetPath;
  if (deps.fs.existsSync(timestampedTargetPath)) {
    throw new Error(`timestamp compensation destination already exists: ${timestampedTargetPath}`);
  }
  deps.fs.renameSync(targetPath, timestampedTargetPath);
  return timestampedTargetPath;
}

export async function processTranslateArtifact(sourcePath: string, deps: HookDeps, options: { enforceTranslateDirs?: boolean } = {}): Promise<TranslateArtifactResult> {
  const logger = deps.logger || { log() {} };
  if (!deps.fs) throw new Error('missing fs dependency');
  const cwd = deps.cwd;
  if (!cwd) throw new Error('missing cwd');

  let targetPath: string | undefined;
  let tempPath: string | undefined;

  try {
    const config = readTranslationConfig(cwd, deps);
    if (!config.enabled) {
      logger.log('D', `translate skipped reason=disabled source=${sourcePath}`);
      return null;
    }
    const resolvedSourcePath = path.resolve(cwd, sourcePath);
    if (options.enforceTranslateDirs !== false) {
      const paths = resolveArtifactPaths(cwd, resolvedSourcePath, config);
      if (!paths || paths.skipped || !paths.targetPath) {
        throw new Error(`source is not eligible for translation: ${paths ? paths.reason : 'unknown'}`);
      }
      targetPath = paths.targetPath;
    } else {
      targetPath = getTranslatedSiblingPath(resolvedSourcePath, config.lang);
    }

    let readSourcePath = resolvedSourcePath;
    let writeTargetPath = targetPath;
    const timestampedSourcePath = findTimestampedSourcePath(resolvedSourcePath, config.lang, deps.fs);
    if (timestampedSourcePath) {
      readSourcePath = timestampedSourcePath;
      writeTargetPath = getTranslatedSiblingPath(timestampedSourcePath, config.lang);
    }
    const stamp = typeof deps.now === 'function' ? deps.now() : Date.now();
    tempPath = `${writeTargetPath}.${deps.pid || 'process'}.${stamp}.tmp`;
    logger.log('I', `translate start source=${readSourcePath} target=${writeTargetPath}`);

    const source = deps.fs.readFileSync(readSourcePath, 'utf8');
    const translated = await translateWithCommand(source, config, deps);
    deps.fs.writeFileSync(tempPath, translated, 'utf8');
    deps.fs.renameSync(tempPath, writeTargetPath);
    const completedTargetPath = writeTargetPath === targetPath
      ? maybeCompensateTimestampedTarget(resolvedSourcePath, targetPath, config.lang, deps)
      : writeTargetPath;
    logger.log('I', `translate success source=${readSourcePath} target=${completedTargetPath}`);
    return { sourcePath: resolvedSourcePath, targetPath: completedTargetPath, readSourcePath };
  } catch (error) {
    cleanupTemp(deps.fs, tempPath);
    const message = error instanceof Error ? error.message : String(error);
    if (targetPath) {
      logger.log('E', `translate failed source=${sourcePath} target=${targetPath} error=${sanitizeLogMessage(message)}`);
    }
    throw error;
  }
}

export async function handleTranslateArtifactHook(input: HookInput, deps: HookDeps): Promise<HookObjectOutput | null> {
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

  try {
    const config = readTranslationConfig(cwd, deps);
    if (!config.enabled) {
      logger.log('D', `skip reason=disabled source=${filePath}`);
      return null;
    }
    const paths = resolveArtifactPaths(cwd, filePath, config);
    if (!paths || paths.skipped) {
      logger.log('D', `skip reason=${paths ? paths.reason : 'unknown'} source=${paths && paths.sourcePath ? paths.sourcePath : filePath}`);
      return null;
    }
    await processTranslateArtifact(paths.sourcePath, { ...deps, cwd });
    return null;
  } catch (error) {
    return warningOutput(error instanceof Error ? error.message : String(error));
  }
}
