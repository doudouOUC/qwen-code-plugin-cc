#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const INSTALL_COMMAND = 'npm install -g @qwen-code/qwen-code';
const REVIEW_ONLY_SYSTEM_PROMPT = [
  'You are running from the Claude Code Qwen plugin in review-only mode.',
  'When executing /review, report findings only.',
  'Do not apply autofixes, edit files, stage files, commit, push, or mutate the working tree.',
].join(' ');

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function scanRawArgumentString(raw) {
  const source = String(raw ?? '');
  const tokens = [];
  let current = '';
  let start = null;
  let quote = null;
  let escaped = false;
  let quoted = false;
  let escapedToken = false;

  function startToken(index) {
    if (start === null) {
      start = index;
    }
  }

  function finishToken(end) {
    if (start === null) {
      return;
    }
    tokens.push({
      value: current,
      start,
      end,
      quoted,
      escaped: escapedToken,
    });
    current = '';
    start = null;
    quoted = false;
    escapedToken = false;
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      startToken(index);
      escaped = true;
      escapedToken = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      startToken(index);
      quote = char;
      quoted = true;
      continue;
    }
    if (/\s/.test(char)) {
      finishToken(index);
      continue;
    }
    startToken(index);
    current += char;
  }

  if (escaped) {
    current += '\\';
  }
  finishToken(source.length);
  return tokens;
}

function splitRawArgumentString(raw) {
  return scanRawArgumentString(raw).map((token) => token.value);
}

function normalizeArgv(args) {
  return args.length === 1 ? splitRawArgumentString(args[0]) : args;
}

function isModeFlag(token, flag) {
  return token.value === flag && !token.quoted && !token.escaped;
}

function isModelEqualsFlag(token) {
  return (
    !token.quoted &&
    !token.escaped &&
    token.value.startsWith('--model=') &&
    token.value.length > '--model='.length
  );
}

function removeRawTokenSpans(raw, spans) {
  const source = String(raw ?? '');
  let result = String(raw ?? '');
  const expandedSpans = spans.map((span) => {
    let end = span.end;
    while (end < source.length && /\s/.test(source[end])) {
      end += 1;
    }
    return {
      ...span,
      end,
    };
  });

  for (const span of expandedSpans.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, span.start)}${result.slice(span.end)}`;
  }
  return result.trim();
}

function parseReviewInput(args) {
  if (args.length === 1) {
    const raw = String(args[0] ?? '');
    const removeSpans = [];
    let mode = 'background';
    let model = null;
    const tokens = scanRawArgumentString(raw);

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (isModeFlag(token, '--wait')) {
        mode = 'wait';
        removeSpans.push(token);
      } else if (isModeFlag(token, '--background')) {
        mode = 'background';
        removeSpans.push(token);
      } else if (isModelEqualsFlag(token)) {
        model = token.value.slice('--model='.length);
        removeSpans.push(token);
      } else if (!token.quoted && !token.escaped && token.value === '--model=') {
        throw new Error('Missing value for --model.');
      } else if (isModeFlag(token, '--model') || isModeFlag(token, '-m')) {
        const valueToken = tokens[index + 1];
        if (!valueToken) {
          throw new Error(`Missing value for ${token.value}.`);
        }
        model = valueToken.value;
        removeSpans.push(token, valueToken);
        index += 1;
      }
    }

    return {
      mode,
      model,
      rawArguments: removeRawTokenSpans(raw, removeSpans),
    };
  }

  const tokens = normalizeArgv(args);
  let mode = 'background';
  let model = null;
  const reviewTokens = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--wait') {
      mode = 'wait';
    } else if (token === '--background') {
      mode = 'background';
    } else if (token.startsWith('--model=') && token.length > '--model='.length) {
      model = token.slice('--model='.length);
    } else if (token === '--model=') {
      throw new Error('Missing value for --model.');
    } else if (token === '--model' || token === '-m') {
      const value = tokens[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}.`);
      }
      model = value;
      index += 1;
    } else {
      reviewTokens.push(token);
    }
  }

  return {
    mode,
    model,
    rawArguments: reviewTokens.join(' '),
  };
}

