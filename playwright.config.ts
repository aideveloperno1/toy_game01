import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3187",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "node dist-server/local.mjs",
    url: "http://127.0.0.1:3187/api/health",
    reuseExistingServer: false,
    env: { PORT: "3187", DATA_DIR: ".data/swa-e2e", NODE_ENV: "test" },
    timeout: 30000,
  },
});
