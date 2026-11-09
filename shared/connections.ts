export type ConnectedToolId =
  | 'agy'
  | 'codex'
  | 'qodercli'
  | 'opencode'
  | 'claude'
  | 'powershell'
  | 'unknown';

export interface ConnectedClient {
  id: string;
  toolId: ConnectedToolId;
  toolName: string;
  pid: number | null;
  cwd: string | null;
  lastCommand: string;
  connectedAt: number;
  lastSeenAt: number;
  requestCount: number;
}
