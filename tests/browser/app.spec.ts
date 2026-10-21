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

test("首页、设置保存、鼠标音符与结束清理", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Air Piano · 指尖之间");
  await expect(
    page.getByRole("heading", { name: "让空气，有了旋律。" }),
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
  await expect(page.locator("#audio-status")).toHaveText("已就绪");
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
  await expect(page.locator("#audio-status")).toHaveText("未加载");
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

test("真实模型在 Worker 初始化、处理摄像头帧并支持暂停重启", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · 正在演奏", {
    timeout: 50000,
  });
  await expect(page.locator("#model-status")).toHaveText("已就绪");
  await expect(page.locator("#fps")).not.toHaveText("—", { timeout: 15000 });
  await page.locator("#pause").click();
  await expect(page.locator("#stage-state")).toHaveText("已暂停");
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#pause").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · 正在演奏");
  await page.locator("#stop").click();
  await expect(page.locator("#camera-status")).toHaveText("未开启");
  expect(
    await page
      .locator("#video")
      .evaluate((v: HTMLVideoElement) => v.srcObject === null),
  ).toBe(true);
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · 正在演奏", {
    timeout: 50000,
  });
  await page.locator("#stop").click();
  expect(errors).toEqual([]);
});

test("摄像头拒绝后提示原因并可重新尝试", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#notice")).toContainText("摄像头权限被拒绝");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#notes")).toHaveText("—");
});

test("加载中结束，迟到的摄像头流会释放", async ({ page }) => {
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
  await expect(page.locator("#stage-state")).toHaveText("演奏空间");
});

test("窄屏布局保持可用", async ({ page }) => {
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

test("本地真实模型识别官方手部图片，输出21个关键点", async ({ page }) => {
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

test("采样加载失败可重试，键盘演奏与释放", async ({ page }) => {
  await page.goto("/");
  await page.route("**/assets/piano/C4.mp3", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.locator("#demo").click();
  await expect(page.locator("#audio-status")).toHaveText("加载失败");
  await page.unroute("**/assets/piano/C4.mp3");
  await page.locator("#demo").click();
  await expect(page.locator("#audio-status")).toHaveText("已就绪");
  await page.getByRole("button", { name: "演奏 C4", exact: true }).focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#notes")).toHaveText("C4");
  await page.keyboard.up("Space");
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#stop").click();
});

test("摄像头回放手部图像完成发音、丢手释放与重弹", async ({ page }) => {
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
  await expect(page.locator("#stage-state")).toHaveText("LIVE · 正在演奏", {
    timeout: 50000,
  });
  await expect(page.locator("#hand-count")).toHaveText("1 只手已入镜", {
    timeout: 30000,
  });
  // 加入第8个白键后，同一张固定手部图片的食指落在F♯4区域。
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
  // 同一真实模型回放还要验证教学分支：手指确认F♯4后只完成一个步骤。
  await page.evaluate(() => {
    (window as any).__showHand = false;
  });
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#practice-mode").click();
  await page.locator('[data-song="steps"]').click();
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ 请弹 C4");
  for (const midi of [60, 61, 62, 63, 64, 65]) {
    await page.locator(`.accessible-keys button[data-midi="${midi}"]`).focus();
    await page.keyboard.press("Space");
  }
  await expect(page.locator("#lesson-target")).toHaveText("▼ 请弹 F♯4");
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

test("四指触控同时演奏并在释放后结束和弦", async ({ page }) => {
  await page.goto("/");
  await page.locator("#demo").click();
  await expect(page.locator("#audio-status")).toHaveText("已就绪");
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

test("模型资源加载失败可重试", async ({ page }) => {
  await page.goto("/");
  await page.route("**/assets/hand_landmarker.task", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.locator("#start").click();
  await expect(page.locator("#notice")).toContainText("模型初始化失败", {
    timeout: 45000,
  });
  await expect(page.locator("#start")).toBeEnabled();
  expect(
    await page
      .locator("#video")
      .evaluate((v: HTMLVideoElement) => v.srcObject === null),
  ).toBe(true);
  await page.unroute("**/assets/hand_landmarker.task");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · 正在演奏", {
    timeout: 50000,
  });
  await page.locator("#stop").click();
});

test("失焦和切换后台释放声音，结束释放摄像头轨道", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => (window as any).__hidden,
    });
  });
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · 正在演奏", {
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
  await expect(page.locator("#stage-state")).toHaveText("已暂停");
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
  await expect(page.locator("#stage-state")).toHaveText("LIVE · 正在演奏");
  await page.evaluate(() => {
    (window as any).__hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#stage-state")).toHaveText("已暂停");
  await page.evaluate(() => {
    (window as any).__hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    (window as any).__testStream = (
      document.getElementById("video") as HTMLVideoElement
    ).srcObject;
  });
  await expect(page.locator("#stage-state")).toHaveText("已暂停");
  await page.locator("#stop").click();
  expect(
    await page.evaluate(() =>
      ((window as any).__testStream as MediaStream)
        .getTracks()
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
});
