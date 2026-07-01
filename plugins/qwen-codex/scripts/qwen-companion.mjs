#!/usr/bin/env node

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  isModeFlag,
  isModelEqualsFlag,
  normalizeArgv,
  removeRawTokenSpans,
  scanRawArgumentString,
  validateModelValue,
} from '../lib/argv.mjs';
import { appendFile, commandStatus, killPid } from '../lib/fs-utils.mjs';
import {
  createJob,
  listJobs,
  refreshJobStatus,
  renderJobLine,
  resolveJob,
  updateJob,
} from '../lib/jobs.mjs';
import { runTrackedReviewJob, writeReviewOutput } from '../lib/tracked-review.mjs';

const INSTALL_COMMAND = 'npm install -g @qwen-code/qwen-code';
const REVIEW_ONLY_SYSTEM_PROMPT = [
  'You are running from the Claude Code Qwen plugin in review-only mode.',
  'When executing /review, report findings only.',
  'Do not apply autofixes, edit files, stage files, commit, push, or mutate the working tree.',
].join(' ');

function getStateRoot() {
  return process.env.QWEN_PLUGIN_STATE_DIR
    ? path.resolve(process.env.QWEN_PLUGIN_STATE_DIR)
    : path.join(os.homedir(), '.qwen-code-plugin-cc');
}

function parseReviewInput(args) {
  if (args.length === 1) {
    const raw = String(args[0] ?? '');
    const removeSpans = [];
    let model = null;
    const tokens = scanRawArgumentString(raw);

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (isModeFlag(token, '--wait')) {
        removeSpans.push(token);
      } else if (isModeFlag(token, '--background')) {
        removeSpans.push(token);
      } else if (isModelEqualsFlag(token)) {
        model = validateModelValue('--model', token.value.slice('--model='.length));
        removeSpans.push(token);
      } else if (!token.quoted && !token.escaped && token.value === '--model=') {
        throw new Error('Missing value for --model.');
      } else if (isModeFlag(token, '--model') || isModeFlag(token, '-m')) {
        const valueToken = tokens[index + 1];
        model = validateModelValue(token.value, valueToken?.value);
        removeSpans.push(token, valueToken);
        index += 1;
      }
    }

    return {
      model,
      rawArguments: removeRawTokenSpans(raw, removeSpans),
    };
  }

  const tokens = normalizeArgv(args);
  let model = null;
  const reviewTokens = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--wait') {
      continue;
    } else if (token === '--background') {
      continue;
    } else if (token.startsWith('--model=') && token.length > '--model='.length) {
      model = validateModelValue('--model', token.slice('--model='.length));
    } else if (token === '--model=') {
      throw new Error('Missing value for --model.');
    } else if (token === '--model' || token === '-m') {
      const value = tokens[index + 1];
      model = validateModelValue(token, value);
      index += 1;
    } else {
      reviewTokens.push(token);
    }
  }

  return {
    model,
    rawArguments: reviewTokens.join(' '),
  };
}

function buildQwenReviewPrompt(rawArguments) {
  const trimmed = rawArguments.trim();
  return trimmed ? `/review ${trimmed}` : '/review';
}

function buildQwenArgs(prompt, options = {}) {
  const args = [
    '--approval-mode',
    'yolo',
    '--append-system-prompt',
    REVIEW_ONLY_SYSTEM_PROMPT,
  ];

  if (process.env.QWEN_PLUGIN_NO_SANDBOX !== '1') {
    args.push('--sandbox');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.streamJson) {
    args.push('--output-format', 'stream-json', '--include-partial-messages');
  }

  args.push('--prompt', prompt);
  return args;
}

function extractEventText(event) {
  if (typeof event?.result === 'string') {
    return event.result;
  }

  const content = event?.message?.content;
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
    .join('');
}

function processJsonLine(line, state) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.session_id || event.sessionId) {
    state.sessionId = event.session_id ?? event.sessionId;
  }

  const text = extractEventText(event);
  if (text) {
    state.lastText = text;
  }
}

function runQwenReview(cwd, prompt, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      'qwen',
      buildQwenArgs(prompt, {
        model: options.model,
        streamJson: true,
      }),
      {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const parsedState = {
      sessionId: null,
      lastText: '',
    };
    let stdoutBuffer = '';
    let stderr = '';

    if (options.onChildPid) {
      options.onChildPid(child.pid ?? null);
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (options.stdoutFile) {
        appendFile(options.stdoutFile, text);
      }
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        if (options.jsonlFile) {
          appendFile(options.jsonlFile, `${line}\n`);
        }
        processJsonLine(line, parsedState);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (options.stderrFile) {
        appendFile(options.stderrFile, text);
      }
    });

    child.on('error', (error) => {
      resolve({
        status: 'failed',
        exitCode: null,
        signal: null,
        sessionId: parsedState.sessionId,
        result: parsedState.lastText,
        stderr,
        error: error.message,
      });
    });

    child.on('close', (code, signal) => {
      if (stdoutBuffer.trim()) {
        if (options.jsonlFile) {
          appendFile(options.jsonlFile, `${stdoutBuffer}\n`);
        }
        processJsonLine(stdoutBuffer, parsedState);
      }
      resolve({
        status: code === 0 ? 'succeeded' : 'failed',
        exitCode: code,
        signal,
        sessionId: parsedState.sessionId,
        result: parsedState.lastText,
        stderr,
        error: code === 0 ? null : stderr.trim() || `qwen exited with code ${code ?? signal}`,
      });
    });
  });
}

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/qwen-companion.mjs setup',
      '  node scripts/qwen-companion.mjs review [--wait|--background] [--model model] [review arguments]',
      '  node scripts/qwen-companion.mjs status [job-id]',
      '  node scripts/qwen-companion.mjs result [job-id]',
      '  node scripts/qwen-companion.mjs cancel [job-id]',
    ].join('\n'),
  );
}

