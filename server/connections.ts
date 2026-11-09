import type { ConnectedClient, ConnectedToolId } from '../shared/connections.js';

const KNOWN_TOOLS: ReadonlySet<ConnectedToolId> = new Set([
  'agy',
  'codex',
  'qodercli',
  'opencode',
  'claude',
  'powershell',
  'unknown',
]);

const DEFAULT_TOOL_NAMES: Record<ConnectedToolId, string> = {
  agy: 'Antigravity CLI',
  codex: 'Codex CLI',
  qodercli: 'Qoder CLI',
  opencode: 'OpenCode',
  claude: 'Claude Code',
  powershell: 'PowerShell / Terminal',
  unknown: 'Fleet CLI',
};

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

function safeDecode(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function normalizeToolId(raw: string | undefined): ConnectedToolId {
  if (!raw) return 'unknown';
  const lower = raw.trim().toLowerCase();
  if (KNOWN_TOOLS.has(lower as ConnectedToolId)) {
    return lower as ConnectedToolId;
  }
  return 'unknown';
}

export class ConnectionRegistry {
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly maxEntries = 50;

  record(
    headers: Record<string, string | string[] | undefined>,
    pathname: string,
    method: string,
  ): ConnectedClient | null {
    const rawTool = getHeader(headers, 'x-fleet-client-tool');
    const rawCmd = getHeader(headers, 'x-fleet-client-cmd');

    if (!rawTool && !rawCmd) {
      return null;
    }

    const toolId = normalizeToolId(rawTool);
    const rawName = getHeader(headers, 'x-fleet-client-name');
    const toolName = rawName?.trim() || DEFAULT_TOOL_NAMES[toolId] || DEFAULT_TOOL_NAMES.unknown;

    const pid = parsePositiveInt(getHeader(headers, 'x-fleet-client-pid'));
    const cwd = safeDecode(getHeader(headers, 'x-fleet-client-cwd'));
    const decodedCmd = safeDecode(rawCmd);
    const lastCommand = decodedCmd && decodedCmd.trim().length > 0 ? decodedCmd : `${method} ${pathname}`;

    const id = `${toolId}:${cwd ?? 'global'}`;
    const now = Date.now();
    const existing = this.clients.get(id);

    const client: ConnectedClient = {
      id,
      toolId,
      toolName,
      pid: pid ?? existing?.pid ?? null,
      cwd,
      lastCommand,
      connectedAt: existing?.connectedAt ?? now,
      lastSeenAt: now,
      requestCount: (existing?.requestCount ?? 0) + 1,
    };

    this.clients.set(id, client);
    this.prune();

    return client;
  }

  list(): ConnectedClient[] {
    return [...this.clients.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  clear(): void {
    this.clients.clear();
  }

  private prune(): void {
    if (this.clients.size <= this.maxEntries) return;
    const sorted = [...this.clients.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    const toRemove = sorted.slice(0, this.clients.size - this.maxEntries);
    for (const [key] of toRemove) {
      this.clients.delete(key);
    }
  }
}
