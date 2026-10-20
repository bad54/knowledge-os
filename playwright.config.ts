import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  webServer: [
    {
      command: 'npx tsc -p tsconfig.e2e.json && node .local/e2e/tests/e2e/server.js',
      url: 'http://127.0.0.1:3101/api/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'npm run dev -w @knowledge/web -- --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60000,
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3101' },
    },
  ],
});
