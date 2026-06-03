import path from 'node:path';
import { sanitizeLogMessage } from '../../../shared/logger.js';
import { getZhSiblingPath, stripLeadingTimestamp } from '../../../shared/artifact-paths.js';
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
    if (!fs || !tempPath)
        return;
    try {
        if (fs.existsSync(tempPath))
            fs.unlinkSync(tempPath);
    }
    catch { }
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function findTimestampedSourcePath(sourcePath, fs) {
    if (!fs)
        return null;
    const sourceDir = path.dirname(sourcePath);
    const sourceBase = stripLeadingTimestamp(path.basename(sourcePath));
    if (sourceBase.endsWith('_zh.md'))
        return null;
    const pattern = new RegExp(`^\\d{8}-\\d{6}-${escapeRegex(sourceBase)}$`);
    const candidates = fs.readdirSync(sourceDir)
        .filter(name => pattern.test(name) && !name.endsWith('_zh.md'))
        .sort()
        .reverse();
    return candidates[0] ? path.join(sourceDir, candidates[0]) : null;
}
function maybeCompensateTimestampedTarget(sourcePath, targetPath, deps) {
    if (!deps.fs || deps.fs.existsSync(sourcePath) || !deps.fs.existsSync(targetPath))
        return targetPath;
    const timestampedSourcePath = findTimestampedSourcePath(sourcePath, deps.fs);
    if (!timestampedSourcePath)
        return targetPath;
    const timestampedTargetPath = getZhSiblingPath(timestampedSourcePath);
    if (timestampedTargetPath === targetPath)
        return targetPath;
    if (deps.fs.existsSync(timestampedTargetPath)) {
        throw new Error(`timestamp compensation destination already exists: ${timestampedTargetPath}`);
    }
    deps.fs.renameSync(targetPath, timestampedTargetPath);
    return timestampedTargetPath;
}
export async function handleTranslateArtifactHook(input, deps) {
    const logger = deps.logger || { log() { } };
    const candidateReason = getCandidateReason(input);
    if (candidateReason) {
        logger.log('D', `skip reason=${candidateReason}`);
        return null;
    }
    if (!deps.fs)
        throw new Error('missing fs dependency');
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : deps.cwd;
    if (!cwd)
        throw new Error('missing cwd');
    const filePath = getWrittenFilePath(input);
    if (!filePath)
        return null;
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
        if (!targetPath)
            return null;
        let readSourcePath = sourcePath;
        let writeTargetPath = targetPath;
        const timestampedSourcePath = findTimestampedSourcePath(sourcePath, deps.fs);
        if (timestampedSourcePath) {
            readSourcePath = timestampedSourcePath;
            writeTargetPath = getZhSiblingPath(timestampedSourcePath);
        }
        const stamp = typeof deps.now === 'function' ? deps.now() : Date.now();
        tempPath = `${writeTargetPath}.${deps.pid || 'process'}.${stamp}.tmp`;
        logger.log('I', `translate start source=${readSourcePath} target=${writeTargetPath}`);
        const source = deps.fs.readFileSync(readSourcePath, 'utf8');
        const translated = await translateWithCommand(source, config, deps);
        deps.fs.writeFileSync(tempPath, translated, 'utf8');
        deps.fs.renameSync(tempPath, writeTargetPath);
        const completedTargetPath = writeTargetPath === targetPath
            ? maybeCompensateTimestampedTarget(sourcePath, targetPath, deps)
            : writeTargetPath;
        logger.log('I', `translate success source=${readSourcePath} target=${completedTargetPath}`);
        return null;
    }
    catch (error) {
        cleanupTemp(deps.fs, tempPath);
        const message = error instanceof Error ? error.message : String(error);
        if (sourcePath && targetPath) {
            logger.log('E', `translate failed source=${sourcePath} target=${targetPath} error=${sanitizeLogMessage(message)}`);
        }
        return warningOutput(message);
    }
}
