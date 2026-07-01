import process from 'node:process';

import { killPid, nowIso } from './fs-utils.mjs';
import { readJob, updateJob } from './jobs.mjs';

export async function runTrackedReviewJob(cwd, jobId, stateRoot, runReviewFn) {
  if (readJob(cwd, jobId, stateRoot).status === 'canceled') {
    return {
      finalStatus: 'canceled',
      result: {
        status: 'canceled',
        exitCode: null,
        signal: null,
        sessionId: null,
        result: '',
        stderr: '',
        error: 'Canceled by user.',
      },
    };
  }
  const job = updateJob(cwd, jobId, {
    status: 'running',
    workerPid: process.pid,
  }, stateRoot);

  const result = await runReviewFn(cwd, job.prompt, {
    model: job.model,
    stdoutFile: job.stdoutFile,
    stderrFile: job.stderrFile,
    jsonlFile: job.jsonlFile,
    onChildPid(pid) {
      if (readJob(cwd, jobId, stateRoot).status === 'canceled') {
        killPid(pid);
        return;
      }
      updateJob(cwd, jobId, {
        childPid: pid,
        status: 'running',
      }, stateRoot);
    },
  });

  const latestJob = readJob(cwd, jobId, stateRoot);
  const finalStatus = latestJob.status === 'canceled' ? 'canceled' : result.status;
  updateJob(cwd, jobId, {
    status: finalStatus,
    childPid: null,
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
  }, stateRoot);

  return { finalStatus, result };
}

export function writeReviewOutput(finalStatus, result) {
  if (result.result) {
    process.stdout.write(`${result.result.trimEnd()}\n`);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = finalStatus === 'succeeded' ? 0 : 1;
}
