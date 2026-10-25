import { test, expect, type Page } from "@playwright/test";
async function play(page: Page, midi: number) {
  await page.locator(`.accessible-keys button[data-midi="${midi}"]`).focus();
  await page.keyboard.press("Space");
}

test("Pause and resume reuse the same camera through both controls; only end closes it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    (window as any).__cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      (window as any).__cameraRequests++;
      return get(constraints);
    };
  });
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing", {
    timeout: 50000,
  });
  await page.evaluate(() => {
    (window as any).__originalStream = (
      document.getElementById("video") as HTMLVideoElement
    ).srcObject;
  });
  await page.locator("#practice-mode").click();
  await page.locator("#lesson-start").click();
  for (let i = 0; i < 2; i++) {
    await page.locator("#lesson-pause").click();
    await expect(page.locator("#stage-state")).toHaveText("Paused");
    await expect(page.locator("#input-feedback")).toContainText(
      "camera stays connected",
    );
    expect(
      await page.evaluate(() => {
        const stream = (document.getElementById("video") as HTMLVideoElement)
          .srcObject as MediaStream;
        return (
          stream === (window as any).__originalStream &&
          stream.getVideoTracks()[0].readyState === "live"
        );
      }),
    ).toBe(true);
    await page.locator("#pause").click();
    await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing");
    await expect(page.locator("#lesson-pause")).toHaveText("Pause practice");
  }
  expect(await page.evaluate(() => (window as any).__cameraRequests)).toBe(1);
  await page.locator("#reach-start").click();
  await expect(page.locator("#reach-status")).toContainText(
    "Use a fingertip to play C4",
  );
  await expect(page.locator("#reach-start")).toHaveText("Stop reach check");
  await play(page, 60);
  await expect(page.locator("#notes")).toHaveText("—");
  await expect(page.locator("#reach-status")).toContainText(
    "Use a fingertip to play C4",
  );
  await page.locator("#reach-start").click();
  await expect(page.locator("#reach-status")).toContainText(
    "Reach check paused",
  );
  await page.locator("#lesson-pause").click();
  await expect(page.locator("#stage-state")).toHaveText("LIVE · Playing");
  expect(await page.evaluate(() => (window as any).__cameraRequests)).toBe(1);
  await page.locator("#stop").click();
  expect(
    await page.evaluate(
      () => (window as any).__originalStream.getVideoTracks()[0].readyState,
    ),
  ).toBe("ended");
});

test("Song filters, section loops, persistent first-try results, and history clearing", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#practice-mode").click();
  await page.locator("#song-range").selectOption("high");
  await expect(page.locator('[data-song="twinkle"]')).toBeHidden();
  await expect(page.locator('[data-song="brother"]')).toBeVisible();
  await page.locator("#song-level").selectOption("Basic");
  await expect(page.locator('[data-song="brother"]')).toBeHidden();
  await expect(page.locator('[data-song="steps"]')).toBeVisible();
  await page.locator("#song-search").fill("nonexistent song");
  await expect(page.locator("#song-empty")).toBeVisible();
  await page.locator("#song-search").fill("");
  await page.locator("#song-level").selectOption("all");
  await page.locator("#song-range").selectOption("all");
  await page.locator("#practice-options summary").click();
  await page.locator("#section-end").fill("2");
  await page.locator("#section-apply").click();
  await page.locator("#section-loop").check();
  await page.locator("#lesson-start").click();
  await expect(page.locator("#song-library")).toBeHidden();
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 2");
  await play(page, 62);
  await play(page, 60);
  await play(page, 60);
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 2");
  await expect(page.locator("#history-summary")).toHaveText(
    "Practice history (1 sessions)",
  );
  await page.locator("#section-loop").uncheck();
  await play(page, 60);
  await play(page, 60);
  await expect(page.locator("#lesson-result")).toContainText(
    "First-try accuracy 100%",
  );
  await expect(page.locator("#history-summary")).toHaveText(
    "Practice history (2 sessions)",
  );
  await page.reload();
  await page.locator("#practice-mode").click();
  await page.locator("#history-panel summary").click();
  await expect(page.locator("#history-list li")).toHaveCount(2);
  await expect(page.locator("#history-list")).toContainText("Notes 1–2");
  await page.locator("#history-clear").click();
  await expect(page.locator("#history-list li")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("air-piano:history:v1")),
  ).toBeNull();
});

test("Tricky-section retry, range errors, preview speed, and trigger diagnostics", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#practice-mode").click();
  await page.locator("#practice-options summary").click();
  await page.locator("#section-start").fill("3");
  await page.locator("#section-end").fill("2");
  await page.locator("#section-apply").click();
  await expect(page.locator("#notice")).toContainText("Invalid range");
  await page.locator("#section-start").fill("1");
  await page.locator("#section-apply").click();
  await page.locator("#listen-speed").selectOption("0.5");
  await page.locator("#song-listen").click();
  await expect(page.locator("#input-feedback")).toContainText(
    "Preview playing",
  );
  await page.locator("#song-listen").click();
  await page.locator("#lesson-start").click();
  await play(page, 62);
  await play(page, 60);
  await play(page, 60);
  await page.locator("#lesson-retry").click();
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 2");
  await page.locator("#diagnostics summary").click();
  await expect(page.locator("#diagnostic-data")).toContainText("Latest reason");
  await page.locator("#reach-start").click();
  await expect(page.locator("#notice")).toContainText("Start or resume camera");
});