function commandStatus(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFile(file, value) {
  ensureDir(path.dirname(file));
  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempFile, file);
}

function appendFile(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, value);
}

function nowIso() {
  return new Date().toISOString();
}

function hashWorkspace(workspaceRoot) {
  return crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
}

function resolveWorkspaceRoot(cwd) {
  const gitRoot = commandStatus('git', ['rev-parse', '--show-toplevel'], {
    cwd,
  });
  return gitRoot.available ? gitRoot.stdout.trim() : cwd;
}

function getStateRoot() {
  return process.env.QWEN_PLUGIN_STATE_DIR
    ? path.resolve(process.env.QWEN_PLUGIN_STATE_DIR)
    : path.join(os.homedir(), '.qwen-code-plugin-cc');
}

function getWorkspaceState(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const workspaceId = hashWorkspace(workspaceRoot);
  const root = path.join(getStateRoot(), 'workspaces', workspaceId);

  return {
    workspaceRoot,
    workspaceId,
    root,
    jobsDir: path.join(root, 'jobs'),
    logsDir: path.join(root, 'logs'),
  };
}

function jobFileFor(cwd, jobId) {
  return path.join(getWorkspaceState(cwd).jobsDir, `${jobId}.json`);
}

function readJob(cwd, jobId) {
  const jobFile = jobFileFor(cwd, jobId);
  if (!fs.existsSync(jobFile)) {
    throw new Error(`Qwen job not found: ${jobId}`);
  }
  return readJsonFile(jobFile);
}

function writeJob(job) {
  writeJsonFile(job.jobFile, {
    ...job,
    updatedAt: nowIso(),
  });
}

function updateJob(cwd, jobId, patch) {
  const job = readJob(cwd, jobId);
  const nextJob = {
    ...job,
    ...patch,
    updatedAt: nowIso(),
  };
  writeJsonFile(nextJob.jobFile, nextJob);
  return nextJob;
}

