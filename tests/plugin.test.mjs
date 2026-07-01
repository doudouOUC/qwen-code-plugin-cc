import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QWEN_PLUGIN_ROOT = path.join(ROOT, 'plugins', 'qwen');
const COMPANION = path.join(QWEN_PLUGIN_ROOT, 'scripts', 'qwen-companion.mjs');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readQwenPlugin(relativePath) {
  return fs.readFileSync(path.join(QWEN_PLUGIN_ROOT, relativePath), 'utf8');
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

function spawnCompanion(args, env) {
  return spawn(process.execPath, [COMPANION, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
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

test('claude code marketplace exposes the qwen plugin', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');

  assert.equal(marketplace.name, 'qwen-code');
  assert.equal(marketplace.metadata.version, '0.5.0');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'qwen');
  assert.equal(marketplace.plugins[0].version, '0.5.0');
  assert.equal(marketplace.plugins[0].source, './plugins/qwen');
});

test('codex marketplace exposes the qwen plugin', () => {
  const marketplace = readJson('.agents/plugins/marketplace.json');

  assert.equal(marketplace.name, 'qwen-code');
  assert.ok(marketplace.plugins.length >= 1);

  const qwen = marketplace.plugins.find((p) => p.name === 'qwen');
  assert.ok(qwen);
  assert.equal(qwen.source.source, 'local');
  assert.match(qwen.source.path, /qwen-codex/);
});

test('qwen plugin manifest uses the expected Claude Code plugin name', () => {
  const plugin = readJson('plugins/qwen/.claude-plugin/plugin.json');

  assert.equal(plugin.name, 'qwen');
  assert.equal(plugin.version, '0.5.0');
});

test('qwen-codex plugin manifest uses the expected Codex plugin name', () => {
  const plugin = readJson('plugins/qwen-codex/.codex-plugin/plugin.json');

  assert.equal(plugin.name, 'qwen');
  assert.ok(plugin.skills);
  assert.ok(plugin.interface);
});

test('qwen-codex skill file exists', () => {
  const skill = fs.readFileSync(
    path.join(ROOT, 'plugins', 'qwen-codex', 'skills', 'qwen-review', 'SKILL.md'),
    'utf8',
  );

  assert.match(skill, /name:\s*qwen-review/);
  assert.match(skill, /qwen/i);
  assert.match(skill, /review/i);
});

test('review command is a deterministic review-only forwarder', () => {
  const source = readQwenPlugin('commands/review.md');

  assert.match(source, /disable-model-invocation:\s*true/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /description:\s*"Qwen review"/);
  assert.match(source, /review-only/i);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /disallowed-tools:/);
  assert.match(source, /Write/);
  assert.match(source, /Edit/);
  assert.match(source, /--wait/);
  assert.match(source, /--background/);
  assert.match(source, /--model/);
  assert.match(source, /Claude Code's `Bash\([^`]+run_in_background: true\)` is what actually detaches/i);
  assert.match(source, /Do not call `BashOutput`/);
  assert.doesNotMatch(source, /Background mode returns a job id/i);
  assert.doesNotMatch(source, /Bash\(git:\*\)/);
  assert.match(source, /qwen-companion\.mjs" review "\$ARGUMENTS"/);
  assert.match(source, /Return stdout verbatim/i);
});

test('status, result, and cancel commands point to companion entrypoints', () => {
  assert.match(readQwenPlugin('commands/status.md'), /qwen-companion\.mjs" status "\$ARGUMENTS"/);
  assert.match(readQwenPlugin('commands/result.md'), /qwen-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(readQwenPlugin('commands/cancel.md'), /qwen-companion\.mjs" cancel "\$ARGUMENTS"/);
});

test('setup command points users to the companion script', () => {
  const source = readQwenPlugin('commands/setup.md');

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

test('review rejects --model values that look like plugin flags', () => {
  const { env } = createFakeEnv();

  const longFlag = runCompanion(['review', '--model --wait'], env);
  assert.equal(longFlag.status, 1);
  assert.match(longFlag.stderr, /Missing value for --model/);

  const shortFlag = runCompanion(['review', '-m --background'], env);
  assert.equal(shortFlag.status, 1);
  assert.match(shortFlag.stderr, /Missing value for -m/);

  const equalsFlag = runCompanion(['review', '--model='], env);
  assert.equal(equalsFlag.status, 1);
  assert.match(equalsFlag.stderr, /Missing value for --model/);

  const reviewFlag = runCompanion(['review', '--model --comment'], env);
  assert.equal(reviewFlag.status, 1);
  assert.match(reviewFlag.stderr, /Missing value for --model/);

  const equalsReviewFlag = runCompanion(['review', '--model=--comment'], env);
  assert.equal(equalsReviewFlag.status, 1);
  assert.match(equalsReviewFlag.stderr, /Missing value for --model/);
});

test('companion help documents model selection', () => {
  const result = runCompanion(['--help'], process.env);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /--model/);
});

test('background review runs to completion and records status and result', () => {
  const { env } = createFakeEnv();
  const started = runCompanion(['review', '--background', '123 --comment'], env);

  assert.equal(started.status, 0);
  assert.match(started.stdout, /Review body/);

  const status = runCompanion(['status'], env);
  assert.equal(status.status, 0);
  assert.match(status.stdout, /succeeded/);
  const jobId = extractJobId(status.stdout);

  const result = runCompanion(['result', jobId], env);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Review body/);
});

test('background review runs to completion with the selected model', () => {
  const { argsPath, env } = createFakeEnv();
  const started = runCompanion(
    ['review', '--background -m qwen3-coder-plus 123 --comment'],
    env,
  );

  assert.equal(started.status, 0);
  assert.match(started.stdout, /Review body/);

  const status = runCompanion(['status'], env);
  const jobId = extractJobId(status.stdout);

  const result = runCompanion(['result', jobId], env);
  assert.match(result.stdout, /Model: qwen3-coder-plus/);
  assert.match(result.stdout, /Review body/);

  assert.match(status.stdout, /model=qwen3-coder-plus/);

  const forwardedArgs = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  const modelIndex = forwardedArgs.indexOf('--model');
  assert.notEqual(modelIndex, -1);
  assert.equal(forwardedArgs[modelIndex + 1], 'qwen3-coder-plus');
  assert.deepEqual(forwardedArgs.slice(-2), ['--prompt', '/review 123 --comment']);
});

test('background review can be canceled', async () => {
  const { env } = createFakeEnv({ mode: 'slow' });
  const child = spawnCompanion(['review', '--background'], env);

  const statusBeforeCancel = waitForCommand(['status'], env, (attempt) =>
    attempt.stdout.includes('running'),
  );
  const jobId = extractJobId(statusBeforeCancel.stdout);

  const canceled = runCompanion(['cancel', jobId], env);
  assert.equal(canceled.status, 0);
  assert.match(canceled.stdout, /cancel/i);

  await waitForExit(child);

  const status = waitForCommand(['status', jobId], env, (attempt) =>
    attempt.stdout.includes('canceled'),
  );
  assert.equal(status.status, 0);
});
