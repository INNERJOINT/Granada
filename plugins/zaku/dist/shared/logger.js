const LOG_LEVELS = { V: 0, D: 1, I: 2, W: 3, E: 4 };
const LOG_NAMES = { V: 'verbose', D: 'debug', I: 'info', W: 'warn', E: 'error' };
export function sanitizeLogMessage(message, fallback = 'operation failed') {
    return String(message || fallback)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .slice(0, 500);
}
export function getDebugLevel(env, key = 'GRANADA_DEBUG') {
    const raw = String((env && env[key]) || '').trim().toUpperCase();
    if (!raw)
        return null;
    if (raw === '1' || raw === 'TRUE' || raw === 'YES' || raw === 'ON')
        return 'D';
    return Object.prototype.hasOwnProperty.call(LOG_LEVELS, raw) ? raw : null;
}
export function createLogger({ env, stderr, prefix }) {
    return {
        log(level, message) {
            const threshold = getDebugLevel(env);
            if (!threshold || LOG_LEVELS[level] < LOG_LEVELS[threshold])
                return;
            stderr.write(`[${prefix}][${LOG_NAMES[level]}] ${message}\n`);
        },
    };
}
