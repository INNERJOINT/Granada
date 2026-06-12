import { sanitizeLogMessage } from '../../../shared/logger.js';
import type { HookDeps, HookInput, HookObjectOutput } from '../../../types/hook.js';
import { getTranslationLang } from '../../../shared/artifact-paths.js';
import { resolveGranadaArtifactSource } from '../../../shared/artifact-source-policy.js';
import { processTimestampArtifact } from '../../post-tool-use/timestamp-artifact/index.js';
import { processTranslateArtifact } from '../../post-tool-use/translate-artifact/index.js';
import {
  acquireDrainLock,
  clearFailureEntry,
  getPendingSourceRecords,
  getSessionKey,
  readFailureEntry,
  removeJournalRecords,
  sourceSnapshotMatches,
  writeFailureEntry,
} from '../../../state/artifact-journal.js';

function warningOutput(message: unknown): HookObjectOutput {
  return {
    systemMessage: `artifact drain warning: ${sanitizeLogMessage(message, 'artifact drain failed')}`,
  };
}

export async function handleDrainArtifactsHook(input: HookInput, deps: HookDeps): Promise<HookObjectOutput | null> {
  const logger = deps.logger || { log() {} };
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : deps.cwd;
  if (!cwd) throw new Error('missing cwd');
  if (!deps.fs) throw new Error('missing fs dependency');

  const sessionKey = getSessionKey(input, cwd, deps);
  const lock = acquireDrainLock(cwd, sessionKey, deps);
  if (!lock) {
    logger.log('D', `drain skipped reason=lock-held session=${sessionKey}`);
    return null;
  }

  const warnings: string[] = [];
  try {
    const recordsBySource = getPendingSourceRecords(cwd, sessionKey, deps);
    const sources = Array.from(recordsBySource.keys()).sort();
    if (sources.length === 0) {
      logger.log('D', `drain skipped reason=no-pending session=${sessionKey}`);
      return null;
    }
    logger.log('I', `drain start session=${sessionKey} count=${sources.length}`);

    for (const sourcePath of sources) {
      const records = recordsBySource.get(sourcePath) || [];
      const candidate = resolveGranadaArtifactSource(cwd, sourcePath, { lang: getTranslationLang(deps.env) });
      if ('skipped' in candidate) {
        logger.log('W', `drain remove source=${sourcePath} reason=${candidate.reason}`);
        removeJournalRecords(cwd, records, deps);
        clearFailureEntry(cwd, sessionKey, sourcePath, deps);
        continue;
      }
      if (!deps.fs.existsSync(candidate.sourcePath)) {
        logger.log('W', `drain remove missing source=${candidate.sourcePath}`);
        removeJournalRecords(cwd, records, deps);
        clearFailureEntry(cwd, sessionKey, candidate.sourcePath, deps);
        continue;
      }

      const failure = readFailureEntry(cwd, sessionKey, candidate.sourcePath, deps);
      let timestampProcessed = failure?.timestampProcessed === true && sourceSnapshotMatches(candidate.sourcePath, failure.sourceSnapshot, deps);
      try {
        if (!timestampProcessed) {
          processTimestampArtifact(candidate.sourcePath, { ...deps, cwd });
          timestampProcessed = true;
        } else {
          logger.log('D', `drain reuse timestamp source=${candidate.sourcePath}`);
        }
        await processTranslateArtifact(candidate.sourcePath, { ...deps, cwd }, { enforceTranslateDirs: false });
        removeJournalRecords(cwd, records, deps);
        clearFailureEntry(cwd, sessionKey, candidate.sourcePath, deps);
        logger.log('I', `drain success source=${candidate.sourcePath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.log('E', `drain failed source=${candidate.sourcePath} error=${sanitizeLogMessage(message)}`);
        writeFailureEntry(cwd, sessionKey, candidate.sourcePath, message, deps, timestampProcessed);
        warnings.push(`${candidate.sourcePath}: ${message}`);
      }
    }
  } finally {
    lock.release();
  }

  if (warnings.length > 0) return warningOutput(warnings.join('; '));
  return null;
}
