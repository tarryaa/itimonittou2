import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:4174";
const appUrl = `${origin}/itimonittou/`;

test("production subpath, offline restart and consented cache update preserve learning data", async ({
  page,
  context,
  request,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Service Worker lifecycle is exercised in Chromium; real iPhone remains a separate verification.",
  );
  test.setTimeout(90000);
  await request.post(`${origin}/__test__/revision?value=0`);
  const missing: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400)
      missing.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(appUrl);
  const first = page.locator("article[data-qid]").first();
  await expect(first).toBeVisible();
  await expect(first).toContainText("人類の祖先");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    )!;
    const manifest = await (await fetch(link.href)).json();
    return {
      href: link.href,
      start: new URL(manifest.start_url, link.href).pathname,
      scope: new URL(manifest.scope, link.href).pathname,
      display: manifest.display,
    };
  });
  expect(manifest.href).toBe(`${appUrl}manifest.webmanifest`);
  expect(manifest.start).toBe("/itimonittou/");
  expect(manifest.scope).toBe("/itimonittou/");
  expect(manifest.display).toBe("standalone");
  expect(
    await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(
        names.find((name) => name.includes("/itimonittou/"))!,
      );
      const keys = await cache.keys();
      return keys.map((key) => new URL(key.url).pathname);
    }),
  ).toEqual(
    expect.arrayContaining([
      "/itimonittou/index.html",
      "/itimonittou/data/original.json",
      "/itimonittou/manifest.webmanifest",
    ]),
  );

  await first
    .getByRole("button", { name: "間違いを1回記録", exact: true })
    .click();
  await expect(
    first.getByRole("button", { name: "間違い履歴を開く", exact: true }),
  ).toHaveText("1");
  // Reload flushes the persisted app state before offline startup.
  await page.reload();
  await expect(
    first.getByRole("button", { name: "間違い履歴を開く", exact: true }),
  ).toHaveText("1");
  await context.setOffline(true);
  await page.reload();
  await expect(first).toContainText("人類の祖先");
  await expect(
    first.getByRole("button", { name: "間違い履歴を開く", exact: true }),
  ).toHaveText("1");
  await context.setOffline(false);

  const before = await page.evaluate(() => caches.keys());
  await request.post(`${origin}/__test__/revision?value=1`);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect(
    page.getByRole("button", { name: "保存して更新", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  // Downloading a newer worker must leave the current worker and its cache available.
  expect(
    await page.evaluate(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toEqual(
    expect.arrayContaining(before),
  );
  await expect(
    first.getByRole("button", { name: "間違い履歴を開く", exact: true }),
  ).toHaveText("1");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByRole("button", { name: "保存して更新", exact: true }).click(),
  ]);
  expect(new URL(page.url()).pathname).toBe("/itimonittou/");
  await expect(
    first.getByRole("button", { name: "間違い履歴を開く", exact: true }),
  ).toHaveText("1");
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .not.toEqual(expect.arrayContaining(before));
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toEqual([expect.stringContaining("-test1")]);
  await context.setOffline(true);
  await page.reload();
  await expect(
    first.getByRole("button", { name: "間違い履歴を開く", exact: true }),
  ).toHaveText("1");
  expect(missing).toEqual([]);
});
