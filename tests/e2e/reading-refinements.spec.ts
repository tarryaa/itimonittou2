import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizeDataset } from "../../src/dataset";
import { effectiveStars } from "../../src/filters";
import type { Dataset } from "../../src/model";

const dataset = JSON.parse(readFileSync(new URL("../../public/data/original.json", import.meta.url), "utf8")) as Dataset;
const questions = normalizeDataset(dataset);
const firstId = questions[0].id;
const first = (page: Page) => page.locator(`[data-qid="${firstId}"]`);
async function settled(page: Page) {
  await expect(page.locator(".questions")).toHaveAttribute("data-restoring", "false");
}
async function start(page: Page) {
  await page.goto("/");
  await expect(first(page)).toBeAttached();
  await settled(page);
}
async function applyStars(page: Page, value: string) {
  await page.getByRole("button", { name: /^絞り込み/ }).click();
  const dialog = page.getByRole("dialog", { name: "問題を絞り込む" });
  await dialog.getByLabel("重要度", { exact: true }).selectOption(value);
  await dialog.getByRole("button", { name: "この条件で表示" }).click();
  await settled(page);
}

test("minimum importance includes both two and three stars and persists after restart", async ({ page }) => {
  await start(page);
  const minimum = questions.filter((q) => (effectiveStars(q, questions) ?? -1) >= 2);
  const exact = questions.filter((q) => effectiveStars(q, questions) === 2);
  expect(minimum.length).toBeGreaterThan(exact.length);
  await applyStars(page, "2+");
  await expect(page.locator(".questions")).toHaveAttribute("data-question-count", String(minimum.length));
  const eligible = new Set(minimum.map((q) => q.id));
  for (const id of await page.locator("[data-qid]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.qid!))) {
    expect(eligible.has(id)).toBe(true);
  }
  await page.reload();
  await expect(page.locator(".questions")).toHaveAttribute("data-question-count", String(minimum.length));
  await settled(page);
  await page.getByRole("button", { name: /^絞り込み/ }).click();
  const dialog = page.getByRole("dialog", { name: "問題を絞り込む" });
  await expect(dialog.getByLabel("重要度", { exact: true })).toHaveValue("2+");
  await dialog.getByLabel("重要度", { exact: true }).selectOption("2");
  await dialog.getByRole("button", { name: "この条件で表示" }).click();
  await expect(page.locator(".questions")).toHaveAttribute("data-question-count", String(exact.length));
  await settled(page);
  const anchor = page.locator("[data-qid]").filter({ visible: true }).first();
  const id = await anchor.getAttribute("data-qid");
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await applyStars(page, "2+");
  await expect(page.locator(`[data-qid="${id}"]`)).toBeAttached();
  const after = await page.locator(`[data-qid="${id}"]`).evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(5);
});

test("every theme uses an edge-to-edge reading surface with comfortable text gutters", async ({ page }) => {
  await start(page);
  for (const [theme, label] of [["classic", "栞（オリジナル）"], ["aqua-light", "アクア・ライト"], ["aqua-dark", "アクア・ダーク"]]) {
    await page.getByRole("button", { name: "設定とデータ管理" }).click();
    const dialog = page.getByRole("dialog", { name: "設定・データ管理" });
    await dialog.getByRole("radio", { name: label, exact: true }).click();
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
    await settled(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [320, 390, 430, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await settled(page);
      await expect.poll(() => first(page).evaluate((el) => Math.abs(el.getBoundingClientRect().width - Math.min(innerWidth, 740)))).toBeLessThan(1);
      const metrics = await first(page).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const text = el.querySelector(".question-text")!.getBoundingClientRect();
        return { left: rect.left, right: rect.right, inset: text.left - rect.left, radius: getComputedStyle(el).borderRadius, color: getComputedStyle(el).backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(metrics.left).toBeCloseTo(Math.max(0, (width - 740) / 2), 0);
      expect(metrics.right).toBeCloseTo(width - Math.max(0, (width - 740) / 2), 0);
      expect(metrics.inset).toBeGreaterThanOrEqual(16);
      expect(metrics.radius).toBe("0px");
      expect(metrics.overflow).toBe(false);
      if (theme !== "aqua-dark") expect(metrics.color).toBe("rgb(255, 255, 255)");
    }
    expect(await page.locator("[data-qid]").count()).toBeLessThanOrEqual(40);
  }
});

test("long edited inline answers wrap without moving the question when toggled", async ({ page }) => {
  await start(page);
  await first(page).getByRole("button", { name: "問題の編集とタグ" }).click();
  await page.getByRole("button", { name: "問題文・赤字・空欄・解答を編集" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "問題 1 を編集", exact: true })).toBeVisible();
  const text = "非常に長い解答でも文章の中で読みやすく表示されます。".repeat(8);
  await editor.getByRole("textbox", { name: "解答（原書の解答表記）", exact: true }).fill(text);
  await editor.getByRole("textbox", { name: "空欄に入る文字", exact: true }).fill(text);
  await editor.getByRole("button", { name: "変更を保存" }).click();
  await settled(page);
  const blank = first(page).locator(".blank").first();
  await blank.scrollIntoViewIfNeeded();
  const before = await blank.boundingBox();
  const questionHeight = await first(page).evaluate((el) => el.getBoundingClientRect().height);
  await blank.click();
  await expect(blank).toHaveAttribute("aria-expanded", "true");
  await expect(blank.locator(".blank-reserve")).toHaveCSS("opacity", "1");
  await expect(blank.locator(".blank-reserve")).toHaveText(text);
  const after = await blank.boundingBox();
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
  expect(Math.abs((await first(page).evaluate((el) => el.getBoundingClientRect().height)) - questionHeight)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  // Reverse a reveal immediately; neither delayed animations nor characters may remain visible.
  await blank.click();
  await blank.click();
  await blank.click();
  await expect(blank).toHaveAttribute("aria-expanded", "false");
  await expect(blank.locator(".blank-reserve")).toHaveCSS("opacity", "0");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await blank.click();
  await expect(blank.locator(".blank-reserve")).toHaveCSS("opacity", "1");
  expect(await blank.evaluate((el) => el.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"))).toBe(false);
  await first(page).getByRole("button", { name: "問題の編集とタグ" }).click();
  await page.getByRole("button", { name: "問題文・赤字・空欄・解答を編集" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "空欄に入る文字", exact: true }).fill("   ");
  await page.getByRole("dialog").getByRole("button", { name: "変更を保存" }).click();
  await settled(page);
  if (await blank.getAttribute("aria-expanded") !== "true") await blank.click();
  await expect(blank.locator(".blank-reserve")).toHaveText(text);
  await expect(blank.locator(".blank-reserve")).toHaveCSS("opacity", "1");
});
