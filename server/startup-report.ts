import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isCorruptionError } from './db-maintenance.js';
import { dataDir } from './paths.js';

export type StartupErrorCode = 'db_corrupt' | 'port_in_use' | 'unknown';

export interface StartupReport {
  code: StartupErrorCode;
  message: string;
  hint: string;
  at: string;
  logTail?: string[];
}

const HINTS: Record<StartupErrorCode, string> = {
  db_corrupt: 'Cơ sở dữ liệu lịch sử bị hỏng. Dữ liệu chưa bị xoá: chạy `fleet db repair --yes` (hoặc `node server/main.js --repair-db`) khi máy chủ đang tắt (tự sao lưu vào thư mục backups trước khi sửa), hoặc khôi phục từ bản sao lưu gần nhất trong backups.',
  port_in_use: 'Cổng đang được chương trình khác dùng, có thể là một Agent Fleet khác đang chạy. Tắt tiến trình đó hoặc đổi "port" trong fleet.config.json rồi khởi động lại.',
  unknown: 'Máy chủ không khởi động được vì lỗi chưa phân loại. Xem thông điệp và logTail trong tệp này, kiểm tra fleet.config.json rồi thử khởi động lại.',
};

/** Mask anything secret-shaped before text reaches disk. */
export function redact(text: string): string {
  return text
    .replace(/(x-fleet-token|fleet_token)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1$2***')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/\beyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)*/g, 'eyJ***')
    .replace(/\b[0-9a-fA-F]{32,}\b/g, '***');
}

export function classifyStartupError(error: unknown): { code: StartupErrorCode; hint: string } {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'EADDRINUSE') return { code: 'port_in_use', hint: HINTS.port_in_use };
  if (isCorruptionError(error)) return { code: 'db_corrupt', hint: HINTS.db_corrupt };
  return { code: 'unknown', hint: HINTS.unknown };
}

const reportPath = (): string => path.win32.join(dataDir(), 'startup-error.json');

/** Write `startup-error.json`; returns the report, or null when even that is impossible. */
export function writeStartupReport(error: unknown, logTail: string[] = []): StartupReport | null {
  const { code, hint } = classifyStartupError(error);
  const report: StartupReport = {
    code,
    message: redact(error instanceof Error ? error.message : String(error)).slice(0, 2_000),
    hint,
    at: new Date().toISOString(),
  };
  if (logTail.length > 0) report.logTail = logTail.slice(-20).map(line => redact(line).slice(0, 500));
  try {
    writeFileSync(reportPath(), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return report;
  } catch {
    return null;
  }
}

export function clearStartupReport(): void {
  try { rmSync(reportPath(), { force: true }); } catch { /* best effort */ }
}
