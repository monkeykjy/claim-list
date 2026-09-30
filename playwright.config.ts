import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.CLAIMLIST_E2E_DIR ||= mkdtempSync(join(tmpdir(), "claimlist-e2e-"));
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node --conditions=react-server --import tsx scripts/prepare-e2e.ts && node --import tsx scripts/server.ts --production",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      CLAIMLIST_E2E_DIR: process.env.CLAIMLIST_E2E_DIR,
      DATABASE_PATH: join(process.env.CLAIMLIST_E2E_DIR, "list.sqlite"),
      APP_ORIGIN: "http://127.0.0.1:3100",
      PORT: "3100",
      LISTEN_HOST: "127.0.0.1",
      TRUSTED_PROXY_IPS: "",
    },
  },
});
