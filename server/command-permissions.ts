import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CommandPolicy } from '../shared/types.js';

export interface CommandOptions { commandPolicy?: CommandPolicy; allowedCommands?: string[] }

export function validateCommandOptions(options: CommandOptions): void {
  if (options.commandPolicy !== undefined && !['ask', 'check-only', 'auto'].includes(options.commandPolicy)) throw new Error('Invalid command policy');
  if (options.allowedCommands !== undefined && (!Array.isArray(options.allowedCommands) || options.allowedCommands.length > 64
    || options.allowedCommands.some(command => typeof command !== 'string' || !command.trim() || command.length > 2_000 || /[\r\n\0]/.test(command)))) {
    throw new Error('Allowed commands must be up to 64 nonempty single-line commands');
  }
}

/** AGY's allow rules are session settings, never written to global settings. */
export function agyCommandArgs(args: string[], options: CommandOptions, checkCmd: string | null, cwd: string): { args: string[]; rules: string[] } {
  validateCommandOptions(options);
  const policy = options.commandPolicy ?? 'ask';
  if (policy === 'ask') return { args: args.slice(), rules: [] };
  const rules = policy === 'auto' ? ['command(*)'] : [...new Set([checkCmd, ...(options.allowedCommands ?? [])]
    .filter((value): value is string => Boolean(value?.trim())).map(command => `command(${command})`))];
  if (!rules.length) return { args: args.slice(), rules };
  let settings: Record<string, unknown> = {};
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    let value: string | undefined;
    if (arg === '--settings') { value = args[++index]; if (!value) throw new Error('AGY --settings needs a value'); }
    else if (arg.startsWith('--settings=')) value = arg.slice(11);
    else { remaining.push(arg); continue; }
    const json: unknown = JSON.parse(value.trim().startsWith('{') ? value : readFileSync(path.win32.resolve(cwd, value), 'utf8').replace(/^\uFEFF/, ''));
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('AGY settings must be a JSON object');
    settings = { ...settings, ...json };
  }
  const rawPermissions = settings.permissions;
  const permissions = rawPermissions && typeof rawPermissions === 'object' && !Array.isArray(rawPermissions)
    ? rawPermissions as Record<string, unknown> : {};
  const existing = Array.isArray(permissions.allow) ? permissions.allow.filter((value): value is string => typeof value === 'string') : [];
  settings.permissions = { ...permissions, allow: [...new Set([...existing, ...rules])] };
  return { args: [...remaining, '--settings', JSON.stringify(settings)], rules };
}
