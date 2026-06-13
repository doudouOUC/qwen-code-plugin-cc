import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'qwen');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readPlugin(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), 'utf8');
}

function createFakeQwen() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-plugin-'));
  const fakeQwenPath = path.join(tempDir, 'qwen');
  const argsPath = path.join(tempDir, 'args.json');

  fs.writeFileSync(
    fakeQwenPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "0.18.0"',
      '  exit 0',
      'fi',
      'node -e \'require("fs").writeFileSync(process.env.QWEN_FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(1)))\' -- "$@"',
    ].join('\n'),
  );
  fs.chmodSync(fakeQwenPath, 0o755);

  return { tempDir, argsPath };
}

test('marketplace exposes the qwen plugin', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');

  assert.equal(marketplace.name, 'qwen-code');
  assert.equal(marketplace.metadata.version, '0.1.1');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'qwen');
  assert.equal(marketplace.plugins[0].version, '0.1.1');
  assert.equal(marketplace.plugins[0].source, './plugins/qwen');
});

test('plugin manifest uses the expected Claude Code plugin name', () => {
  const plugin = readJson('plugins/qwen/.claude-plugin/plugin.json');

  assert.equal(plugin.name, 'qwen');
  assert.equal(plugin.version, '0.1.1');
});

test('review command is a deterministic review-only forwarder', () => {
  const source = readPlugin('commands/review.md');

  assert.match(source, /disable-model-invocation:\s*true/);
  assert.match(source, /review-only/i);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /disallowed-tools:/);
  assert.match(source, /Write/);
  assert.match(source, /Edit/);
  assert.doesNotMatch(source, /Bash\(git:\*\)/);
  assert.match(source, /qwen-companion\.mjs" review "\$ARGUMENTS"/);
  assert.match(source, /Return stdout verbatim/i);
});

test('setup command points users to the companion script', () => {
  const source = readPlugin('commands/setup.md');

  assert.match(source, /disable-model-invocation:\s*true/);
  assert.match(source, /qwen-companion\.mjs" setup "\$ARGUMENTS"/);
});

test('companion reports missing qwen with install guidance', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN_ROOT, 'scripts', 'qwen-companion.mjs'), 'setup'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: '',
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /qwen: not found/);
  assert.match(result.stdout, /npm install -g @qwen-code\/qwen-code/);
});

test('review forwards raw arguments with a review-only system prompt', () => {
  const { tempDir, argsPath } = createFakeQwen();

  const result = spawnSync(
    process.execPath,
    [
      path.join(PLUGIN_ROOT, 'scripts', 'qwen-companion.mjs'),
      'review',
      '123 --comment',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tempDir}${path.delimiter}${process.env.PATH ?? ''}`,
        QWEN_FAKE_ARGS_FILE: argsPath,
      },
    },
  );

  assert.equal(result.status, 0);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  assert.deepEqual(forwardedArgs.slice(-2), ['--prompt', '/review 123 --comment']);
  assert.ok(forwardedArgs.includes('--sandbox'));

  const systemPromptIndex = forwardedArgs.indexOf('--append-system-prompt');
  assert.notEqual(systemPromptIndex, -1);
  assert.match(forwardedArgs[systemPromptIndex + 1], /review-only/i);
  assert.match(forwardedArgs[systemPromptIndex + 1], /Do not apply autofixes/i);
});

test('review sandbox can be explicitly disabled for constrained environments', () => {
  const { tempDir, argsPath } = createFakeQwen();

  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN_ROOT, 'scripts', 'qwen-companion.mjs'), 'review'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tempDir}${path.delimiter}${process.env.PATH ?? ''}`,
        QWEN_FAKE_ARGS_FILE: argsPath,
        QWEN_PLUGIN_NO_SANDBOX: '1',
      },
    },
  );

  assert.equal(result.status, 0);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  assert.equal(forwardedArgs.includes('--sandbox'), false);
});
