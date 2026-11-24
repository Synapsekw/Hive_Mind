import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /map-perf\.spec\.ts/,
    },
    // The frame-time checks run after everything else, one at a time, so no other test shares
    // the machine with them. Frames land on a fixed grid (16.7 ms steps), which leaves the
    // 34 ms limit no margin, so a run that misses is tried again before it counts as a failure.
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /map-perf\.spec\.ts/,
      dependencies: ["chromium"],
      retries: 2,
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
