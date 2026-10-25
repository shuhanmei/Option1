import { test, expect } from "@playwright/test";
async function handFixture(): Promise<Buffer> {
  const fs = await import("node:fs/promises");
  await fs.mkdir("work", { recursive: true });
  if (!(await fs.stat("work/thumb_up.jpg").catch(() => null))) {
    const response = await fetch(
      "https://storage.googleapis.com/mediapipe-assets/thumb_up.jpg",
    );
    if (!response.ok) throw new Error("Official hand fixture download failed");
    await fs.writeFile(
      "work/thumb_up.jpg",
      Buffer.from(await response.arrayBuffer()),
    );
  }
  return fs.readFile("work/thumb_up.jpg");
}

test("Home, saved settings, mouse notes, and end cleanup", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Air Piano · At Your Fingertips");
  await expect(
    page.getByRole("heading", { name: "Give air a melody." }),
  ).toBeVisible();
  await page.locator("#all-fingers").click();
  await expect(page.locator("#all-fingers")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.locator("#all-fingers")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#demo").click();
  await expect(page.locator("#audio-status")).toHaveText("Ready");
  const box = (await page.locator("#canvas").boundingBox())!;
  // Default C4 lower half: width .84, white step /8, y .64*(1-.30).
  const videoWidth = Math.min(box.width, (box.height * 4) / 3);
  const videoHeight = (videoWidth * 3) / 4;
  await page.mouse.move(
    box.x + (box.width - videoWidth) / 2 + videoWidth * 0.14,
    box.y + (box.height - videoHeight) / 2 + videoHeight * 0.7,
  );
  await page.mouse.down();
  await expect(page.locator("#notes")).toHaveText("C4");
  await page.mouse.up();
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#stop").click();
  await expect(page.locator("#audio-status")).toHaveText("Not loaded");
  await page.locator("#reset").click();
  await expect(page.locator("#index-fingers")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#help").click();
  await expect(page.locator("#help-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#help-dialog")).not.toBeVisible();
  await page.screenshot({
    path: "work/screenshots/desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Initialize the real worker model, process camera frames, and pause/restart", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing", {
    timeout: 50000,
  });
  await expect(page.locator("#model-status")).toHaveText("Ready");
  await expect(page.locator("#fps")).not.toHaveText("—", { timeout: 15000 });
  await page.locator("#pause").click();
  await expect(page.locator("#stage-state")).toHaveText("Paused");
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#pause").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing");
  await page.locator("#stop").click();
  await expect(page.locator("#camera-status")).toHaveText("Off");
  expect(
    await page
      .locator("#video")
      .evaluate((v: HTMLVideoElement) => v.srcObject === null),
  ).toBe(true);
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing", {
    timeout: 50000,
  });
  await page.locator("#stop").click();
  expect(errors).toEqual([]);
});

test("Explain camera permission denial and allow retry", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#notice")).toContainText(
    "Camera permission denied",
  );
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#notes")).toHaveText("—");
});

test("End during loading releases a late camera stream", async ({ page }) => {
  await page.addInitScript(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    (window as any).__stream = null;
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await get(c);
      (window as any).__stream = s;
      await new Promise((r) => setTimeout(r, 1200));
      return s;
    };
  });
  await page.goto("/");
  await page.locator("#start").click();
  await page.locator("#stop").click();
  await page.waitForTimeout(1800);
  expect(
    await page.evaluate(() =>
      (window as any).__stream
        ?.getTracks()
        .every((t: MediaStreamTrack) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await expect(page.locator("#stage-state")).toHaveText("Your stage");
});

test("Narrow-screen layout remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#start")).toBeVisible();
  await page.screenshot({
    path: "work/screenshots/mobile.png",
    fullPage: true,
  });
});

