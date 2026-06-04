import crypto from 'node:crypto';
import path from 'node:path';
import type { HookDeps, HookInput } from '../types/hook.js';
import { isInside } from '../shared/artifact-source-policy.js';

export const STALE_JOURNAL_TTL_MS = 24 * 60 * 60 * 1000;
export const STALE_FAILED_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
export const STALE_DRAIN_LOCK_TTL_MS = 15 * 60 * 1000;

type Fs = NonNullable<HookDeps['fs']>;

export type ArtifactJournalEntry = {
  version: 1;
  sessionKey: string;
  sourcePath: string;
  toolName?: string;
  toolUseId?: string;
  createdAt: number;
  cwd?: string;
  transcriptPath?: string;
};

export type ArtifactJournalRecord = {
  filePath: string;
  entry: ArtifactJournalEntry;
};

export type SourceSnapshot = {
  mtimeMs: number;
  size: number;
};

export type ArtifactFailureEntry = {
  version: 1;
  sessionKey: string;
  sourcePath: string;
  lastAttemptAt: number;
  lastError: string;
  timestampProcessed?: boolean;
  sourceSnapshot?: SourceSnapshot;
};

export type ArtifactJournalOptions = {
  staleJournalTtlMs?: number;
  staleFailedEntryTtlMs?: number;
  staleDrainLockTtlMs?: number;
  keepLatestSourceRecord?: boolean;
};

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'unknown';
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function nowMs(deps: HookDeps): number {
  return typeof deps.now === 'function' ? deps.now() : Date.now();
}

function ensureFs(deps: HookDeps): Fs {
  if (!deps.fs) throw new Error('missing fs dependency');
  return deps.fs;
}

