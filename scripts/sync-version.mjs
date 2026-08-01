import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node sync-version.mjs <version>');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semantic version: ${version}`);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { path: '.claude-plugin/plugin.json', jsonpath: ['version'] },
  { path: '.claude-plugin/marketplace.json', jsonpath: ['version'] },
  { path: '.claude-plugin/marketplace.json', jsonpath: ['plugins', 0, 'version'] },
];

for (const { path, jsonpath } of targets) {
  const absolutePath = join(root, path);
  const content = JSON.parse(readFileSync(absolutePath, 'utf8'));
  let obj = content;
  for (let i = 0; i < jsonpath.length - 1; i++) {
    obj = obj?.[jsonpath[i]];
    if (!obj || typeof obj !== 'object') {
      throw new Error(`Cannot update ${path}: missing JSON path ${jsonpath.slice(0, i + 1).join('.')}`);
    }
  }
  obj[jsonpath[jsonpath.length - 1]] = version;
  writeFileSync(absolutePath, JSON.stringify(content, null, 2) + '\n');
  console.log(`Updated ${path} → ${version}`);
}