test("Real local model identifies 21 landmarks in the official hand image", async ({
  page,
}) => {
  const bytes = Array.from(await handFixture());
  await page.goto("/");
  const result = await page.evaluate(async (bytes) => {
    return await new Promise<{
      hands: number;
      points: number;
      ms: number;
      tip: { x: number; y: number };
    }>((resolve, reject) => {
      const worker = new Worker("/tracker.worker.js");
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Hand fixture timeout"));
      }, 45000);
      worker.onmessage = async ({ data }) => {
        if (data.type === "error") {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(data.message));
        }
        if (data.type === "ready") {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
          );
          worker.postMessage(
            { type: "frame", bitmap, timestamp: performance.now() },
            [bitmap],
          );
        }
        if (data.type === "result") {
          clearTimeout(timeout);
          worker.terminate();
          resolve({
            hands: data.hands.length,
            points: data.hands[0]?.landmarks.length,
            ms: data.ms,
            tip: data.hands[0]?.landmarks[8],
          });
        }
      };
      worker.postMessage({ type: "init" });
    });
  }, bytes);
  expect(result.hands).toBeGreaterThan(0);
  expect(result.points).toBe(21);
  console.log(
    `Real hand inference: ${result.ms.toFixed(1)}ms; index ${JSON.stringify(result.tip)}`,
  );
});

test("Retry failed samples and play/release with the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.route("**/assets/piano/C4.mp3", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.locator("#demo").click();
  await expect(page.locator("#audio-status")).toHaveText("Loading failed");
  await page.unroute("**/assets/piano/C4.mp3");
  await page.locator("#demo").click();
  await expect(page.locator("#audio-status")).toHaveText("Ready");
  await page.getByRole("button", { name: "Play C4", exact: true }).focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#notes")).toHaveText("C4");
  await page.keyboard.up("Space");
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#stop").click();
});

test("Camera replay triggers a note, releases on hand loss, and retriggers", async ({
  page,
}) => {
  const encoded = (await handFixture()).toString("base64");
  await page.addInitScript((encoded) => {
    (window as any).__attacks = 0;
    (window as any).__sampleHasSignal = false;
    (window as any).__showHand = true;
    const BaseAudioContext = window.AudioContext;
    window.AudioContext = class extends BaseAudioContext {
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args: any[]) => {
          (window as any).__attacks++;
          (window as any).__sampleHasSignal =
            source.buffer?.getChannelData(0).some((v) => Math.abs(v) > 0.001) ??
            false;
          return start(...(args as []));
        };
        return source;
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const stream = canvas.captureStream(30);
      const timer = setInterval(() => {
        if (stream.getVideoTracks()[0].readyState === "ended")
          clearInterval(timer);
        else if ((window as any).__showHand) context.drawImage(image, 0, 0);
        else {
          context.fillStyle = "#eeeeee";
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
      }, 33);
      return stream;
    };
  }, encoded);
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing", {
    timeout: 50000,
  });
  await expect(page.locator("#hand-count")).toHaveText("1 hands detected", {
    timeout: 30000,
  });
  // With the eighth white key, the fixture index finger lands in the F-sharp-4 region.
  await expect(page.locator("#notes")).toHaveText("F♯4", { timeout: 30000 });
  await page.waitForTimeout(500);
  await expect(page.locator("#notes")).toHaveText("F♯4");
  expect(await page.evaluate(() => (window as any).__attacks)).toBe(1);
  expect(await page.evaluate(() => (window as any).__sampleHasSignal)).toBe(
    true,
  );
  await page.evaluate(() => {
    (window as any).__showHand = false;
  });
  await expect(page.locator("#notes")).toHaveText("—", { timeout: 5000 });
  await page.evaluate(() => {
    (window as any).__showHand = true;
  });
  await expect(page.locator("#notes")).toHaveText("F♯4", { timeout: 10000 });
  expect(await page.evaluate(() => (window as any).__attacks)).toBe(2);
  await page.screenshot({
    path: "work/screenshots/tracking.png",
    fullPage: true,
  });
  await page.locator("#pause").click();
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#pause").click();
  await expect(page.locator("#notes")).toHaveText("F♯4", { timeout: 15000 });
  // Also verify the lesson branch: confirming F-sharp-4 completes exactly one step.
  await page.evaluate(() => {
    (window as any).__showHand = false;
  });
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#practice-mode").click();
  await page.locator('[data-song="steps"]').click();
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ Play C4");
  for (const midi of [60, 61, 62, 63, 64, 65]) {
    await page.locator(`.accessible-keys button[data-midi="${midi}"]`).focus();
    await page.keyboard.press("Space");
  }
  await expect(page.locator("#lesson-target")).toHaveText("▼ Play F♯4");
  await page.evaluate(() => {
    (window as any).__showHand = true;
  });
  await expect(page.locator("#lesson-progress")).toHaveText("7 / 26", {
    timeout: 15000,
  });
  await page.waitForTimeout(400);
  await expect(page.locator("#lesson-progress")).toHaveText("7 / 26");
  await page.locator("#stop").click();
});