function journalRootIsSafe(cwd: string, fs: Fs): boolean {
  const root = path.resolve(cwd);
  const granadaDir = path.join(root, '.granada');
  const hooksDir = path.join(granadaDir, '.hooks');
  const queueDir = path.join(hooksDir, 'artifact-queue');
  for (const dir of [granadaDir, hooksDir, queueDir]) {
    if (!fs.existsSync(dir)) return false;
    try {
      const stat = fs.lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function ensurePlainDir(fs: Fs, dir: string): void {
  if (fs.existsSync(dir)) {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe journal path: ${dir}`);
    return;
  }
  fs.mkdirSync(dir, { mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe journal path: ${dir}`);
}

function ensureSessionDir(cwd: string, sessionKey: string, fs: Fs): string {
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

function readJson<T>(fs: Fs, filePath: string): T | null {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function pathIsPlainInside(fs: Fs, root: string, candidate: string): boolean {
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    const candidateStat = fs.lstatSync(candidate);
    if (candidateStat.isSymbolicLink()) return false;
    return isInside(path.resolve(root), path.resolve(candidate));
  } catch {
    return false;
  }
}

function removeJournalPath(fs: Fs, root: string, filePath: string): void {
  if (!pathIsPlainInside(fs, root, filePath)) return;
  try {
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch {
    try {
      if (pathIsPlainInside(fs, root, filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
}

function pruneDirectoryIfEmpty(fs: Fs, root: string, dir: string): void {
  try {
    if (!pathIsPlainInside(fs, root, dir)) return;
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {}
}

function isOlderThan(fs: Fs, filePath: string, timestampMs: number, ttlMs: number): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return false;
    const age = timestampMs - stat.mtimeMs;
    return age > ttlMs;
  } catch {
    return false;
  }
}

export function getSessionKey(input: HookInput, cwd: string, deps: HookDeps): string {
  if (typeof input.session_id === 'string' && input.session_id) return `session-${safeSegment(input.session_id)}`;
  if (typeof input.transcript_path === 'string' && input.transcript_path) return `transcript-${shortHash(input.transcript_path)}`;
  const bucket = Math.floor(nowMs(deps) / (60 * 60 * 1000));
  return `fallback-${shortHash(path.resolve(cwd))}-${bucket}`;
}

export function getJournalRoot(cwd: string): string {
  return path.join(path.resolve(cwd), '.granada', '.hooks', 'artifact-queue');
}

export function getSessionDir(cwd: string, sessionKey: string): string {
  return path.join(getJournalRoot(cwd), safeSegment(sessionKey));
}

export function getSourceSnapshot(sourcePath: string, deps: HookDeps): SourceSnapshot | null {
  const fs = ensureFs(deps);
  try {
    const stat = fs.statSync(sourcePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

export function sourceSnapshotMatches(sourcePath: string, snapshot: SourceSnapshot | undefined, deps: HookDeps): boolean {
  if (!snapshot) return false;
  const current = getSourceSnapshot(sourcePath, deps);
  return !!current && current.mtimeMs === snapshot.mtimeMs && current.size === snapshot.size;
}

export function cleanupStaleJournal(cwd: string, deps: HookDeps, options: ArtifactJournalOptions = {}): void {
  const fs = ensureFs(deps);
  if (!journalRootIsSafe(cwd, fs)) return;
  const root = getJournalRoot(cwd);
  if (!fs.existsSync(root)) return;
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
  } catch {
    return;
  }

  const now = nowMs(deps);
  const journalTtl = options.staleJournalTtlMs ?? STALE_JOURNAL_TTL_MS;
  const failedTtl = options.staleFailedEntryTtlMs ?? STALE_FAILED_ENTRY_TTL_MS;

  for (const sessionName of fs.readdirSync(root)) {
    const sessionDir = path.join(root, sessionName);
    let stat;
    try { stat = fs.lstatSync(sessionDir); } catch { continue; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    for (const name of fs.readdirSync(sessionDir)) {
      const filePath = path.join(sessionDir, name);
      let fileStat;
      try { fileStat = fs.lstatSync(filePath); } catch { continue; }
      if (fileStat.isSymbolicLink()) continue;
      const ttl = name.startsWith('failed-') ? failedTtl : journalTtl;
      if (isOlderThan(fs, filePath, now, ttl)) removeJournalPath(fs, root, filePath);
    }
    pruneDirectoryIfEmpty(fs, root, sessionDir);
  }
  pruneDirectoryIfEmpty(fs, root, root);
}

function removeSupersededSourceRecords(cwd: string, sessionKey: string, latestEntry: ArtifactJournalEntry, latestFilePath: string, deps: HookDeps): void {
  const records = getPendingSourceRecords(cwd, sessionKey, deps).get(path.resolve(latestEntry.sourcePath)) || [];
  const latestResolvedPath = path.resolve(latestFilePath);
  const superseded = records.filter(record => {
    if (path.resolve(record.filePath) === latestResolvedPath) return false;
    if (record.entry.createdAt < latestEntry.createdAt) return true;
    if (record.entry.createdAt > latestEntry.createdAt) return false;
    return record.filePath < latestFilePath;
  });
  removeJournalRecords(cwd, superseded, deps);
}

export function appendJournalEntry(input: HookInput, cwd: string, sourcePath: string, deps: HookDeps, options: ArtifactJournalOptions = {}): ArtifactJournalEntry {
  const fs = ensureFs(deps);
  cleanupStaleJournal(cwd, deps, options);
  const sessionKey = getSessionKey(input, cwd, deps);
  const sessionDir = ensureSessionDir(cwd, sessionKey, fs);

  const createdAt = nowMs(deps);
  const entry: ArtifactJournalEntry = {
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
      } finally {
        fs.closeSync(fd);
      }
      if (options.keepLatestSourceRecord) removeSupersededSourceRecords(cwd, sessionKey, entry, filePath, deps);
      return entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('failed to create unique artifact journal entry');
}

export function listSessionRecords(cwd: string, sessionKey: string, deps: HookDeps, options: ArtifactJournalOptions = {}): ArtifactJournalRecord[] {
  const fs = ensureFs(deps);
  cleanupStaleJournal(cwd, deps, options);
  const sessionDir = getSessionDir(cwd, sessionKey);
  if (!fs.existsSync(sessionDir)) return [];
  const records: ArtifactJournalRecord[] = [];
  for (const name of fs.readdirSync(sessionDir)) {
    if (!name.endsWith('.json') || name.startsWith('failed-')) continue;
    const filePath = path.join(sessionDir, name);
    const entry = readJson<ArtifactJournalEntry>(fs, filePath);
    if (entry?.version === 1 && entry.sessionKey === sessionKey && typeof entry.sourcePath === 'string') records.push({ filePath, entry });
  }
  return records;
}

export function listSessionEntries(cwd: string, sessionKey: string, deps: HookDeps, options: ArtifactJournalOptions = {}): ArtifactJournalEntry[] {
  return listSessionRecords(cwd, sessionKey, deps, options).map(record => record.entry);
}

export function getPendingSources(cwd: string, sessionKey: string, deps: HookDeps, options: ArtifactJournalOptions = {}): string[] {
  const bySource = new Map<string, ArtifactJournalEntry>();
  for (const entry of listSessionEntries(cwd, sessionKey, deps, options)) {
    bySource.set(path.resolve(entry.sourcePath), entry);
  }
  return Array.from(bySource.keys()).sort();
}

export function getPendingSourceRecords(cwd: string, sessionKey: string, deps: HookDeps, options: ArtifactJournalOptions = {}): Map<string, ArtifactJournalRecord[]> {
  const recordsBySource = new Map<string, ArtifactJournalRecord[]>();
  for (const record of listSessionRecords(cwd, sessionKey, deps, options)) {
    const source = path.resolve(record.entry.sourcePath);
    const records = recordsBySource.get(source) || [];
    records.push(record);
    recordsBySource.set(source, records);
  }
  for (const records of recordsBySource.values()) records.sort((a, b) => a.entry.createdAt - b.entry.createdAt || a.filePath.localeCompare(b.filePath));
  return recordsBySource;
}

export function removeJournalRecords(cwd: string, records: ArtifactJournalRecord[], deps: HookDeps): void {
  const fs = ensureFs(deps);
  const root = getJournalRoot(cwd);
  for (const record of records) removeJournalPath(fs, root, record.filePath);
  const touchedDirs = new Set(records.map(record => path.dirname(record.filePath)));
  for (const dir of touchedDirs) pruneDirectoryIfEmpty(fs, root, dir);
}

export function removeEntriesForSource(cwd: string, sessionKey: string, sourcePath: string, deps: HookDeps): void {
  const records = getPendingSourceRecords(cwd, sessionKey, deps).get(path.resolve(sourcePath)) || [];
  removeJournalRecords(cwd, records, deps);
}

function failedEntryPath(cwd: string, sessionKey: string, sourcePath: string): string {
  return path.join(getSessionDir(cwd, sessionKey), `failed-${shortHash(path.resolve(sourcePath))}.json`);
}

export function writeFailureEntry(cwd: string, sessionKey: string, sourcePath: string, error: unknown, deps: HookDeps, timestampProcessed = false): void {
  const fs = ensureFs(deps);
  const sessionDir = ensureSessionDir(cwd, sessionKey, fs);
  const failure: ArtifactFailureEntry = {
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
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, finalPath);
}

export function readFailureEntry(cwd: string, sessionKey: string, sourcePath: string, deps: HookDeps): ArtifactFailureEntry | null {
  const fs = ensureFs(deps);
  return readJson<ArtifactFailureEntry>(fs, failedEntryPath(cwd, sessionKey, sourcePath));
}

export function clearFailureEntry(cwd: string, sessionKey: string, sourcePath: string, deps: HookDeps): void {
  const fs = ensureFs(deps);
  removeJournalPath(fs, getJournalRoot(cwd), failedEntryPath(cwd, sessionKey, sourcePath));
}

export type DrainLock = {
  lockPath: string;
  release(): void;
};

export function acquireDrainLock(cwd: string, sessionKey: string, deps: HookDeps, options: ArtifactJournalOptions = {}): DrainLock | null {
  const fs = ensureFs(deps);
  const root = getJournalRoot(cwd);
  const sessionDir = ensureSessionDir(cwd, sessionKey, fs);
  const lockPath = path.join(sessionDir, '.drain.lock');
  const ttl = options.staleDrainLockTtlMs ?? STALE_DRAIN_LOCK_TTL_MS;
  const now = nowMs(deps);

  if (fs.existsSync(lockPath) && isOlderThan(fs, lockPath, now, ttl)) removeJournalPath(fs, root, lockPath);

  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }

  const metadataPath = path.join(lockPath, 'metadata.json');
  const fd = fs.openSync(metadataPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ sessionKey, pid: deps.pid, createdAt: now }, null, 2), 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  return {
    lockPath,
    release() {
      removeJournalPath(fs, root, lockPath);
    },
  };
}
