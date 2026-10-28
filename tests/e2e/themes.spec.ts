import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeDataset } from "../../src/dataset";
import type { Dataset } from "../../src/model";

const source = JSON.parse(
  readFileSync(
    new URL("../../public/data/original.json", import.meta.url),
    "utf8",
  ),
) as Dataset;
const questions = normalizeDataset(source);
const firstId = questions[0].id;
const card = (page: Page, id = firstId) => page.locator(`[data-qid="${id}"]`);
async function settled(page: Page) {
  await expect(page.locator(".questions")).toHaveAttribute(
    "data-restoring",
    "false",
  );
}
async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
  await expect(page.locator(".questions")).toHaveAttribute(
    "data-question-count",
    "1496",
  );
  await expect(card(page)).toBeAttached();
  await settled(page);
}
async function settings(page: Page) {
  await page.getByRole("button", { name: "設定とデータ管理" }).click();
  return page.getByRole("dialog", { name: "設定・データ管理" });
}
async function close(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await settled(page);
}
async function navigate(page: Page, id: string) {
  const question = questions.find((q) => q.id === id)!;
  const firstInChapter = questions.find((q) => q.chapter === question.chapter)!;
  await page.locator(".brand").click();
  const contents = page.getByRole("dialog", { name: "時代・章から探す" });
  await contents
    .locator(".contents-row")
    .filter({ hasText: question.chapter })
    .first()
    .click();
  await expect(contents).toHaveCount(0);
  await expect(card(page, firstInChapter.id)).toBeAttached();
  await settled(page);
  for (let step = 0; step < 45; step++) {
    if (await card(page, id).count()) {
      await card(page, id).scrollIntoViewIfNeeded();
      await settled(page);
      return;
    }
    await page.evaluate(async () => {
      scrollBy(0, 450);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
  }
  await expect(card(page, id)).toBeAttached();
}
async function colors(page: Page) {
  return page.evaluate(() => {
    const body = getComputedStyle(document.body).backgroundColor;
    const root = getComputedStyle(document.documentElement).backgroundColor;
    const bodyParts = body.match(/[\d.]+/g)?.map(Number) ?? [];
    return {
      background: body === "transparent" || bodyParts[3] === 0 ? root : body,
      text: getComputedStyle(document.querySelector(".question-text")!).color,
    };
  });
}
function brightness(color: string) {
  const parts = color.match(/[\d.]+/g)!.map(Number);
  return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
}
async function bounded(page: Page) {
  expect(await page.locator("[data-qid]").count()).toBeLessThanOrEqual(40);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
}

test("the original remains the default and both aqua themes change actual colors without overflow", async ({
  page,
}) => {
  await start(page);
  const original = await colors(page);
  expect(original.background).toBe("rgb(247, 248, 244)");
  expect(original.text).toBe("rgb(39, 58, 53)");
  const modal = await settings(page);
  const choices = modal.getByRole("radiogroup", { name: "表示テーマ" });
  await expect(choices.getByRole("radio")).toHaveCount(3);
  await expect(
    choices.getByRole("radio", { name: "栞（オリジナル）", exact: true }),
  ).toBeChecked();
  await choices
    .getByRole("radio", { name: "アクア・ダーク", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aqua-dark");
  await expect(
    choices.getByRole("radio", { name: "アクア・ダーク", exact: true }),
  ).toBeChecked();
  const dark = await colors(page);
  expect(brightness(dark.background)).toBeLessThan(100);
  expect(brightness(dark.text)).toBeGreaterThan(150);
  await bounded(page);
  await choices
    .getByRole("radio", { name: "アクア・ライト", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "aqua-light",
  );
  await expect(
    choices.getByRole("radio", { name: "アクア・ライト", exact: true }),
  ).toBeChecked();
  const light = await colors(page);
  expect(brightness(light.background)).toBeGreaterThan(180);
  expect(brightness(light.text)).toBeLessThan(150);
  expect(light).not.toEqual(dark);
  await bounded(page);
  await choices
    .getByRole("radio", { name: "栞（オリジナル）", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
  expect(await colors(page)).toEqual(original);
  await bounded(page);
});

test("theme, font setting, mistake history and the deep reading anchor survive restart together", async ({
  page,
}) => {
  await start(page);
  const target = questions.find(
    (q) => q.pageNumber === 100 && q.source.kind === "question",
  )!;
  await navigate(page, target.id);
  await card(page, target.id)
    .getByRole("button", { name: "間違いを1回記録", exact: true })
    .click();
  await expect(
    card(page, target.id).getByRole("button", { name: "間違い履歴を開く" }),
  ).toHaveText("1");
  const modal = await settings(page);
  await modal
    .getByRole("radio", { name: "アクア・ダーク", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aqua-dark");
  const slider = modal.getByRole("slider");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("18");
  await expect(
    modal.getByRole("radio", { name: "アクア・ダーク", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aqua-dark");
  await close(page);
  await expect(card(page, target.id)).toBeInViewport();
  await page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`[data-qid="${id}"]`)!;
    scrollBy(0, element.getBoundingClientRect().top - 160);
  }, target.id);
  const before = await card(page, target.id).evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aqua-dark");
  await expect(card(page, target.id)).toBeAttached();
  await settled(page);
  await expect(
    card(page, target.id).getByRole("button", { name: "間違い履歴を開く" }),
  ).toHaveText("1");
  await expect
    .poll(async () =>
      Math.abs(
        (await card(page, target.id).evaluate(
          (el) => el.getBoundingClientRect().top,
        )) - before,
      ),
    )
    .toBeLessThan(8);
  await bounded(page);
  const reopened = await settings(page);
  await expect(
    reopened.getByRole("radio", { name: "アクア・ダーク", exact: true }),
  ).toBeChecked();
  await expect(reopened.getByRole("slider")).toHaveValue("18");
});

test("full JSON backups include the selected theme alongside learning records", async ({
  page,
}) => {
  await start(page);
  await card(page)
    .getByRole("button", { name: "間違いを1回記録", exact: true })
    .click();
  const modal = await settings(page);
  await modal
    .getByRole("radio", { name: "アクア・ライト", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await modal.getByRole("button", { name: "全データをJSONで保存" }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  let body = "";
  for await (const chunk of stream!) body += chunk.toString();
  const backup = JSON.parse(body);
  expect(backup.state.settings.theme).toBe("aqua-light");
  expect(backup.state.settings.fontSize).toBe(17);
  expect(backup.state.mistakes).toHaveLength(1);
  expect(backup.dataset.questions).toHaveLength(1496);
  await bounded(page);
});
