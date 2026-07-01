import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  ensureDir,
  hashWorkspace,
  isProcessAlive,
  nowIso,
  readJsonFile,
  resolveWorkspaceRoot,
  writeJsonFile,
} from './fs-utils.mjs';

export function getWorkspaceState(cwd, stateRoot) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const workspaceId = hashWorkspace(workspaceRoot);
  const root = path.join(stateRoot, 'workspaces', workspaceId);

  return {
    workspaceRoot,
    workspaceId,
    root,
    jobsDir: path.join(root, 'jobs'),
    logsDir: path.join(root, 'logs'),
  };
}

function jobFileFor(cwd, jobId, stateRoot) {
  return path.join(getWorkspaceState(cwd, stateRoot).jobsDir, `${jobId}.json`);
}

export function readJob(cwd, jobId, stateRoot) {
  const jobFile = jobFileFor(cwd, jobId, stateRoot);
  if (!fs.existsSync(jobFile)) {
    throw new Error(`Job not found: ${jobId}`);
  }
  return readJsonFile(jobFile);
}

export function writeJob(job) {
  writeJsonFile(job.jobFile, {
    ...job,
    updatedAt: nowIso(),
  });
}

export function updateJob(cwd, jobId, patch, stateRoot) {
  const job = readJob(cwd, jobId, stateRoot);
  const nextJob = {
    ...job,
    ...patch,
    updatedAt: nowIso(),
  };
  writeJsonFile(nextJob.jobFile, nextJob);
  return nextJob;
}

export function listJobs(cwd, stateRoot) {
  const state = getWorkspaceState(cwd, stateRoot);
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

export function createJob(cwd, request, stateRoot, idPrefix) {
  const state = getWorkspaceState(cwd, stateRoot);
  ensureDir(state.jobsDir);
  ensureDir(state.logsDir);

  const id = `${idPrefix}-${crypto.randomBytes(4).toString('hex')}`;
  const { prompt, rawArguments, model, ...extra } = request;
  const job = {
    id,
    kind: 'review',
    ...extra,
    status: 'queued',
    cwd,
    workspaceRoot: state.workspaceRoot,
    workspaceId: state.workspaceId,
    prompt,
    rawArguments,
    model,
    workerPid: null,
    childPid: null,
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

export function refreshJobStatus(cwd, job, stateRoot) {
  if (
    (job.status === 'queued' || job.status === 'running') &&
    job.workerPid &&
    !isProcessAlive(job.workerPid)
  ) {
    return updateJob(cwd, job.id, {
      status: 'crashed',
      endedAt: nowIso(),
      error: 'Worker process exited without recording a final status.',
    }, stateRoot);
  }
  return job;
}

export function resolveJob(cwd, jobId, stateRoot, label) {
  if (jobId) {
    return refreshJobStatus(cwd, readJob(cwd, jobId, stateRoot), stateRoot);
  }

  const job = listJobs(cwd, stateRoot)[0];
  if (!job) {
    throw new Error(`No ${label} jobs found for this workspace.`);
  }
  return refreshJobStatus(cwd, job, stateRoot);
}

export function renderJobLine(job) {
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