function listJobs(cwd) {
  const state = getWorkspaceState(cwd);
  if (!fs.existsSync(state.jobsDir)) {
    return [];
  }

  return fs
    .readdirSync(state.jobsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return readJsonFile(path.join(state.jobsDir, name));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
}

function createJob(cwd, request) {
  const state = getWorkspaceState(cwd);
  ensureDir(state.jobsDir);
  ensureDir(state.logsDir);

  const id = `qwen-review-${crypto.randomBytes(4).toString('hex')}`;
  const job = {
    id,
    kind: 'review',
    status: 'queued',
    cwd,
    workspaceRoot: state.workspaceRoot,
    workspaceId: state.workspaceId,
    prompt: request.prompt,
    rawArguments: request.rawArguments,
    model: request.model,
    workerPid: null,
    qwenPid: null,
    exitCode: null,
    signal: null,
    sessionId: null,
    result: null,
    summary: null,
    error: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    endedAt: null,
    jobFile: path.join(state.jobsDir, `${id}.json`),
    stdoutFile: path.join(state.logsDir, `${id}.stdout.log`),
    stderrFile: path.join(state.logsDir, `${id}.stderr.log`),
    jsonlFile: path.join(state.logsDir, `${id}.jsonl`),
  };

  writeJob(job);
  return job;
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function refreshJobStatus(cwd, job) {
  if (
    (job.status === 'queued' || job.status === 'running') &&
    job.workerPid &&
    !isProcessAlive(job.workerPid)
  ) {
    return updateJob(cwd, job.id, {
      status: 'crashed',
      endedAt: nowIso(),
      error: 'Worker process exited without recording a final status.',
    });
  }
  return job;
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

    if (options.onQwenPid) {
      options.onQwenPid(child.pid ?? null);
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
      '  node scripts/qwen-companion.mjs review [--wait|--background] [review arguments]',
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

  if (request.mode === 'wait') {
    const result = await runQwenReview(cwd, prompt, {
      model: request.model,
    });
    if (result.result) {
      process.stdout.write(`${result.result.trimEnd()}\n`);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exitCode = result.status === 'succeeded' ? 0 : 1;
    return;
  }

  const job = createJob(cwd, {
    model: request.model,
    prompt,
    rawArguments: request.rawArguments,
  });
  const child = spawn(process.execPath, [SCRIPT_PATH, 'worker', job.id], {
    cwd,
    detached: true,
    env: process.env,
    stdio: 'ignore',
  });
  child.unref();

  updateJob(cwd, job.id, {
    workerPid: child.pid ?? null,
  });

  console.log(`Qwen review started: ${job.id}`);
  console.log(`Status: /qwen:status ${job.id}`);
  console.log(`Result: /qwen:result ${job.id}`);
  console.log(`Cancel: /qwen:cancel ${job.id}`);
}

async function handleWorker(args) {
  const [jobId] = args;
  if (!jobId) {
    throw new Error('Missing job id.');
  }

  const cwd = process.cwd();
  if (readJob(cwd, jobId).status === 'canceled') {
    return;
  }
  const job = updateJob(cwd, jobId, {
    status: 'running',
    workerPid: process.pid,
  });

  const result = await runQwenReview(cwd, job.prompt, {
    model: job.model,
    stdoutFile: job.stdoutFile,
    stderrFile: job.stderrFile,
    jsonlFile: job.jsonlFile,
    onQwenPid(pid) {
      if (readJob(cwd, jobId).status === 'canceled') {
        killPid(pid);
        return;
      }
      updateJob(cwd, jobId, {
        qwenPid: pid,
        status: 'running',
      });
    },
  });

  const latestJob = readJob(cwd, jobId);
  const finalStatus = latestJob.status === 'canceled' ? 'canceled' : result.status;
  updateJob(cwd, jobId, {
    status: finalStatus,
    qwenPid: null,
    exitCode: result.exitCode,
    signal: result.signal,
    sessionId: result.sessionId,
    result: result.result,
    summary: result.result ? result.result.split(/\r?\n/).find(Boolean) ?? null : null,
    error:
      finalStatus === 'canceled'
        ? latestJob.error
        : finalStatus === 'succeeded'
          ? null
          : result.error,
    endedAt: nowIso(),
  });
}

function resolveJob(cwd, jobId) {
  if (jobId) {
    return refreshJobStatus(cwd, readJob(cwd, jobId));
  }

  const job = listJobs(cwd)[0];
  if (!job) {
    throw new Error('No Qwen jobs found for this workspace.');
  }
  return refreshJobStatus(cwd, job);
}

function renderJobLine(job) {
  const bits = [job.id, job.status];
  if (job.model) {
    bits.push(`model=${job.model}`);
  }
  if (job.sessionId) {
    bits.push(`session=${job.sessionId}`);
  }
  if (job.summary) {
    bits.push(job.summary);
  }
  return bits.join(' | ');
}

function handleStatus(args) {
  const cwd = process.cwd();
  const [jobId] = normalizeArgv(args);

  if (jobId) {
    const job = resolveJob(cwd, jobId);
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

  const jobs = listJobs(cwd).slice(0, 10).map((job) => refreshJobStatus(cwd, job));
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
  const [jobId] = normalizeArgv(args);
  const job = resolveJob(cwd, jobId);

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

function killPid(pid) {
  if (!pid) {
    return false;
  }
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, 'SIGTERM');
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
}

function handleCancel(args) {
  const cwd = process.cwd();
  const [jobId] = normalizeArgv(args);
  const job = resolveJob(cwd, jobId);

  if (!['queued', 'running'].includes(job.status)) {
    console.log(`Qwen job ${job.id} is already ${job.status}.`);
    return;
  }

  updateJob(cwd, job.id, {
    status: 'canceled',
    endedAt: nowIso(),
    error: 'Canceled by user.',
  });
  killPid(job.qwenPid);
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
