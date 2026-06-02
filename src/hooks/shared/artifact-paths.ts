import path from 'node:path';

const TIMESTAMP_PREFIX = /^\d{8}-\d{6}-/;

export function stripLeadingTimestamp(basename: string): string {
  return basename.replace(TIMESTAMP_PREFIX, '');
}

export function getZhSiblingPath(sourcePath: string): string {
  const basename = path.basename(sourcePath);
  return path.join(path.dirname(sourcePath), `${basename.slice(0, -3)}_zh.md`);
}