test("Four simultaneous touch notes form and release a chord", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#audio-status")).toHaveText("Ready");
  const box = (await page.locator("#canvas").boundingBox())!;
  const w = Math.min(box.width, (box.height * 4) / 3),
    h = (w * 3) / 4;
  const x = box.x + (box.width - w) / 2,
    y = box.y + (box.height - h) / 2;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [0, 2, 4, 6].map((i, id) => ({
      x: x + w * (0.08 + (0.84 / 8) * (i + 0.5)),
      y: y + h * 0.7,
      id,
      radiusX: 2,
      radiusY: 2,
    })),
  });
  await expect(page.locator("#notes")).toHaveText("C4 · E4 · G4 · B4");
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#stop").click();
});

test("Retry after model resource failure", async ({ page }) => {
  await page.goto("/");
  await page.route("**/assets/hand_landmarker.task", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.locator("#start").click();
  await expect(page.locator("#notice")).toContainText(
    "model initialization failed",
    {
      timeout: 45000,
    },
  );
  await expect(page.locator("#start")).toBeEnabled();
  expect(
    await page
      .locator("#video")
      .evaluate((v: HTMLVideoElement) => v.srcObject === null),
  ).toBe(true);
  await page.unroute("**/assets/hand_landmarker.task");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing", {
    timeout: 50000,
  });
  await page.locator("#stop").click();
});

test("Blur and backgrounding release sound; ending releases camera tracks", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => (window as any).__hidden,
    });
  });
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing", {
    timeout: 50000,
  });
  const box = (await page.locator("#canvas").boundingBox())!;
  const w = Math.min(box.width, (box.height * 4) / 3),
    h = (w * 3) / 4;
  await page.mouse.move(
    box.x + (box.width - w) / 2 + w * 0.14,
    box.y + (box.height - h) / 2 + h * 0.7,
  );
  await page.mouse.down();
  await expect(page.locator("#notes")).toHaveText("C4");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#stage-state")).toHaveText("Paused");
  await expect(page.locator("#notes")).toHaveText("—");
  await page.mouse.up();
  expect(
    await page
      .locator("#video")
      .evaluate((v: HTMLVideoElement) =>
        (v.srcObject as MediaStream)
          .getTracks()
          .every((t) => t.readyState === "live"),
      ),
  ).toBe(true);
  await page.locator("#pause").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing");
  await page.evaluate(() => {
    (window as any).__hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#stage-state")).toHaveText("Paused");
  await page.evaluate(() => {
    (window as any).__hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    (window as any).__testStream = (
      document.getElementById("video") as HTMLVideoElement
    ).srcObject;
  });
  await expect(page.locator("#stage-state")).toHaveText("Paused");
  await page.locator("#stop").click();
  expect(
    await page.evaluate(() =>
      ((window as any).__testStream as MediaStream)
        .getTracks()
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
});
