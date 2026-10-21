import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (process.platform === "win32"
          ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
          : undefined),
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  workers: 1,
  reporter: "list",
});
