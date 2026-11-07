import { ChildProcess, fork, type ForkOptions } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { withHiddenForks } from './helpers/hidden-fork.js';

test.skipIf(process.platform !== 'win32')('forks inside a test worker hide native helper consoles', () => {
  let hidden: boolean | undefined;
  const blocked = new Error('Launch intercepted before creating a window');
  // Node's runtime launch method is internal and omitted from its public types.
  const processPrototype = ChildProcess.prototype as unknown as { spawn(options: { windowsHide?: boolean }): void };
  const launch = vi.spyOn(processPrototype, 'spawn').mockImplementation((options) => {
    hidden = options.windowsHide;
    throw blocked;
  });
  try {
    expect(() => fork(new URL('./fixtures/fake-agent.mjs', import.meta.url), [], { stdio: 'pipe' })).toThrow(blocked);
    expect(hidden).toBe(true);
  } finally {
    launch.mockRestore();
  }
});

test('hidden worker launches preserve arguments and IPC across fork overloads', () => {
  for (const form of ['args-and-options', 'options-only', 'omitted-args', 'defaults'] as const) {
    const child = { send: vi.fn(), kill: vi.fn() };
    const originalFork = vi.fn(() => child);
    const launch = withHiddenForks(originalFork as unknown as typeof fork);
    const entrypoint = new URL('file:///C:/test/worker.mjs');
    const options: ForkOptions = {
      cwd: 'C:\\test workspace', env: { TEST_WORKER: '1' },
      execArgv: ['--enable-source-maps'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced', windowsHide: false,
    };
    const result = form === 'args-and-options' ? launch(entrypoint, ['--fixture'], options)
      : form === 'options-only' ? launch(entrypoint, options)
        : form === 'omitted-args' ? launch(entrypoint, undefined, options) : launch(entrypoint);
    expect(result).toBe(child);
    expect(originalFork).toHaveBeenCalledExactlyOnceWith(
      entrypoint, form === 'args-and-options' ? ['--fixture'] : [],
      { ...(form === 'defaults' ? {} : options), windowsHide: true },
    );
    expect(options.windowsHide).toBe(false);
  }
});