function getQwenAvailability(cwd) {
  return commandStatus('qwen', ['--version'], { cwd });
}

function ensureQwenAvailable(cwd) {
  const qwenStatus = getQwenAvailability(cwd);
  if (!qwenStatus.available) {
    throw new Error(
      `Qwen Code CLI is not installed or is not on PATH.\nInstall it with: ${INSTALL_COMMAND}`,
    );
  }
  return qwenStatus;
}

function handleSetup() {
  const cwd = process.cwd();
  const nodeStatus = commandStatus('node', ['--version'], { cwd });
  const npmStatus = commandStatus('npm', ['--version'], { cwd });
  const qwenStatus = getQwenAvailability(cwd);

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

async function handleReview(args) {
  const cwd = process.cwd();
  ensureQwenAvailable(cwd);

  const request = parseReviewInput(args);
  const prompt = buildQwenReviewPrompt(request.rawArguments);
  const stateRoot = getStateRoot();
  const job = createJob(cwd, {
    model: request.model,
    prompt,
    rawArguments: request.rawArguments,
  }, stateRoot, 'qwen-review');

  const { finalStatus, result } = await runTrackedReviewJob(cwd, job.id, stateRoot, runQwenReview);
  writeReviewOutput(finalStatus, result);
}

async function handleWorker(args) {
  const [jobId] = args;
  if (!jobId) {
    throw new Error('Missing job id.');
  }

  await runTrackedReviewJob(process.cwd(), jobId, getStateRoot(), runQwenReview);
}

function handleStatus(args) {
  const cwd = process.cwd();
  const stateRoot = getStateRoot();
  const [jobId] = normalizeArgv(args);

  if (jobId) {
    const job = resolveJob(cwd, jobId, stateRoot, 'Qwen');
    console.log(renderJobLine(job));
    if (job.model) {
      console.log(`Model: ${job.model}`);
    }
    console.log(`Started: ${job.startedAt}`);
    console.log(`Updated: ${job.updatedAt}`);
    if (job.endedAt) {
      console.log(`Ended: ${job.endedAt}`);
    }
    console.log(`Log: ${job.stdoutFile}`);
    return;
  }

  const jobs = listJobs(cwd, stateRoot).slice(0, 10).map((job) => refreshJobStatus(cwd, job, stateRoot));
  if (jobs.length === 0) {
    console.log('No Qwen jobs found for this workspace.');
    return;
  }
  for (const job of jobs) {
    console.log(renderJobLine(job));
  }
}

function handleResult(args) {
  const cwd = process.cwd();
  const stateRoot = getStateRoot();
  const [jobId] = normalizeArgv(args);
  const job = resolveJob(cwd, jobId, stateRoot, 'Qwen');

  console.log(`Job: ${job.id}`);
  console.log(`Status: ${job.status}`);
  if (job.model) {
    console.log(`Model: ${job.model}`);
  }
  if (job.sessionId) {
    console.log(`Session: ${job.sessionId}`);
  }
  console.log('');

  if (job.result) {
    console.log(job.result.trimEnd());
    return;
  }

  if (job.status === 'queued' || job.status === 'running') {
    console.log('Qwen review is still running.');
    console.log(`Use /qwen:status ${job.id} to check progress.`);
    return;
  }

  if (job.error) {
    console.log(job.error);
    return;
  }

  console.log('No result was recorded.');
}

function handleCancel(args) {
  const cwd = process.cwd();
  const stateRoot = getStateRoot();
  const [jobId] = normalizeArgv(args);
  const job = resolveJob(cwd, jobId, stateRoot, 'Qwen');

  if (!['queued', 'running'].includes(job.status)) {
    console.log(`Qwen job ${job.id} is already ${job.status}.`);
    return;
  }

  updateJob(cwd, job.id, {
    status: 'canceled',
    endedAt: new Date().toISOString(),
    error: 'Canceled by user.',
  }, stateRoot);
  killPid(job.childPid);
  killPid(job.workerPid);
  console.log(`Qwen review cancel requested: ${job.id}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case 'setup':
        handleSetup();
        break;
      case 'review':
        await handleReview(args);
        break;
      case 'worker':
        await handleWorker(args);
        break;
      case 'status':
        handleStatus(args);
        break;
      case 'result':
        handleResult(args);
        break;
      case 'cancel':
        handleCancel(args);
        break;
      case undefined:
      case '--help':
      case '-h':
        printUsage();
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
