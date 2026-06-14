import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'qwen');
const COMPANION = path.join(PLUGIN_ROOT, 'scripts', 'qwen-companion.mjs');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readPlugin(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), 'utf8');
}

function createFakeQwen(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-plugin-'));
  const fakeQwenPath = path.join(tempDir, 'qwen');
  const argsPath = path.join(tempDir, 'args.json');
  const mode = options.mode ?? 'success';

  const body =
    mode === 'slow'
      ? [
          'trap "exit 143" TERM',
          'printf \'%s\\n\' \'{"type":"system","subtype":"session_start","session_id":"session-slow"}\'',
          'sleep 30',
        ]
      : [
          'printf \'%s\\n\' \'{"type":"system","subtype":"session_start","session_id":"session-1"}\'',
          'printf \'%s\\n\' \'{"type":"assistant","message":{"content":[{"type":"text","text":"Review body"}]}}\'',
          'printf \'%s\\n\' \'{"type":"result","subtype":"success","result":"Review body","session_id":"session-1"}\'',
        ];

  fs.writeFileSync(
    fakeQwenPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "0.18.0"',
      '  exit 0',
      'fi',
      'if [ -n "$QWEN_FAKE_ARGS_FILE" ]; then',
      '  node -e \'require("fs").writeFileSync(process.env.QWEN_FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(1)))\' -- "$@"',
      'fi',
      ...body,
    ].join('\n'),
  );
  fs.chmodSync(fakeQwenPath, 0o755);

  return { tempDir, argsPath };
}

function createFakeEnv(options = {}) {
  const fake = createFakeQwen(options);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-plugin-state-'));

  return {
    ...fake,
    stateDir,
    env: {
      ...process.env,
      PATH: `${fake.tempDir}${path.delimiter}${process.env.PATH ?? ''}`,
      QWEN_FAKE_ARGS_FILE: fake.argsPath,
      QWEN_PLUGIN_STATE_DIR: stateDir,
    },
  };
}

