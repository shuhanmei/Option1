import { test, expect, type Page } from "@playwright/test";
import { SONGS, practiceNotes } from "../../src/songs";

async function enterLesson(page: Page) {
  await page.goto("/");
  await page.locator("#practice-mode").click();
  await page.locator("#lesson-start").click();
  await expect(page.locator("#audio-status")).toHaveText("已就绪");
  await expect(page.locator("#lesson-target")).toHaveText("▼ 请弹 C4");
  await expect(page.locator("#input-feedback")).toContainText(
    "鼠标/辅助键盘已就绪",
  );
}
async function pressNote(page: Page, midi: number) {
  await page.locator(`.accessible-keys button[data-midi="${midi}"]`).focus();
  await page.keyboard.press("Space");
}

test("选曲、错误停留、连续同音重弹和完整练习结果", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enterLesson(page);
  await page.screenshot({
    path: "work/screenshots/lesson-desktop.png",
    fullPage: true,
  });
  await pressNote(page, 62);
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 42");
  await expect(page.locator("#lesson-feedback")).toContainText("再试一次");
  await page.locator('.accessible-keys button[data-midi="60"]').focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#lesson-progress")).toHaveText("1 / 42");
  await expect(page.locator("#lesson-feedback")).toContainText("释放所有琴键");
  await page.waitForTimeout(180);
  await expect(page.locator("#lesson-progress")).toHaveText("1 / 42");
  await page.keyboard.up("Space");
  for (const midi of practiceNotes(SONGS[0]).slice(1))
    await pressNote(page, midi);
  await expect(page.locator("#lesson-target")).toHaveText("练习完成！");
  await expect(page.locator("#lesson-result")).toContainText("错误输入 1 次");
  await expect(page.locator("#lesson-result")).toContainText("首次命中率 98%");
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 42");
  await page.locator("#practice-mode").click();
  await page.locator('[data-song="brother"]').click();
  await expect(page.locator("#lesson-target")).toHaveText("准备开始");
  await expect(page.locator("#song-source")).toContainText("低音G改为G4");
  await page.locator("#free-mode").click();
  await expect(page.locator("#lesson-panel")).toBeHidden();
  await pressNote(page, 72);
  await expect(page.locator("#notes")).toHaveText("—");
  expect(errors).toEqual([]);
});

test("试听隔离用户输入，切歌取消所有旧播放源，重新练习从头开始", async ({
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
  await expect(page.locator("#song-listen")).toHaveText("停止试听");
  await page.waitForTimeout(150);
  await pressNote(page, 60);
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 42");
  await expect(page.locator("#notes")).toHaveText("—");
  await page.locator("#practice-mode").click();
  await page.locator('[data-song="ode"]').click();
  await expect(page.locator("#song-listen")).toHaveText("试听整首");
  expect(
    await page.evaluate(() => (window as any).__cancelledSources),
  ).toBeGreaterThan(35);
  await page.waitForTimeout(700);
  await expect(page.locator("#lesson-target")).toHaveText("准备开始");
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ 请弹 E4");
  await page.locator("#lesson-library").click();
  await expect(page.locator("#lesson-progress")).toHaveText("0 / 30");
});

test("鼠标练习暂停与后台释放，进度保留；切回自由弹奏可以正常输入", async ({
  page,
}) => {
  await enterLesson(page);
  await pressNote(page, 60);
  await page.locator("#lesson-pause").click();
  await expect(page.locator("#lesson-feedback")).toContainText("练习已暂停");
  await pressNote(page, 60);
  await expect(page.locator("#lesson-progress")).toHaveText("1 / 42");
  await page.locator("#lesson-pause").click();
  await pressNote(page, 60);
  await expect(page.locator("#lesson-progress")).toHaveText("2 / 42");
  await page.locator('.accessible-keys button[data-midi="67"]').focus();
  await page.keyboard.down("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#notes")).toHaveText("—");
  await expect(page.locator("#lesson-feedback")).toContainText("练习已暂停");
  await page.keyboard.up("Space");
  await page.locator("#lesson-pause").click();
  await expect(page.locator("#lesson-progress")).toHaveText("3 / 42");
  await page.locator("#free-mode").click();
  await page.locator('.accessible-keys button[data-midi="72"]').focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#notes")).toHaveText("C5");
  await page.keyboard.up("Space");
  await page.locator("#stop").click();
  await expect(page.locator("#audio-status")).toHaveText("未加载");
});

test("准备音色时切歌，迟到的加载不会启动旧歌曲；失败后可重试", async ({
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
  await expect(page.locator("#lesson-target")).toHaveText("准备开始");
  await expect(page.locator("#audio-status")).toHaveText("已就绪");
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ 请弹 E4");
  await page.locator("#stop").click();
  await page.unroute("**/assets/piano/C4.mp3");
  await page.route("**/assets/piano/C4.mp3", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.locator("#lesson-start").click();
  await expect(page.locator("#audio-status")).toHaveText("加载失败");
  await expect(page.locator("#lesson-start")).toBeEnabled();
  await page.unroute("**/assets/piano/C4.mp3");
  await page.locator("#lesson-start").click();
  await expect(page.locator("#lesson-target")).toHaveText("▼ 请弹 E4");
});

test("窄屏曲库不溢出，练习高亮与结果区域可用", async ({ page }) => {
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
