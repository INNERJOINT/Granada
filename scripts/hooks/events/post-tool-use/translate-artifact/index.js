import { sanitizeLogMessage } from '../../../shared/logger.js';
import { readTranslationConfig } from './config.js';
import { translateWithCommand } from './command.js';
import { getCandidateReason, getWrittenFilePath, resolveArtifactPaths } from './path-policy.js';

function warningOutput(message) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `markdown translation warning: ${sanitizeLogMessage(message, 'translation failed')}`,
    },
  };
}

function cleanupTemp(fs, tempPath) {
  if (!tempPath) return;
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {}
}

export async function handleTranslateArtifactHook(input, deps) {
  const logger = deps.logger || { log() {} };
  const candidateReason = getCandidateReason(input);
  if (candidateReason) {
    logger.log('D', `skip reason=${candidateReason}`);
    return null;
  }

  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : deps.cwd;
  const filePath = getWrittenFilePath(input);
  let sourcePath;
  let targetPath;
  let tempPath;

  try {
    const config = readTranslationConfig(cwd, deps);
    const paths = resolveArtifactPaths(cwd, filePath, config);
    if (!paths || paths.skipped) {
      logger.log('D', `skip reason=${paths ? paths.reason : 'unknown'} source=${paths && paths.sourcePath ? paths.sourcePath : filePath}`);
      return null;
    }

    ({ sourcePath, targetPath } = paths);
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