function runCompanion(args, env) {
  return spawnSync(process.execPath, [COMPANION, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
}

function extractJobId(stdout) {
  const match = stdout.match(/qwen-review-[a-f0-9]+/);
  assert.ok(match, `Expected job id in output: ${stdout}`);
  return match[0];
}

function waitForCommand(args, env, predicate) {
  const deadline = Date.now() + 5000;
  let last;

  while (Date.now() < deadline) {
    last = runCompanion(args, env);
    if (predicate(last)) {
      return last;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }

  assert.fail(`Timed out waiting for ${args.join(' ')}. Last output: ${last?.stdout}${last?.stderr}`);
}

test('marketplace exposes the qwen plugin', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');

  assert.equal(marketplace.name, 'qwen-code');
  assert.equal(marketplace.metadata.version, '0.3.0');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'qwen');
  assert.equal(marketplace.plugins[0].version, '0.3.0');
  assert.equal(marketplace.plugins[0].source, './plugins/qwen');
});

test('plugin manifest uses the expected Claude Code plugin name', () => {
  const plugin = readJson('plugins/qwen/.claude-plugin/plugin.json');

  assert.equal(plugin.name, 'qwen');
  assert.equal(plugin.version, '0.3.0');
});

test('review command is a deterministic review-only forwarder', () => {
  const source = readPlugin('commands/review.md');

  assert.match(source, /disable-model-invocation:\s*true/);
  assert.match(source, /review-only/i);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /disallowed-tools:/);
  assert.match(source, /Write/);
  assert.match(source, /Edit/);
  assert.match(source, /--wait/);
  assert.match(source, /--background/);
  assert.match(source, /--model/);
  assert.match(source, /Background mode returns a job id/i);
  assert.doesNotMatch(source, /Bash\(git:\*\)/);
  assert.match(source, /qwen-companion\.mjs" review "\$ARGUMENTS"/);
  assert.match(source, /Return stdout verbatim/i);
});

test('status, result, and cancel commands point to companion entrypoints', () => {
  assert.match(readPlugin('commands/status.md'), /qwen-companion\.mjs" status "\$ARGUMENTS"/);
  assert.match(readPlugin('commands/result.md'), /qwen-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(readPlugin('commands/cancel.md'), /qwen-companion\.mjs" cancel "\$ARGUMENTS"/);
});

test('setup command points users to the companion script', () => {
  const source = readPlugin('commands/setup.md');

  assert.match(source, /disable-model-invocation:\s*true/);
  assert.match(source, /qwen-companion\.mjs" setup "\$ARGUMENTS"/);
});

test('companion reports missing qwen with install guidance', () => {
  const result = spawnSync(
    process.execPath,
    [COMPANION, 'setup'],
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

test('review --wait forwards raw arguments with a review-only system prompt', () => {
  const { argsPath, env } = createFakeEnv();
  const result = runCompanion(['review', '--wait "src/foo bar.ts" --comment'], env);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Review body/);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  assert.deepEqual(forwardedArgs.slice(-2), [
    '--prompt',
    '/review "src/foo bar.ts" --comment',
  ]);
  assert.ok(forwardedArgs.includes('--sandbox'));
  assert.ok(forwardedArgs.includes('stream-json'));

  const systemPromptIndex = forwardedArgs.indexOf('--append-system-prompt');
  assert.notEqual(systemPromptIndex, -1);
  assert.match(forwardedArgs[systemPromptIndex + 1], /review-only/i);
  assert.match(forwardedArgs[systemPromptIndex + 1], /Do not apply autofixes/i);
});

test('review --wait forwards --model to the Qwen CLI only', () => {
  const { argsPath, env } = createFakeEnv();
  const result = runCompanion(
    [
      'review',
      '--wait --model qwen3-coder-plus "src/foo bar.ts" --comment',
    ],
    env,
  );

  assert.equal(result.status, 0);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  const modelIndex = forwardedArgs.indexOf('--model');
  assert.notEqual(modelIndex, -1);
  assert.equal(forwardedArgs[modelIndex + 1], 'qwen3-coder-plus');
  assert.deepEqual(forwardedArgs.slice(-2), [
    '--prompt',
    '/review "src/foo bar.ts" --comment',
  ]);
});

test('review --wait supports --model=value syntax', () => {
  const { argsPath, env } = createFakeEnv();
  const result = runCompanion(
    ['review', '--wait --model=qwen3-coder-plus 123'],
    env,
  );

  assert.equal(result.status, 0);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  const modelIndex = forwardedArgs.indexOf('--model');
  assert.notEqual(modelIndex, -1);
  assert.equal(forwardedArgs[modelIndex + 1], 'qwen3-coder-plus');
  assert.deepEqual(forwardedArgs.slice(-2), ['--prompt', '/review 123']);
});

test('review --wait sandbox can be explicitly disabled for constrained environments', () => {
  const { argsPath, env } = createFakeEnv();
  env.QWEN_PLUGIN_NO_SANDBOX = '1';

  const result = runCompanion(['review', '--wait'], env);

  assert.equal(result.status, 0);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  assert.equal(forwardedArgs.includes('--sandbox'), false);
});

test('review reports missing --model value', () => {
  const { env } = createFakeEnv();
  const result = runCompanion(['review', '--wait --model'], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --model/);
});

test('background review records status and result', () => {
  const { env } = createFakeEnv();
  const started = runCompanion(['review', '--background', '123 --comment'], env);

  assert.equal(started.status, 0);
  assert.match(started.stdout, /Qwen review started:/);

  const jobId = extractJobId(started.stdout);
  const result = waitForCommand(['result', jobId], env, (attempt) =>
    attempt.stdout.includes('Review body'),
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Review body/);

  const status = runCompanion(['status', jobId], env);
  assert.equal(status.status, 0);
  assert.match(status.stdout, /succeeded/);
  assert.match(status.stdout, new RegExp(jobId));
});

test('background review records and displays the selected model', () => {
  const { argsPath, env } = createFakeEnv();
  const started = runCompanion(
    ['review', '--background -m qwen3-coder-plus 123 --comment'],
    env,
  );

  assert.equal(started.status, 0);

  const jobId = extractJobId(started.stdout);
  const result = waitForCommand(['result', jobId], env, (attempt) =>
    attempt.stdout.includes('Model: qwen3-coder-plus') &&
    attempt.stdout.includes('Review body'),
  );
  assert.match(result.stdout, /Review body/);

  const status = runCompanion(['status', jobId], env);
  assert.match(status.stdout, /model=qwen3-coder-plus/);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  const modelIndex = forwardedArgs.indexOf('--model');
  assert.notEqual(modelIndex, -1);
  assert.equal(forwardedArgs[modelIndex + 1], 'qwen3-coder-plus');
  assert.deepEqual(forwardedArgs.slice(-2), ['--prompt', '/review 123 --comment']);
});

test('background review can be canceled', () => {
  const { env } = createFakeEnv({ mode: 'slow' });
  const started = runCompanion(['review', '--background'], env);

  assert.equal(started.status, 0);

  const jobId = extractJobId(started.stdout);
  waitForCommand(['status', jobId], env, (attempt) => attempt.stdout.includes('running'));

  const canceled = runCompanion(['cancel', jobId], env);
  assert.equal(canceled.status, 0);
  assert.match(canceled.stdout, /cancel/i);

  const status = waitForCommand(['status', jobId], env, (attempt) =>
    attempt.stdout.includes('canceled'),
  );
  assert.equal(status.status, 0);
});

test('background review can be canceled immediately after starting', () => {
  const { env } = createFakeEnv({ mode: 'slow' });
  const started = runCompanion(['review', '--background'], env);

  assert.equal(started.status, 0);

  const jobId = extractJobId(started.stdout);
  const canceled = runCompanion(['cancel', jobId], env);
  assert.equal(canceled.status, 0);

  const status = waitForCommand(['status', jobId], env, (attempt) =>
    attempt.stdout.includes('canceled'),
  );
  assert.equal(status.status, 0);
});
