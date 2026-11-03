import { describe, expect, test } from 'vitest';
import { agyCommandArgs, validateCommandOptions } from '../../server/command-permissions.js';

describe('AGY per-run command approval', () => {
  test('ask preserves settings and does not grant command permissions', () => {
    const args = ['--model', 'fast', '--settings', '{"theme":"dark"}'];
    expect(agyCommandArgs(args, {}, 'npm test', 'C:\\worktree')).toEqual({ args, rules: [] });
  });
  test('auto grants terminal commands only through session settings and preserves other rules', () => {
    const original = JSON.stringify({ theme: 'dark', permissions: { allow: ['read_file(*)'], deny: ['command(forbidden)'] } });
    const result = agyCommandArgs(['--model','fast','--settings',original], {commandPolicy:'auto'}, null, 'C:\\worktree');
    expect(result.args.slice(0,2)).toEqual(['--model','fast']);
    const settings = JSON.parse(result.args.at(-1)!);
    expect(settings).toEqual({theme:'dark',permissions:{allow:['read_file(*)','command(*)'],deny:['command(forbidden)']}});
    expect(result.args).not.toContain('--dangerously-skip-permissions');
    expect(JSON.parse(original).permissions.allow).toEqual(['read_file(*)']);
  });
  test('check-only allows explicit checks, deduplicates commands and never grants wildcard', () => {
    const result=agyCommandArgs([], {commandPolicy:'check-only',allowedCommands:['node check.cjs','npm test']}, 'node check.cjs', 'C:\\worktree');
    expect(result.rules).toEqual(['command(node check.cjs)','command(npm test)']);
    expect(result.rules).not.toContain('command(*)');
  });
  test('rejects invalid policies, multiline commands and oversized allow lists', () => {
    expect(()=>validateCommandOptions({commandPolicy:'invalid' as never})).toThrow();
    expect(()=>validateCommandOptions({allowedCommands:['node check.cjs\nother']})).toThrow();
    expect(()=>validateCommandOptions({allowedCommands:Array(65).fill('node check.cjs')})).toThrow();
  });
});
