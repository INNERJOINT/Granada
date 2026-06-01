import { sanitizeLogMessage } from '../../../shared/logger.js';
import type { HookDeps, HookInput, HookObjectOutput } from '../../../types/hook.js';
import { readTranslationConfig } from './config.js';
import { translateWithCommand } from './command.js';
import { getCandidateReason, getWrittenFilePath, resolveArtifactPaths } from './path-policy.js';

function warningOutput(message: unknown): HookObjectOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
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
  let sourcePath: string | undefined;
  let targetPath: string | undefined;
  let tempPath: string | undefined;

  try {
    const config = readTranslationConfig(cwd, deps);
    const paths = resolveArtifactPaths(cwd, filePath, config);
    if (!paths || paths.skipped) {
      logger.log('D', `skip reason=${paths ? paths.reason : 'unknown'} source=${paths && paths.sourcePath ? paths.sourcePath : filePath}`);
      return null;
    }

    ({ sourcePath, targetPath } = paths);
    if (!targetPath) return null;
    const stamp = typeof deps.now === 'function' ? deps.now() : Date.now();
    tempPath = `${targetPath}.${deps.pid || 'process'}.${stamp}.tmp`;
    logger.log('I', `translate start source=${sourcePath} target=${targetPath}`);

    const source = deps.fs.readFileSync(sourcePath, 'utf8');
    const translated = await translateWithCommand(source, config, deps);
    deps.fs.writeFileSync(tempPath, translated, 'utf8');
    deps.fs.renameSync(tempPath, targetPath);
    logger.log('I', `translate success source=${sourcePath} target=${targetPath}`);
    return null;
  } catch (error) {
    cleanupTemp(deps.fs, tempPath);
    const message = error instanceof Error ? error.message : String(error);
    if (sourcePath && targetPath) {
      logger.log('E', `translate failed source=${sourcePath} target=${targetPath} error=${sanitizeLogMessage(message)}`);
    }
    return warningOutput(message);
  }
}
