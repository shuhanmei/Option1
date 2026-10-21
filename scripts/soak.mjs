import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const duration = Number(process.env.SOAK_MS || 900000);
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (process.platform === "win32"
      ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      : undefined),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const encoded = (await readFile("work/thumb_up.jpg")).toString("base64");
const samples = [];
try {
  await page.addInitScript((encoded) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const stream = canvas.captureStream(30);
      const timer = setInterval(() => {
        if (stream.getVideoTracks()[0].readyState === "ended")
          clearInterval(timer);
        else ctx.drawImage(image, 0, 0);
      }, 33);
      return stream;
    };
  }, encoded);
  await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:4173");
  await page.locator("#start").click();
  await page
    .locator("#stage-state")
    .filter({ hasText: "LIVE" })
    .waitFor({ timeout: 50000 });
  await page.waitForFunction(
    () => document.getElementById("notes").textContent === "F♯4",
    undefined,
    { timeout: 30000 },
  );
  const started = Date.now();
  const client = await page.context().newCDPSession(page);
  while (Date.now() - started < duration) {
    await page.waitForTimeout(
      Math.min(30000, duration - (Date.now() - started)),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    await client.send("HeapProfiler.collectGarbage");
    const heap = await client.send("Runtime.getHeapUsage");
    const state = await page.evaluate(() => ({
      state: document.getElementById("stage-state").textContent,
      note: document.getElementById("notes").textContent,
      fps: Number(document.getElementById("fps").textContent),
      inferenceMs: Number(document.getElementById("inference").textContent),
    }));
    samples.push({
      elapsedMs: Date.now() - started,
      heapBytes: heap.usedSize,
      ...state,
    });
    if (!state.state.includes("LIVE") || state.note !== "F♯4" || state.fps < 1)
      throw new Error(`Pipeline stalled: ${JSON.stringify(state)}`);
    console.log(JSON.stringify(samples.at(-1)));
  }
  await page.locator("#stop").click();
  if (!(await page.locator("#video").evaluate((v) => v.srcObject === null)))
    throw new Error("Camera not released");
  const report = {
    passed: true,
    requestedDurationMs: duration,
    samples,
    errors,
    note: "Synthetic hand-image camera replay; renderer JS heap sampled after GC. Not physical-camera or audio-latency acceptance.",
  };
  await mkdir("work", { recursive: true });
  await writeFile("work/soak-result.json", JSON.stringify(report, null, 2));
  console.log(`SOAK PASSED: ${duration / 60000} minutes`);
} finally {
  await browser.close();
}
