import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

export function commandStatus(command, args = [], options = {}) {
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

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJsonFile(file, value) {
  ensureDir(path.dirname(file));
  const tempFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempFile, file);
}

export function appendFile(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, value);
}

export function nowIso() {
  return new Date().toISOString();
}

export function hashWorkspace(workspaceRoot) {
  return crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
}

export function resolveWorkspaceRoot(cwd) {
  const gitRoot = commandStatus('git', ['rev-parse', '--show-toplevel'], {
    cwd,
  });
  return gitRoot.available ? gitRoot.stdout.trim() : cwd;
}

export function isProcessAlive(pid) {
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

export function killPid(pid) {
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
