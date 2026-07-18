import path from 'node:path';
import { getTranslationLang, hasTranslationSuffix, stripLeadingTimestamp } from './artifact-paths.js';
const TIMESTAMPED_MARKDOWN = /^\d{8}-\d{6}-.+\.md$/;
export function isInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
export function getToolFilePath(input) {
    const response = input.tool_response;
    const responsePath = response && typeof response === 'object' ? response.filePath : null;
    if (typeof responsePath === 'string' && responsePath)
        return responsePath;
    const inputPath = input.tool_input?.file_path;
    return typeof inputPath === 'string' && inputPath ? inputPath : null;
}
export function getPostToolUseCandidateReason(input, acceptedTools = new Set(['Write', 'Edit', 'Update'])) {
    if (!input)
        return 'invalid-input';
    if (input.hook_event_name !== 'PostToolUse')
        return `event-${input.hook_event_name || 'unknown'}`;
    if (!acceptedTools.has(input.tool_name || ''))
        return `tool-${input.tool_name || 'unknown'}`;
    if (!getToolFilePath(input))
        return 'missing-file-path';
    return null;
}
function isTimestampedDerivative(basename) {
    if (!TIMESTAMPED_MARKDOWN.test(basename))
        return false;
    return stripLeadingTimestamp(basename) !== basename;
}
export function resolveGranadaArtifactSource(cwd, filePath, options = {}) {
    const root = path.resolve(cwd);
    const sourcePath = path.resolve(root, filePath);
    const granadaRoot = path.join(root, '.granada');
    const relativePath = path.relative(root, sourcePath);
    const basename = path.basename(sourcePath);
    const rejectTimestampedDerivative = options.rejectTimestampedDerivative !== false;
    if (!isInside(granadaRoot, sourcePath))
        return { skipped: true, sourcePath, reason: 'outside-granada' };
    if (relativePath.split(path.sep).includes('.hooks'))
        return { skipped: true, sourcePath, reason: 'state-path' };
    if (!basename.endsWith('.md'))
        return { skipped: true, sourcePath, reason: 'not-markdown' };
    if (hasTranslationSuffix(basename, options.lang || 'zh'))
        return { skipped: true, sourcePath, reason: 'already-translated' };
    if (basename.endsWith('-partial.md'))
        return { skipped: true, sourcePath, reason: 'partial-markdown' };
    if (rejectTimestampedDerivative && isTimestampedDerivative(basename))
        return { skipped: true, sourcePath, reason: 'timestamp-derivative' };
    return { sourcePath, relativePath };
}
export function getGranadaArtifactCandidate(input, cwd, env = {}) {
    const reason = getPostToolUseCandidateReason(input);
    if (reason)
        return { skipped: true, reason };
    const filePath = getToolFilePath(input);
    if (!filePath)
        return { skipped: true, reason: 'missing-file-path' };
    return resolveGranadaArtifactSource(cwd, filePath, { lang: getTranslationLang(env) });
}
