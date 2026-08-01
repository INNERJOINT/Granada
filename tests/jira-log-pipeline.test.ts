import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function shellBlocks(markdown: string): string {
  return [...markdown.matchAll(/```([^\r\n]*)\r?\n([\s\S]*?)```/g)]
    .filter(match => ['', 'bash', 'sh', 'shell', 'console'].includes(match[1].trim().toLowerCase()))
    .map(match => match[2])
    .join('\n')
    .replace(/\\\r?\n\s*/g, ' ');
}

function jiraToolTokens(markdown: string): string[] {
  return [...markdown.matchAll(/\bmcp__[A-Za-z0-9_]+__jira_(?:get_issue|download_attachments)\b/g)]
    .map(match => match[0]);
}

function agentSurfaces(name: string): string[] {
  return [readFileSync(join(root, 'agents', `${name}.md`), 'utf8')];
}

function skillSurfaces(name: string): string[] {
  return [readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8')];
}

function sectionBetween(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}

function expectOrdered(text: string, tokens: string[]): void {
  let previous = -1;
  for (const token of tokens) {
    const index = text.indexOf(token, previous + 1);
    expect(index, `missing or out-of-order token: ${token}`).toBeGreaterThan(previous);
    previous = index;
  }
}

function handoffValidatorSource(markdown: string): string {
  const collection = sectionBetween(markdown, '## Phase 2: JIRA Data Collection', '## Phase 3: Log Parsing');
  const match = collection.match(/TEMP_DIR="\$temp_dir" node <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/);
  expect(match, 'missing deterministic handoff validator').toBeTruthy();
  return match![1];
}

function stageValidatorSource(markdown: string): string {
  const staging = sectionBetween(markdown, '## Private Staging, Sandbox, and No-Follow Merge', '## JIRA Mode');
  const match = staging.match(/node <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/);
  expect(match, 'missing deterministic stage validator').toBeTruthy();
  return match![1];
}

describe('JIRA log pipeline safety', () => {
  it('uses the Claude Code plugin namespace for collector JIRA tools', () => {
    const collector = readFileSync(join(root, 'agents', 'aosp-log-collector.md'), 'utf8');
    const allowedTools = new Set([
      'mcp__plugin_zaku_atlassian__jira_get_issue',
      'mcp__plugin_zaku_atlassian__jira_download_attachments',
    ]);

    const tokens = jiraToolTokens(collector);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every(token => allowedTools.has(token))).toBe(true);
    expect(collector).toContain('Call `mcp__plugin_zaku_atlassian__jira_get_issue(issue_key=<KEY>, comment_limit=0)`');
    expect(collector).toContain('Call `mcp__plugin_zaku_atlassian__jira_download_attachments(issue_key=<KEY>)`');
    expect(collector).not.toContain('mcp__atlassian__');
    expect(collector).not.toMatch(/(?<![A-Za-z0-9_])jira_(?:get_issue|download_attachments)\b/);
  });

  it('uses only documented log-unboxer commands for supported attachments', () => {
    const surfaces = agentSurfaces('aosp-log-collector');
    const downloadCommand = /"\$log_unboxer_bin" download "\$serial_number"\s+--output-dir "\$stage_output"\s+--days 90\s+--workers 4/;

    for (const surface of surfaces) {
      const commands = shellBlocks(surface);
      expect(commands.match(/"\$log_unboxer_bin" --version\b/g) ?? []).toHaveLength(1);
      expect(commands.match(/"\$log_unboxer_bin" unpack\b/g) ?? []).toHaveLength(1);
      expect(commands.match(/"\$log_unboxer_bin" download\b/g) ?? []).toHaveLength(1);
      expect(commands).not.toMatch(/(?:^|\n)\s*log-unboxer\s+(?:--version|unpack|download)\b/);
      expect(commands).toContain('"$log_unboxer_bin" unpack "$archive_path" --output-dir "$stage_output"');
      expect(commands).toContain('archive_control=$(mktemp -d "${temp_dir%/}/archive-control-${archive_index}.XXXXXX")');
      expect(commands).toContain('download_stderr="${download_control}/download.stderr"');
      expect(commands).toContain('CONTROL_ROOT="$temp_dir"');
      expect(commands).toContain('bwrap --die-with-parent --new-session');
      expect(commands).toContain('--unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup');
      expect(commands).toContain('--unshare-net');
      expect(commands).toContain('--clearenv');
      expect(commands).toContain('--ro-bind / /');
      expect(commands).toContain('--dev /dev');
      expect(commands).toContain('-- "$log_unboxer_python" -');
      expect(commands).not.toContain('--dev-bind /dev /dev');
      expect(commands).not.toContain('--share-net');
      expect(commands).toMatch(downloadCommand);
      expect(commands).toContain('base64 -d < "$b64_path" > "$archive_path"');
      expect(commands).toContain('base64 -d < "$b64_path" > "$decoded_path"');
      expect(commands).toContain('log_unboxer_bin=$(command -v log-unboxer)');
      expect(commands).toContain('hasattr(tarfile, "data_filter")');
      expect(commands).toContain('(3, 12): (3, 12, 11)');
      expect(commands).toContain('getattr(unpacker, "_EXTRACT_KW", None) != {"filter": "data"}');
      expect(commands).toContain('unsafe archive extraction canary failed');
      expect(commands).not.toMatch(/(^|\s)--sn(?:\s|$)/);
      expect(commands).not.toMatch(/(^|\s)--(?:url|limit)(?:\s|$)/);
      expect(commands).not.toMatch(/\b(?:unzip|tar|7z)\b/);
      expect(commands).not.toMatch(/log-unboxer\s+unpack\b[^;\n]*(?:zip_path|\.zip)/);
      expect(commands).not.toMatch(/\b(?:pipx|pip|uv|apt(?:-get)?|brew)\s+(?:install|uninstall|reinstall|upgrade)\b/);
      expect(commands).not.toMatch(/\bcurl\b[^\n|]*\|\s*(?:sh|bash)\b/);

      expect(surface).toContain('**Supported archive**: `.tgz` or `.tar.gz`');
      expect(surface).toContain('**Supported direct log**: `.txt` or `.log`');
      expect(surface).toContain('**Unsupported**: `.zip`');
      expect(surface).toContain('validated, case-insensitive filename suffix');
      expect(surface).toContain('Direct logs do not require `log-unboxer`');
      expect(surface).toContain('never install, uninstall, reinstall, or upgrade it from the collector');
      expect(surface).toContain('^[A-Za-z0-9][A-Za-z0-9._-]*$');
    }
  });

  it('preserves collector fallback, partial-output, and manifest semantics', () => {
    const surfaces = agentSurfaces('aosp-log-collector');
    const parser = readFileSync(join(root, 'agents', 'aosp-log-parser.md'), 'utf8');
    const reasons = [
      'ISSUE_METADATA_FAILED',
      'LOG_UNBOXER_UNAVAILABLE',
      'LOG_UNBOXER_UNSAFE_RUNTIME',
      'LOG_UNBOXER_SANDBOX_UNAVAILABLE',
      'ATTACHMENT_METADATA_FAILED',
      'ATTACHMENT_SIZE_UNSAFE',
      'MCP_DOWNLOAD_FAILED',
      'BASE64_DECODE_FAILED',
      'ARCHIVE_UNPACK_FAILED',
      'ARCHIVE_UNPACK_PARTIAL',
      'ARCHIVE_UNPACK_EMPTY',
      'ARCHIVE_STAGE_INVALID',
      'OUTPUT_COLLISION',
      'SN_NOT_FOUND_OR_INVALID',
      'SN_FALLBACK_BLOCKED',
      'SN_DOWNLOAD_PARTIAL',
      'SN_STAGE_INVALID',
      'SN_RESPONSE_IDENTITY_MISMATCH',
      'SN_DOWNLOAD_FAILED',
      'SN_DOWNLOAD_EMPTY',
    ];
    const manifestTypes = 'logcat|tombstone|anr|kernel|other';

    for (const surface of surfaces) {
      expect(surface.indexOf('### Step J4: Evaluate Attachment Results'))
        .toBeLessThan(surface.indexOf('### Step J5: One-Time SN Fallback Download'));
      expect(surface).toContain('Do not run SN fallback.');
      expect(surface).toContain('only when Steps J2-J4 yielded no parseable log files');
      expect(surface).toContain('Run this step at most once');
      expect(surface).toContain('Evaluate staged output even when `download_status` is non-zero');
      expect(surface).toContain('Parseable merged files plus non-zero exit');
      expect(surface).toContain('report `PARTIAL`');
      expect(surface).toContain('A non-zero `log-unboxer` exit does not by itself prove collection failed');
      expect(surface).toContain('Private Staging, Sandbox, and No-Follow Merge');
      expect(surface).toContain('LOG_UNBOXER_SANDBOX_UNAVAILABLE');
      expect(surface).toContain('Every archive/SN operation ran in its own private sandbox stage');
      expect(surface).toContain('Never give `log-unboxer` write access to `<extracted_dir>`');
      expect(surface).toContain('Every invocation that imports or executes `log_unboxer` must already be inside the offline sandbox');
      expect(surface).toContain('never bind the host `/dev` writable');
      expect(surface).toContain('control files in a separate private control directory');
      expect(surface).toContain('control file must remain outside writable stage');
      expect(surface).toContain('A filename-set comparison alone is forbidden');
      expect(surface).toContain('exactly one real top-level directory under `output/`, named exactly the validated requested `$serial_number`');
      expect(surface).toContain('Direct `.txt` / `.log` attachments remain usable even when `log-unboxer` is unavailable');
      expect(surface).toContain('Collection attempts');
      expect(surface).toContain('Failure codes observed');
      expect(surface).toContain('SN fallback: NOT_RUN | SUCCESS | PARTIAL | FAILED | BLOCKED');
      expect(surface).toContain('NOT_APPLICABLE (local mode)');
      expect(surface).toContain('SN fallback: NOT_RUN — SN_NOT_FOUND_OR_INVALID');
      expect(surface).toContain('A later successful SN fallback never erases an earlier sticky error');
      expect(surface).toContain('Do not probe the CLI in this branch');
      expect(surface).toContain('SN fallback: BLOCKED — <availability/safety/sandbox reason>');
      expect(surface).toContain('ARCHIVE_UNPACK_PARTIAL');
      expect(surface).toContain('SN_DOWNLOAD_PARTIAL');
      expect(surface).toContain('traceback, exception, or explicit per-file processing failure');
      expect(surface).toContain('Filter checks alone—including `hasattr(tarfile, "data_filter")`—are insufficient');
      expect(surface).toContain('3.12.11+');
      expect(surface).toContain('traversal/absolute/symlink/hardlink canaries');
      for (const reason of reasons) expect(surface).toContain(reason);
      expect(surface).toContain(`flat JSON object mapping relative filenames to \`${manifestTypes}\``);

      const issueMetadata = sectionBetween(surface, '### Step J1: Fetch Issue Details', '### Step J2: Inspect Attachment Metadata');
      expect(issueMetadata).toContain('Stop immediately');
      expect(issueMetadata).toContain('Do not call attachment metadata/download tools or `log-unboxer`');

      const fallback = sectionBetween(surface, '### Step J5: One-Time SN Fallback Download', '### Step J6: Report Issue Context');
      expectOrdered(fallback, [
        'If no valid SN exists',
        'Do not probe the CLI in this branch',
        'Only after a valid SN is available',
        'SN_FALLBACK_BLOCKED',
        '"$log_unboxer_bin" download "$serial_number"',
      ]);
    }

    expect(parser).toContain(`{"filename": "${manifestTypes}", ...}`);
  });

  it('rejects unsafe or inconsistent classification manifests before parsing', () => {
    for (const surface of agentSurfaces('aosp-log-parser')) {
      expect(surface).toContain('Workspace roots');
      expect(surface).toContain('Manifest file exists safely');
      expect(surface).toContain('Valid flat JSON object');
      expect(surface).toContain('Safe relative manifest keys');
      expect(surface).toContain('Unsafe classification manifest key: <key>');
      expect(surface).toContain('never echo raw manifest bytes');
      expect(surface).not.toContain('raw first 200 characters');
      expect(surface).toContain('without following symlinks');
      expect(surface).toContain('Exact file-set match');
      expect(surface).toContain('Never follow symlinks or read a manifest path that escapes `<temp_dir>/extracted/`');
      expectOrdered(surface, [
        'Valid flat JSON object',
        'At least one parseable type',
        'Safe relative manifest keys',
        'Manifest-to-disk consistency',
        'Disk-to-manifest consistency',
        'Exact file-set match',
      ]);
    }
  });

  it('creates unique JIRA workspaces and validates current-run artifacts before parsing', () => {
    for (const surface of skillSurfaces('jira-analyze')) {
      const initialize = sectionBetween(surface, '## Phase 1: Initialize', '## Phase 2: JIRA Data Collection');
      expectOrdered(initialize, [
        'Validate the extracted key',
        'JIRA MCP health check',
        'mktemp -d "/tmp/jira-analyze-${issue_key}.XXXXXX"',
        'mkdir -p -- "$extracted_dir" || exit 1',
      ]);
      expect(initialize).toContain('[[ -d "$temp_dir" && ! -L "$temp_dir" ]] || exit 1');
      expect(initialize).toContain('[[ -d "$extracted_dir" && ! -L "$extracted_dir" ]] || exit 1');
      expect(initialize).toContain('A unique directory prevents stale-artifact reuse and same-issue concurrent-run interference');
      expect(initialize).toContain('Preserve this current-run workspace on failure');
      expect(initialize).not.toContain('rm -rf');
      expect(surface).not.toContain('/tmp/jira-analyze-<KEY>');

      const collection = sectionBetween(surface, '## Phase 2: JIRA Data Collection', '## Phase 3: Log Parsing');
      expect(collection).toContain('Enforce the parser handoff gate');
      expect(collection).toContain('non-empty flat JSON object');
      expect(collection).toContain('at least one `logcat|tombstone|anr|kernel` entry');
      expect(collection).toContain('exact manifest-to-disk and disk-to-manifest set equality');
      expect(collection).toContain('Log collection handoff invalid — <specific reason>');
      expect(collection).toContain('do not spawn the parser, call Sourcepilot, generate Why seeds/RCA, or post a JIRA comment');
      expect(collection).toContain('do not replace it with an informal visual check');
      expect(collection).toContain('A `PARTIAL` collector result may continue only when this command exits zero');
      expect(surface).toContain('Collector or parser agent timeout/failure');
      expect(surface).toContain('never reuse existing artifacts from an earlier run');

      expectOrdered(surface, [
        'mktemp -d "/tmp/jira-analyze-${issue_key}.XXXXXX"',
        '## Phase 2: JIRA Data Collection',
        'Enforce the parser handoff gate',
        'TEMP_DIR="$temp_dir" node',
        '## Phase 3: Log Parsing',
      ]);
    }
  });

  it('canonicalizes local input paths before structure-preserving copy', () => {
    for (const surface of agentSurfaces('aosp-log-collector')) {
      const localMode = sectionBetween(surface, '## Local Directory Mode', '## Classification Rules');
      expect(localMode).toContain('input_root=$(realpath -e -- "$input_path") || exit 1');
      expect(localMode).toContain('canonical_extracted=$(realpath -e -- "$extracted_dir") || exit 1');
      expect(localMode).toContain('cd -- "$input_root" || exit 1');
      expect(localMode).toContain('find -P . -type f -exec cp --parents --no-dereference');
      expect(localMode).toContain('Never run `cp --parents` on the original caller-supplied path');
      expect(localMode).not.toContain('find "$input_path" -type f -exec cp --parents');
    }

    const rootDir = mkdtempSync(join(tmpdir(), 'granada-local-collector-'));
    const sourceDir = join(rootDir, 'source');
    const workingDir = join(rootDir, 'work', 'deep');
    const tempDir = join(rootDir, 'temp');
    const extractedDir = join(tempDir, 'extracted');
    mkdirSync(join(sourceDir, 'nested'), { recursive: true });
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(extractedDir, { recursive: true });
    writeFileSync(join(sourceDir, 'nested', 'logcat.txt'), '--------- beginning of main\n');
    writeFileSync(join(rootDir, 'sentinel.txt'), 'unchanged');

    const canonical = agentSurfaces('aosp-log-collector')[0];
    const localCommands = shellBlocks(sectionBetween(canonical, '## Local Directory Mode', '## Classification Rules'));
    const run = spawnSync('/bin/bash', ['-c', [
      'set -e',
      'input_path="$INPUT_PATH"',
      'temp_dir="$TEMP_DIR"',
      'extracted_dir="$EXTRACTED_DIR"',
      localCommands,
    ].join('\n')], {
      cwd: workingDir,
      env: {
        ...process.env,
        INPUT_PATH: '../../source',
        TEMP_DIR: tempDir,
        EXTRACTED_DIR: extractedDir,
      },
      encoding: 'utf8',
      timeout: 5000,
    });

    try {
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(0);
      expect(readFileSync(join(extractedDir, 'nested', 'logcat.txt'), 'utf8')).toContain('beginning of main');
      expect(readFileSync(join(rootDir, 'sentinel.txt'), 'utf8')).toBe('unchanged');
      expect(existsSync(join(rootDir, 'source', 'source', 'nested', 'logcat.txt'))).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps host paths read-only outside the private bubblewrap stage', () => {
    if (process.platform !== 'linux' || spawnSync('bwrap', ['--version']).status !== 0) return;

    const stageDir = mkdtempSync(join(tmpdir(), 'granada-bwrap-stage-'));
    const controlDir = mkdtempSync(join(tmpdir(), 'granada-bwrap-control-'));
    const controlPath = join(controlDir, 'command.stderr');
    writeFileSync(controlPath, 'original');
    const marker = `/dev/shm/granada-bwrap-${process.pid}-${stageDir.split('/').at(-1)}`;
    rmSync(marker, { force: true });
    try {
      const run = spawnSync('bwrap', [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--unshare-cgroup',
        '--unshare-net',
        '--ro-bind', '/', '/',
        '--dev', '/dev',
        '--proc', '/proc',
        '--bind', stageDir, stageDir,
        '--', '/bin/sh', '-c',
        'printf ok > "$1/stage-write"; printf isolated > "$2"; if printf tamper > "$3"; then exit 22; fi',
        'sh', stageDir, marker, controlPath,
      ], { encoding: 'utf8', timeout: 5000 });

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(0);
      expect(readFileSync(join(stageDir, 'stage-write'), 'utf8')).toBe('ok');
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(controlPath, 'utf8')).toBe('original');
    } finally {
      rmSync(marker, { force: true });
      rmSync(stageDir, { recursive: true, force: true });
      rmSync(controlDir, { recursive: true, force: true });
    }
  });

  it('validates staged log-unboxer output before no-follow merge', () => {
    const source = stageValidatorSource(agentSurfaces('aosp-log-collector')[0]);
    const roots: string[] = [];
    const createFixture = (topDirectory?: string) => {
      const rootDir = mkdtempSync(join(tmpdir(), 'granada-log-stage-'));
      roots.push(rootDir);
      const stageDir = join(rootDir, 'stage');
      const stageOutput = join(stageDir, 'output');
      const controlDir = join(rootDir, 'controls');
      const extractedDir = join(rootDir, 'extracted');
      mkdirSync(stageOutput, { recursive: true, mode: 0o700 });
      mkdirSync(controlDir, { mode: 0o700 });
      mkdirSync(extractedDir, { mode: 0o700 });
      chmodSync(stageDir, 0o700);
      const stdoutPath = join(controlDir, 'command.stdout');
      const stderrPath = join(controlDir, 'command.stderr');
      writeFileSync(stdoutPath, 'bounded output\n');
      writeFileSync(stderrPath, '');
      const contentRoot = topDirectory ? join(stageOutput, topDirectory) : stageOutput;
      if (topDirectory) mkdirSync(contentRoot, { mode: 0o700 });
      writeFileSync(join(contentRoot, 'logcat.txt'), '--------- beginning of main\n');
      return { rootDir, stageDir, stageOutput, controlDir, stdoutPath, stderrPath, extractedDir };
    };
    const validate = (
      fixture: ReturnType<typeof createFixture>,
      destinationRelative = 'attachments/0001-test',
      expectedTop = '',
    ) => spawnSync(process.execPath, ['-e', source], {
      env: {
        ...process.env,
        STAGE_DIR: fixture.stageDir,
        STAGE_OUTPUT: fixture.stageOutput,
        CONTROL_ROOT: fixture.rootDir,
        STAGE_CONTROLS: `${fixture.stdoutPath},${fixture.stderrPath}`,
        EXTRACTED_DIR: fixture.extractedDir,
        DEST_RELATIVE: destinationRelative,
        EXPECTED_TOP: expectedTop,
      },
      encoding: 'utf8',
      timeout: 5000,
    });

    try {
      const valid = createFixture();
      expect(validate(valid).status).toBe(0);
      expect(readFileSync(join(valid.extractedDir, 'attachments', '0001-test', 'logcat.txt'), 'utf8'))
        .toContain('beginning of main');

      const unexpectedSibling = createFixture();
      writeFileSync(join(unexpectedSibling.stageDir, 'escaped.txt'), 'escaped\n');
      expect(validate(unexpectedSibling).status).not.toBe(0);

      const identityMismatch = createFixture('remote-value');
      expect(validate(identityMismatch, 'sn-fallback/REQUESTED', 'REQUESTED').status).not.toBe(0);

      const collision = createFixture();
      mkdirSync(join(collision.extractedDir, 'attachments'), { mode: 0o700 });
      mkdirSync(join(collision.extractedDir, 'attachments', '0001-test'), { mode: 0o700 });
      expect(validate(collision).status).not.toBe(0);

      if (process.platform !== 'win32') {
        const linked = createFixture();
        symlinkSync('/tmp', join(linked.stageOutput, 'pivot'));
        expect(validate(linked).status).not.toBe(0);

        const hardlinked = createFixture();
        linkSync(join(hardlinked.stageOutput, 'logcat.txt'), join(hardlinked.stageOutput, 'duplicate.txt'));
        expect(validate(hardlinked).status).not.toBe(0);
      }
    } finally {
      for (const rootDir of roots) rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('executes the handoff validator against valid and adversarial fixtures', () => {
    const source = handoffValidatorSource(skillSurfaces('jira-analyze')[0]);
    const roots: string[] = [];
    const createRun = (manifest: Record<string, string>, files: Record<string, string>): string => {
      const runRoot = mkdtempSync(join(tmpdir(), 'granada-log-handoff-'));
      roots.push(runRoot);
      const extracted = join(runRoot, 'extracted');
      mkdirSync(extracted);
      for (const [name, contents] of Object.entries(files)) writeFileSync(join(extracted, name), contents);
      writeFileSync(join(runRoot, 'file-classification.json'), JSON.stringify(manifest));
      return runRoot;
    };
    const validate = (runRoot: string) => spawnSync(process.execPath, ['-e', source], {
      env: { ...process.env, TEMP_DIR: runRoot },
      encoding: 'utf8',
      timeout: 5000,
    });

    try {
      const valid = createRun({ 'logcat.txt': 'logcat' }, { 'logcat.txt': '--------- beginning of main\n' });
      expect(validate(valid).status).toBe(0);

      const empty = createRun({}, {});
      expect(validate(empty).status).not.toBe(0);

      const allOther = createRun({ 'misc.txt': 'other' }, { 'misc.txt': 'not an Android log\n' });
      expect(validate(allOther).status).not.toBe(0);

      const unclassified = createRun(
        { 'logcat.txt': 'logcat' },
        { 'logcat.txt': '--------- beginning of main\n', 'extra.txt': 'stale\n' },
      );
      expect(validate(unclassified).status).not.toBe(0);

      const traversal = createRun({ '../outside.log': 'logcat' }, {});
      writeFileSync(join(traversal, 'outside.log'), '--------- beginning of main\n');
      expect(validate(traversal).status).not.toBe(0);

      if (process.platform !== 'win32') {
        const linkedManifest = createRun({ 'logcat.txt': 'logcat' }, { 'logcat.txt': '--------- beginning of main\n' });
        const manifestPath = join(linkedManifest, 'file-classification.json');
        const manifestTarget = join(linkedManifest, 'manifest-target.json');
        writeFileSync(manifestTarget, readFileSync(manifestPath, 'utf8'));
        rmSync(manifestPath);
        symlinkSync(manifestTarget, manifestPath);
        expect(validate(linkedManifest).status).not.toBe(0);

        const linkedRoot = mkdtempSync(join(tmpdir(), 'granada-log-handoff-linked-'));
        roots.push(linkedRoot);
        const outside = mkdtempSync(join(tmpdir(), 'granada-log-handoff-outside-'));
        roots.push(outside);
        writeFileSync(join(outside, 'logcat.txt'), '--------- beginning of main\n');
        symlinkSync(outside, join(linkedRoot, 'extracted'));
        writeFileSync(join(linkedRoot, 'file-classification.json'), JSON.stringify({ 'logcat.txt': 'logcat' }));
        expect(validate(linkedRoot).status).not.toBe(0);
      }
    } finally {
      for (const runRoot of roots) rmSync(runRoot, { recursive: true, force: true });
    }
  });
});
