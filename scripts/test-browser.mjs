import { spawn } from "node:child_process";
import { createServer } from "vite";
const url = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
let server;
try {
  const available = await fetch(url, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!available) {
    if (process.env.TEST_BASE_URL) throw new Error(`请先启动测试服务：${url}`);
    // Own Vite in this process so Windows teardown needs no taskkill/WMI.
    server = await createServer({
      server: { host: "127.0.0.1", port: 4173, strictPort: true },
    });
    await server.listen();
  }
  const child = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, TEST_BASE_URL: url },
      windowsHide: true,
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await server?.close();
}
