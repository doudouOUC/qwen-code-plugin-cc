#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const INSTALL_COMMAND = 'npm install -g @qwen-code/qwen-code';
const REVIEW_ONLY_SYSTEM_PROMPT = [
  'You are running from the Claude Code Qwen plugin in review-only mode.',
  'When executing /review, report findings only.',
  'Do not apply autofixes, edit files, stage files, commit, push, or mutate the working tree.',
].join(' ');

function normalizeRawArguments(args) {
  return args.length === 1 ? String(args[0] ?? '') : args.join(' ');
}

function commandStatus(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    return {
      available: false,
      detail: result.error.message,
      stdout: '',
      stderr: '',
    };
  }

  return {
    available: result.status === 0,
    detail:
      result.status === 0
        ? (result.stdout || result.stderr).trim()
        : (result.stderr || result.stdout).trim(),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/qwen-companion.mjs setup',
      '  node scripts/qwen-companion.mjs review [review arguments]',
    ].join('\n'),
  );
}

function handleSetup() {
  const nodeStatus = commandStatus('node', ['--version']);
  const npmStatus = commandStatus('npm', ['--version']);
  const qwenStatus = commandStatus('qwen', ['--version']);

  console.log('Qwen Code plugin for Claude Code');
  console.log('');
  console.log(`Node.js: ${nodeStatus.available ? nodeStatus.detail : 'not found'}`);
  console.log(`npm: ${npmStatus.available ? npmStatus.detail : 'not found'}`);
  console.log(`qwen: ${qwenStatus.available ? qwenStatus.detail : 'not found'}`);
  console.log('');

  if (!qwenStatus.available) {
    console.log('Qwen Code CLI is not installed or is not on PATH.');
    console.log(`Install it with: ${INSTALL_COMMAND}`);
    process.exitCode = 1;
    return;
  }

  console.log('Ready. Try: /qwen:review');
}

function buildQwenReviewPrompt(rawArguments) {
  const trimmed = rawArguments.trim();
  return trimmed ? `/review ${trimmed}` : '/review';
}

function buildQwenArgs(prompt) {
  const args = [
    '--approval-mode',
    'yolo',
    '--append-system-prompt',
    REVIEW_ONLY_SYSTEM_PROMPT,
  ];

  if (process.env.QWEN_PLUGIN_NO_SANDBOX !== '1') {
    args.push('--sandbox');
  }

  args.push('--prompt', prompt);
  return args;
}

function handleReview(args) {
  const qwenStatus = commandStatus('qwen', ['--version']);
  if (!qwenStatus.available) {
    console.error('Qwen Code CLI is not installed or is not on PATH.');
    console.error(`Install it with: ${INSTALL_COMMAND}`);
    process.exitCode = 1;
    return;
  }

  const prompt = buildQwenReviewPrompt(normalizeRawArguments(args));
  const child = spawn('qwen', buildQwenArgs(prompt), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`Failed to start qwen: ${error.message}`);
    process.exitCode = 1;
  });

  child.on('close', (code, signal) => {
    if (signal) {
      console.error(`qwen exited because of signal ${signal}`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'setup':
    handleSetup();
    break;
  case 'review':
    handleReview(args);
    break;
  case undefined:
  case '--help':
  case '-h':
    printUsage();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exitCode = 1;
}
