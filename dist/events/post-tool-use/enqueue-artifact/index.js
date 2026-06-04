import { getGranadaArtifactCandidate } from '../../../shared/artifact-source-policy.js';
import { appendJournalEntry } from '../../../state/artifact-journal.js';
export function handleEnqueueArtifactHook(input, deps) {
    const logger = deps.logger || { log() { } };
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : deps.cwd;
    if (!cwd)
        throw new Error('missing cwd');
    const candidate = getGranadaArtifactCandidate(input, cwd);
    if ('skipped' in candidate) {
        logger.log('D', `skip reason=${candidate.reason}${candidate.sourcePath ? ` source=${candidate.sourcePath}` : ''}`);
        return null;
    }
    const entry = appendJournalEntry(input, cwd, candidate.sourcePath, deps, { keepLatestSourceRecord: true });
    logger.log('I', `queued artifact source=${entry.sourcePath} session=${entry.sessionKey}`);
    return null;
}
