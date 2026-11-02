import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Workers inherit this directory; never use a developer's normal Fleet data.
const dataDir = process.env.FLEET_E2E_DATA_DIR
  ?? mkdtempSync(path.join(os.tmpdir(), 'agent-fleet-e2e-'));
process.env.FLEET_E2E_DATA_DIR = dataDir;
process.env.FLEET_DATA_DIR = dataDir;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalSetup: './test/e2e/global-setup.ts',
  globalTeardown: './test/e2e/global-teardown.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4610',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Playwright starts webServer before globalSetup. Run the same idempotent
    // setup script here so the config/repo exist before main.ts reads them.
    command: 'npm run build:web && npx tsx test/e2e/global-setup.ts && npx tsx server/main.ts',
    env: { FLEET_DATA_DIR: dataDir },
    url: 'http://127.0.0.1:4610/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
