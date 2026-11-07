import type { fork, ForkOptions } from 'node:child_process';

/** Keep Vitest's process isolation while suppressing Windows worker consoles. */
export function withHiddenForks(originalFork: typeof fork): typeof fork {
  return ((modulePath: string | URL, argsOrOptions?: readonly string[] | ForkOptions, options?: ForkOptions) => {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    const settings = Array.isArray(argsOrOptions) ? options : options ?? argsOrOptions as ForkOptions | undefined;
    return originalFork(modulePath, args, { ...settings, windowsHide: true });
  }) as typeof fork;
}
