import crypto from 'node:crypto';
import path from 'node:path';
import { isInside } from '../shared/artifact-source-policy.js';
export const STALE_JOURNAL_TTL_MS = 24 * 60 * 60 * 1000;
export const STALE_FAILED_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
export const STALE_DRAIN_LOCK_TTL_MS = 15 * 60 * 1000;
function safeSegment(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'unknown';
}
function shortHash(value) {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}
function nowMs(deps) {
    return typeof deps.now === 'function' ? deps.now() : Date.now();
}
function ensureFs(deps) {
    if (!deps.fs)
        throw new Error('missing fs dependency');
    return deps.fs;
}
function journalRootIsSafe(cwd, fs) {
    const root = path.resolve(cwd);
    const granadaDir = path.join(root, '.granada');
    const hooksDir = path.join(granadaDir, '.hooks');
    const queueDir = path.join(hooksDir, 'artifact-queue');
    for (const dir of [granadaDir, hooksDir, queueDir]) {
        if (!fs.existsSync(dir))
            return false;
        try {
            const stat = fs.lstatSync(dir);
            if (stat.isSymbolicLink() || !stat.isDirectory())
                return false;
        }
        catch {
            return false;
        }
    }
    return true;
}
function ensurePlainDir(fs, dir) {
    if (fs.existsSync(dir)) {
        const stat = fs.lstatSync(dir);
        if (stat.isSymbolicLink() || !stat.isDirectory())
            throw new Error(`unsafe journal path: ${dir}`);
        return;
    }
    fs.mkdirSync(dir, { mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(`unsafe journal path: ${dir}`);
}
function ensureSessionDir(cwd, sessionKey, fs) {
    const root = path.resolve(cwd);
    const granadaDir = path.join(root, '.granada');
    const hooksDir = path.join(granadaDir, '.hooks');
    const queueDir = path.join(hooksDir, 'artifact-queue');
    const sessionDir = path.join(queueDir, safeSegment(sessionKey));
    ensurePlainDir(fs, granadaDir);
    ensurePlainDir(fs, hooksDir);
    ensurePlainDir(fs, queueDir);
    ensurePlainDir(fs, sessionDir);
    return sessionDir;
}
function readJson(fs, filePath) {
    try {
        if (fs.lstatSync(filePath).isSymbolicLink())
            return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function pathIsPlainInside(fs, root, candidate) {
    try {
        const rootStat = fs.lstatSync(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
            return false;
        const candidateStat = fs.lstatSync(candidate);
        if (candidateStat.isSymbolicLink())
            return false;
        return isInside(path.resolve(root), path.resolve(candidate));
    }
    catch {
        return false;
    }
}
function removeJournalPath(fs, root, filePath) {
    if (!pathIsPlainInside(fs, root, filePath))
        return;
    try {
        fs.rmSync(filePath, { recursive: true, force: true });
    }
    catch {
        try {
            if (pathIsPlainInside(fs, root, filePath))
                fs.unlinkSync(filePath);
        }
        catch { }
    }
}
function pruneDirectoryIfEmpty(fs, root, dir) {
    try {
        if (!pathIsPlainInside(fs, root, dir))
            return;
        if (fs.readdirSync(dir).length === 0)
            fs.rmdirSync(dir);
    }
    catch { }
}
function isOlderThan(fs, filePath, timestampMs, ttlMs) {
    try {
        const stat = fs.lstatSync(filePath);
        if (stat.isSymbolicLink())
            return false;
        const age = timestampMs - stat.mtimeMs;
        return age > ttlMs;
    }
    catch {
        return false;
    }
}
export function getSessionKey(input, cwd, deps) {
    if (typeof input.session_id === 'string' && input.session_id)
        return `session-${safeSegment(input.session_id)}`;
    if (typeof input.transcript_path === 'string' && input.transcript_path)
        return `transcript-${shortHash(input.transcript_path)}`;
    const bucket = Math.floor(nowMs(deps) / (60 * 60 * 1000));
    return `fallback-${shortHash(path.resolve(cwd))}-${bucket}`;
}
export function getJournalRoot(cwd) {
    return path.join(path.resolve(cwd), '.granada', '.hooks', 'artifact-queue');
}
export function getSessionDir(cwd, sessionKey) {
    return path.join(getJournalRoot(cwd), safeSegment(sessionKey));
}
export function getSourceSnapshot(sourcePath, deps) {
    const fs = ensureFs(deps);
    try {
        const stat = fs.statSync(sourcePath);
        return { mtimeMs: stat.mtimeMs, size: stat.size };
    }
    catch {
        return null;
    }
}
export function sourceSnapshotMatches(sourcePath, snapshot, deps) {
    if (!snapshot)
        return false;
    const current = getSourceSnapshot(sourcePath, deps);
    return !!current && current.mtimeMs === snapshot.mtimeMs && current.size === snapshot.size;
}
export function cleanupStaleJournal(cwd, deps, options = {}) {
    const fs = ensureFs(deps);
    if (!journalRootIsSafe(cwd, fs))
        return;
    const root = getJournalRoot(cwd);
    if (!fs.existsSync(root))
        return;
    try {
        const rootStat = fs.lstatSync(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
            return;
    }
    catch {
        return;
    }
    const now = nowMs(deps);
    const journalTtl = options.staleJournalTtlMs ?? STALE_JOURNAL_TTL_MS;
    const failedTtl = options.staleFailedEntryTtlMs ?? STALE_FAILED_ENTRY_TTL_MS;
    for (const sessionName of fs.readdirSync(root)) {
        const sessionDir = path.join(root, sessionName);
        let stat;
        try {
            stat = fs.lstatSync(sessionDir);
        }
        catch {
            continue;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink())
            continue;
        for (const name of fs.readdirSync(sessionDir)) {
            const filePath = path.join(sessionDir, name);
            let fileStat;
            try {
                fileStat = fs.lstatSync(filePath);
            }
            catch {
                continue;
            }
            if (fileStat.isSymbolicLink())
                continue;
            const ttl = name.startsWith('failed-') ? failedTtl : journalTtl;
            if (isOlderThan(fs, filePath, now, ttl))
                removeJournalPath(fs, root, filePath);
        }
        pruneDirectoryIfEmpty(fs, root, sessionDir);
    }
    pruneDirectoryIfEmpty(fs, root, root);
}
export function appendJournalEntry(input, cwd, sourcePath, deps, options = {}) {
    const fs = ensureFs(deps);
    cleanupStaleJournal(cwd, deps, options);
    const sessionKey = getSessionKey(input, cwd, deps);
    const sessionDir = ensureSessionDir(cwd, sessionKey, fs);
    const createdAt = nowMs(deps);
    const entry = {
        version: 1,
        sessionKey,
        sourcePath: path.resolve(sourcePath),
        toolName: input.tool_name,
        toolUseId: typeof input.tool_use_id === 'string' ? input.tool_use_id : undefined,
        createdAt,
        cwd,
        transcriptPath: typeof input.transcript_path === 'string' ? input.transcript_path : undefined,
    };
    const base = `${createdAt}-${deps.pid || 'process'}-${safeSegment(entry.toolUseId || 'tool')}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const suffix = attempt === 0 ? '' : `-${attempt}`;
        const filePath = path.join(sessionDir, `${base}${suffix}.json`);
        try {
            const fd = fs.openSync(filePath, 'wx', 0o600);
            try {
                fs.writeFileSync(fd, JSON.stringify(entry, null, 2), 'utf8');
            }
            finally {
                fs.closeSync(fd);
            }
            return entry;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
    }
    throw new Error('failed to create unique artifact journal entry');
}
export function listSessionRecords(cwd, sessionKey, deps, options = {}) {
    const fs = ensureFs(deps);
    cleanupStaleJournal(cwd, deps, options);
    const sessionDir = getSessionDir(cwd, sessionKey);
    if (!fs.existsSync(sessionDir))
        return [];
    const records = [];
    for (const name of fs.readdirSync(sessionDir)) {
        if (!name.endsWith('.json') || name.startsWith('failed-'))
            continue;
        const filePath = path.join(sessionDir, name);
        const entry = readJson(fs, filePath);
        if (entry?.version === 1 && entry.sessionKey === sessionKey && typeof entry.sourcePath === 'string')
            records.push({ filePath, entry });
    }
    return records;
}
export function listSessionEntries(cwd, sessionKey, deps, options = {}) {
    return listSessionRecords(cwd, sessionKey, deps, options).map(record => record.entry);
}
export function getPendingSources(cwd, sessionKey, deps, options = {}) {
    const bySource = new Map();
    for (const entry of listSessionEntries(cwd, sessionKey, deps, options)) {
        bySource.set(path.resolve(entry.sourcePath), entry);
    }
    return Array.from(bySource.keys()).sort();
}
export function getPendingSourceRecords(cwd, sessionKey, deps, options = {}) {
    const recordsBySource = new Map();
    for (const record of listSessionRecords(cwd, sessionKey, deps, options)) {
        const source = path.resolve(record.entry.sourcePath);
        const records = recordsBySource.get(source) || [];
        records.push(record);
        recordsBySource.set(source, records);
    }
    for (const records of recordsBySource.values())
        records.sort((a, b) => a.entry.createdAt - b.entry.createdAt || a.filePath.localeCompare(b.filePath));
    return recordsBySource;
}
export function removeJournalRecords(cwd, records, deps) {
    const fs = ensureFs(deps);
    const root = getJournalRoot(cwd);
    for (const record of records)
        removeJournalPath(fs, root, record.filePath);
    const touchedDirs = new Set(records.map(record => path.dirname(record.filePath)));
    for (const dir of touchedDirs)
        pruneDirectoryIfEmpty(fs, root, dir);
}
export function removeEntriesForSource(cwd, sessionKey, sourcePath, deps) {
    const records = getPendingSourceRecords(cwd, sessionKey, deps).get(path.resolve(sourcePath)) || [];
    removeJournalRecords(cwd, records, deps);
}
function failedEntryPath(cwd, sessionKey, sourcePath) {
    return path.join(getSessionDir(cwd, sessionKey), `failed-${shortHash(path.resolve(sourcePath))}.json`);
}
export function writeFailureEntry(cwd, sessionKey, sourcePath, error, deps, timestampProcessed = false) {
    const fs = ensureFs(deps);
    const sessionDir = ensureSessionDir(cwd, sessionKey, fs);
    const failure = {
        version: 1,
        sessionKey,
        sourcePath: path.resolve(sourcePath),
        lastAttemptAt: nowMs(deps),
        lastError: error instanceof Error ? error.message : String(error),
        timestampProcessed,
        sourceSnapshot: getSourceSnapshot(sourcePath, deps) || undefined,
    };
    const finalPath = failedEntryPath(cwd, sessionKey, sourcePath);
    const temp = `${finalPath}.${deps.pid || 'process'}-${crypto.randomBytes(8).toString('hex')}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, JSON.stringify(failure, null, 2), 'utf8');
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, finalPath);
}
export function readFailureEntry(cwd, sessionKey, sourcePath, deps) {
    const fs = ensureFs(deps);
    return readJson(fs, failedEntryPath(cwd, sessionKey, sourcePath));
}
export function clearFailureEntry(cwd, sessionKey, sourcePath, deps) {
    const fs = ensureFs(deps);
    removeJournalPath(fs, getJournalRoot(cwd), failedEntryPath(cwd, sessionKey, sourcePath));
}
export function acquireDrainLock(cwd, sessionKey, deps, options = {}) {
    const fs = ensureFs(deps);
    const root = getJournalRoot(cwd);
    const sessionDir = ensureSessionDir(cwd, sessionKey, fs);
    const lockPath = path.join(sessionDir, '.drain.lock');
    const ttl = options.staleDrainLockTtlMs ?? STALE_DRAIN_LOCK_TTL_MS;
    const now = nowMs(deps);
    if (fs.existsSync(lockPath) && isOlderThan(fs, lockPath, now, ttl))
        removeJournalPath(fs, root, lockPath);
    try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
    }
    catch (error) {
        if (error.code === 'EEXIST')
            return null;
        throw error;
    }
    const metadataPath = path.join(lockPath, 'metadata.json');
    const fd = fs.openSync(metadataPath, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, JSON.stringify({ sessionKey, pid: deps.pid, createdAt: now }, null, 2), 'utf8');
    }
    finally {
        fs.closeSync(fd);
    }
    return {
        lockPath,
        release() {
            removeJournalPath(fs, root, lockPath);
        },
    };
}
