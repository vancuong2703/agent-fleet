import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { withHiddenForks } from './hidden-fork.js';

// Install in both the coordinator and workers: node-pty also forks a Node helper
// when closing a terminal, from inside the worker process.
if (process.platform === 'win32') {
  childProcess.fork = withHiddenForks(childProcess.fork);
  syncBuiltinESMExports();
}
