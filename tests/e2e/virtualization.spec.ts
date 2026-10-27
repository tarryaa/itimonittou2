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
const card = (page: Page, id: string) => page.locator(`[data-qid="${id}"]`);
async function settled(page: Page) {
  await expect(page.locator(".questions")).toHaveAttribute(
    "data-restoring",
    "false",
  );
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
async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator(".questions")).toHaveAttribute(
    "data-question-count",
    "1496",
  );
  await expect(card(page, questions[0].id)).toBeAttached();
  await settled(page);
}
async function bounded(page: Page) {
  expect(await page.locator("[data-qid]").count()).toBeLessThanOrEqual(40);
  expect(await page.locator("body *").count()).toBeLessThan(6000);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
}

test("the final source question remains reachable while only a small window is mounted", async ({
  page,
}) => {
  await start(page);
  await bounded(page);
  const last = questions.at(-1)!;
  expect(last.pageNumber).toBe(157);
  await navigate(page, last.id);
  await expect(card(page, last.id)).toBeInViewport();
  await bounded(page);
  await expect(page.locator(".study-status")).toContainText("1,496 / 1,496");
  await navigate(page, questions[0].id);
  await expect(card(page, questions[0].id)).toBeInViewport();
  await bounded(page);
});

test("bulk answer mode applies to newly mounted rows across the book", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "すべて表示", exact: true }).click();
  const lastWithBlanks = [...questions]
    .reverse()
    .find((q) => q.source.segments.some((s) => s.type === "blank"))!;
  await navigate(page, lastWithBlanks.id);
  const blanks = card(page, lastWithBlanks.id).locator(".blank");
  await expect(blanks.first()).toHaveClass(/bulk-visible/);
  await expect(blanks.first()).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "すべて隠す", exact: true }).click();
  await expect(blanks.first()).not.toHaveClass(/bulk-visible/);
  await navigate(page, questions[0].id);
  await expect(
    card(page, questions[0].id).locator(".blank").first(),
  ).not.toHaveClass(/bulk-visible/);
  await bounded(page);
});

test("a later chapter restores its question anchor and screen offset after immediate restart", async ({
  page,
}) => {
  await start(page);
  const target = questions.find(
    (q) => q.pageNumber === 100 && q.source.kind === "question",
  )!;
  await navigate(page, target.id);
  await page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-qid="${id}"]`)!;
    window.scrollBy(0, el.getBoundingClientRect().top - 160);
  }, target.id);
  const before = await card(page, target.id).evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  await page.reload();
  await expect(card(page, target.id)).toBeAttached();
  await settled(page);
  await expect
    .poll(async () =>
      Math.abs(
        (await card(page, target.id).evaluate(
          (el) => el.getBoundingClientRect().top,
        )) - before,
      ),
    )
    .toBeLessThan(5);
  await bounded(page);
});

test("standalone supplemental pages remain in continuous reading order", async ({
  page,
}) => {
  await start(page);
  for (const pageNumber of [33, 45]) {
    const preceding = questions
      .filter((q) => q.pageNumber < pageNumber)
      .at(-1)!;
    await navigate(page, preceding.id);
    const extra = page.locator(".empty-page").filter({
      has: page.getByRole("heading", {
        name: new RegExp(`p\\.${pageNumber} `),
      }),
    });
    await expect(extra).toBeAttached();
    await expect(extra).toContainText("学習のヒント");
    await bounded(page);
  }
});

test("a deep question keeps its anchor when the viewport width changes and returns", async ({
  page,
}) => {
  await start(page);
  const target = questions.find(
    (q) => q.pageNumber === 100 && q.source.kind === "question",
  )!;
  await navigate(page, target.id);
  await page.evaluate((id) => {
    const question = document.querySelector<HTMLElement>(`[data-qid="${id}"]`)!;
    scrollBy(0, question.getBoundingClientRect().top - 160);
  }, target.id);
  const before = await card(page, target.id).evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  for (const width of [740, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    await settled(page);
    await expect(card(page, target.id)).toBeInViewport();
    await expect
      .poll(async () =>
        Math.abs(
          (await card(page, target.id).evaluate(
            (el) => el.getBoundingClientRect().top,
          )) - before,
        ),
      )
      .toBeLessThan(80);
    await bounded(page);
  }
});

test("restart restores a position far inside a long edited question", async ({
  page,
}) => {
  await start(page);
  const target = questions.find(
    (q) =>
      q.pageNumber === 100 &&
      q.source.kind === "question" &&
      q.source.segments[0]?.type === "text",
  )!;
  await navigate(page, target.id);
  await card(page, target.id)
    .getByRole("button", { name: "問題の編集とタグ" })
    .click();
  await page
    .getByRole("button", { name: "問題文・赤字・空欄・解答を編集" })
    .click();
  const editor = page.getByRole("dialog", {
    name: `問題 ${target.source.printed_number} を編集`,
  });
  const longText = Array.from(
    { length: 100 },
    (_, i) =>
      `長文復元テスト ${i + 1} 行目。日本史の内容を読み進めた位置を維持する。`,
  ).join("\n");
  await editor.locator("textarea").first().fill(longText);
  await editor.getByRole("button", { name: "変更を保存" }).click();
  await expect(card(page, target.id)).toContainText("長文復元テスト 100 行目");
  await expect
    .poll(() =>
      card(page, target.id).evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeGreaterThan(2000);
  await page.evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await settled(page);
  await page.evaluate((id) => {
    const question = document.querySelector<HTMLElement>(`[data-qid="${id}"]`)!;
    scrollBy(0, question.getBoundingClientRect().top + 1000);
  }, target.id);
  const before = await card(page, target.id).evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  expect(before).toBeLessThan(-900);
  await page.reload();
  await expect(card(page, target.id)).toBeAttached();
  await settled(page);
  await expect(card(page, target.id)).toContainText("長文復元テスト 100 行目");
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
});
