import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './paths.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

/** PowerShell single-quoted literals also work with apostrophes, spaces and Unicode. */
export function psLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

/** Built from public paths and bundled documentation only. Never reads auth/config contents. */
export function leaderGuide(port: number, instanceId?: string) {
  const profile = dataDir();
  const bundledCli = path.join(appRoot, 'cli/fleet.js');
  const cliArgs = existsSync(bundledCli)
    ? [bundledCli]
    : [require.resolve('tsx/cli', { paths: [appRoot] }), path.join(appRoot, 'cli/fleet.ts')];
  const connect = [
    `# Kết nối Agent Fleet đang mở · http://127.0.0.1:${port}`,
    `$env:FLEET_DATA_DIR = ${psLiteral(profile)}`,
    `$env:FLEET_SERVER_URL = ${psLiteral(`http://127.0.0.1:${port}`)}`,
    ...(instanceId ? [`$env:FLEET_SERVER_INSTANCE = ${psLiteral(instanceId)}`] : []),
    `function fleet { & ${[process.execPath, ...cliArgs].map(psLiteral).join(' ')} @args }`,
    'fleet connection',
    'fleet plan list --json',
    'fleet list --json',
  ].join('\n');
  const guide = readFileSync(path.join(appRoot, 'docs/leader-guide.md'), 'utf8');
  const agentGuide = readFileSync(path.join(appRoot, 'docs/agent-cli-guide.md'), 'utf8');
  const content = [
    '# Bàn giao cho leader — Agent Fleet',
    'App đang chạy trên máy này. Dùng kết nối dưới đây trong PowerShell để giao việc và theo dõi ngay trong app. Chạy lệnh kết nối trong mỗi cửa sổ PowerShell mới; không dùng fleet global vì có thể trỏ sang bản cũ.',
    '## Kết nối phiên hiện tại',
    '```powershell', connect, '```',
    'CLI tự đọc xác thực từ hồ sơ cục bộ. Không cần sao chép token vào hội thoại. Mở lại app có thể đổi cổng; sao chép hướng dẫn mới từ app để nhận thông tin hiện tại.',
    '## Quy trình leader', guide,
    '## Cách gọi và cấu hình các agent', agentGuide,
  ].join('\n\n');
  return { baseUrl: `http://127.0.0.1:${port}`, dataDir: profile, connect, content };
}
