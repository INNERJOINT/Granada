import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node sync-version.mjs <version>');
  process.exit(1);
}

const targets = [
  { path: '.claude-plugin/plugin.json', jsonpath: ['version'] },
  { path: '.claude-plugin/marketplace.json', jsonpath: ['version'] },
  { path: '.claude-plugin/marketplace.json', jsonpath: ['plugins', 0, 'version'] },
];

for (const { path, jsonpath } of targets) {
  const content = JSON.parse(readFileSync(path, 'utf8'));
  let obj = content;
  for (let i = 0; i < jsonpath.length - 1; i++) {
    obj = obj[jsonpath[i]];
  }
  obj[jsonpath[jsonpath.length - 1]] = version;
  writeFileSync(path, JSON.stringify(content, null, 2) + '\n');
  console.log(`Updated ${path} → ${version}`);
}
