import { test, expect, type Page } from "@playwright/test";
import { SONGS, practiceNotes } from "../../src/songs";

async function enterLesson(page: Page) {
  await page.goto("/");
  await page.locator("#practice-mode").click();
  await page.locator("#lesson-start").click();
  await expect(page.locator("#audio-status")).toHaveText("Ready");
  await expect(page.locator("#lesson-target")).toHaveText("▼ Play C4");
  await expect(page.locator("#input-feedback")).toContainText(
    "Mouse and keyboard are ready",
  );
}
async function pressNote(page: Page, midi: number) {
  await page.locator(`.accessible-keys button[data-midi="${midi}"]`).focus();
  await page.keyboard.press("Space");
}

test("Song selection, wrong-note hold, repeated notes, and full completion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enterLesson(page);
  await page.screenshot({
    path: "work/screenshots/lesson-desktop.png",
    fullPage: true,
  });
  await pressNote(page, 62);
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 42");
  await expect(page.locator("#lesson-feedback")).toContainText("Try again");
  await page.locator('.accessible-keys button[data-midi="60"]').focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#lesson-progress")).toHaveText("1 / 42");
  await expect(page.locator("#lesson-feedback")).toContainText(
    "Release all keys",
  );
  await page.waitForTimeout(180);
  await expect(page.locator("#lesson-progress")).toHaveText("1 / 42");
  await page.keyboard.up("Space");
  for (const midi of practiceNotes(SONGS[0]).slice(1))
    await pressNote(page, midi);
  await expect(page.locator("#lesson-target")).toHaveText("Practice complete!");
  await expect(page.locator("#lesson-result")).toContainText(
    "Wrong notes 1 times",
  );
  await expect(page.locator("#lesson-result")).toContainText(
    "First-try accuracy 98%",
  );
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 42");
  await page.locator("#practice-mode").click();
  await page.locator('[data-song="brother"]').click();
  await expect(page.locator("#lesson-target")).toHaveText("Ready to begin");
  await expect(page.locator("#song-source")).toContainText(
    "low G changed to G4",
  );
  await page.locator("#free-mode").click();
  await expect(page.locator("#lesson-panel")).toBeHidden();
  await pressNote(page, 72);
  await expect(page.locator("#notes")).toHaveText("—");
  expect(errors).toEqual([]);
});

test("Preview is isolated from user input; changing songs cancels sources and restarting resets progress", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const stop = AudioBufferSourceNode.prototype.stop;
    (window as any).__cancelledSources = 0;
    AudioBufferSourceNode.prototype.stop = function (when?: number) {
      if (when === undefined) (window as any).__cancelledSources++;
      return stop.call(this, when);
    };
  });
  await enterLesson(page);
  await pressNote(page, 60);
  await page.locator("#song-listen").click();
  await expect(page.locator("#song-listen")).toHaveText("Stop preview");
  await page.waitForTimeout(150);
  await pressNote(page, 60);
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 42");
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#practice-mode").click();
  await page.locator('[data-song="ode"]').click();
  await expect(page.locator("#song-listen")).toHaveText("Preview song");
  expect(
    await page.evaluate(() => (window as any).__cancelledSources),
  ).toBeGreaterThan(35);
  await page.waitForTimeout(700);
  await expect(page.locator("#lesson-target")).toHaveText("Ready to begin");
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ Play E4");
  await page.locator("#lesson-library").click();
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 30");
});

test("Pause mouse practice, retain progress after backgrounding, and return to free play", async ({
  page,
}) => {
  await enterLesson(page);
  await pressNote(page, 60);
  await page.locator("#lesson-pause").click();
  await expect(page.locator("#lesson-feedback")).toContainText(
    "Practice paused",
  );
  await pressNote(page, 60);
  await expect(page.locator("#lesson-progress")).toHaveText("1 / 42");
  await page.locator("#lesson-pause").click();
  await pressNote(page, 60);
  await expect(page.locator("#lesson-progress")).toHaveText("2 / 42");
  await page.locator('.accessible-keys button[data-midi="67"]').focus();
  await page.keyboard.down("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#notes")).toHaveText("—");
  await expect(page.locator("#lesson-feedback")).toContainText(
    "Practice paused",
  );
  await page.keyboard.up("Space");
  await page.locator("#lesson-pause").click();
  await expect(page.locator("#lesson-progress")).toHaveText("3 / 42");
  await page.locator("#free-mode").click();
  await page.locator('.accessible-keys button[data-midi="72"]').focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#notes")).toHaveText("C5");
  await page.keyboard.up("Space");
  await page.locator("#stop").click();
  await expect(page.locator("#audio-status")).toHaveText("Not loaded");
});

test("Changing songs during sound loading invalidates old tasks; failed loading can retry", async ({
  page,
}) => {
  await page.route("**/assets/piano/C4.mp3", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto("/");
  await page.locator("#practice-mode").click();
  await page.locator("#lesson-start").click();
  await page.locator('[data-song="ode"]').click();
  await page.waitForTimeout(900);
  await expect(page.locator("#lesson-target")).toHaveText("Ready to begin");
  await expect(page.locator("#audio-status")).toHaveText("Ready");
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ Play E4");
  await page.locator("#stop").click();
  await page.unroute("**/assets/piano/C4.mp3");
  await page.route("**/assets/piano/C4.mp3", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.locator("#lesson-start").click();
  await expect(page.locator("#audio-status")).toHaveText("Loading failed");
  await expect(page.locator("#lesson-start")).toBeEnabled();
  await page.unroute("**/assets/piano/C4.mp3");
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ Play E4");
});

test("Narrow-screen library, targets, and results fit without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterLesson(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#lesson-panel").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "work/screenshots/lesson-mobile.png",
    fullPage: true,
  });
});
