import path from 'node:path';
import { getTranslatedSiblingPath, hasTranslationSuffix } from '../../../shared/artifact-paths.js';
import { getPostToolUseCandidateReason, getToolFilePath, isInside } from '../../../shared/artifact-source-policy.js';
export { getToolFilePath as getWrittenFilePath, isInside };
export function getCandidateReason(input) {
    return getPostToolUseCandidateReason(input);
}
export function resolveArtifactPaths(cwd, filePath, config) {
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
    if (hasTranslationSuffix(basename, config.lang)) {
        return { skipped: true, reason: 'already-translated', sourcePath };
    }
    if (basename.endsWith('-partial.md')) {
        return { skipped: true, reason: 'partial-markdown', sourcePath };
    }
    const targetPath = getTranslatedSiblingPath(sourcePath, config.lang);
    return { sourcePath, targetPath };
}
