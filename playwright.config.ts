import { defineConfig, devices } from "@playwright/test";

/**
 * Two projects:
 *  - public: needs nothing but a running app (signed-out surface, redirects, headers, mobile layout).
 *  - authed: needs real sign-ins. Set E2E_<ROLE>_EMAIL / E2E_<ROLE>_PASSWORD for ADMIN, ENGINEER, PM, LEAD, LEADER (see tests/e2e/README.md).
 *    Point it at a staging Supabase project, never at production data: the specs create conversations.
 * E2E_BASE_URL defaults to a local `next start`. E2E_CHROMIUM_PATH points at an existing Chromium when `npx playwright install` isn't possible.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "public-desktop", testMatch: /public\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "public-mobile", testMatch: /public\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    { name: "authed", testMatch: /\.authed\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
});
