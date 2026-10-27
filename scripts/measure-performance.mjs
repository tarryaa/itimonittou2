/** Repeatable CPU/render benchmark. No user data or network services are used. */
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const arg = (key, fallback) => {
  const i = args.indexOf(key);
  return i === -1 ? fallback : args[i + 1];
};
const root = path.resolve(arg("--dist", "dist"));
const output = arg("--output", "");
const throttle = Number(arg("--cpu", "4"));
const repeats = Math.max(1, Math.floor(Number(arg("--runs", "1"))));
if (repeats > 1) {
  const execute = promisify(execFile);
  const samples = [];
  for (let i = 0; i < repeats; i++) {
    const { stdout } = await execute(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        "--dist",
        root,
        "--cpu",
        String(throttle),
      ],
      { maxBuffer: 1024 * 1024 },
    );
    samples.push(JSON.parse(stdout));
    process.stderr.write(`Performance sample ${i + 1}/${repeats} complete\n`);
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
  };
  const action = (name) =>
    median(
      samples.map((s) => s.actions.find((a) => a.label === name).elapsedMs),
    );
  const result = {
    measuredAt: new Date().toISOString(),
    repeatCount: repeats,
    configuration: samples[0].configuration,
    summary: {
      initialReadyMedianMs: median(samples.map((s) => s.initial.wallToReadyMs)),
      domElementsMedian: median(samples.map((s) => s.initial.nodes)),
      mountedQuestionsMedian: median(
        samples.map((s) => s.initial.mountedQuestions),
      ),
      bulkShowMedianMs: action("bulk show"),
      bulkHideMedianMs: action("bulk hide"),
      addMistakeMedianMs: action("add mistake"),
      scrollP95GapMedianMs: median(samples.map((s) => s.scroll.p95FrameGapMs)),
      scrollGapsOver50msMedian: median(
        samples.map((s) => s.scroll.gapsOver50ms),
      ),
      heapUsedMedianBytes: median(
        samples.map((s) => s.initial.heap?.used ?? 0),
      ),
    },
    samples,
  };
  const json = JSON.stringify(result, null, 2) + "\n";
  if (output) await writeFile(output, json);
  process.stdout.write(json);
  process.exit(0);
}
const prefix = "/itimonittou/";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (!u.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const target = path.resolve(
      root,
      decodeURIComponent(u.pathname.slice(prefix.length)) || "index.html",
    );
    if (!target.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(target);
    res
      .writeHead(200, {
        "content-type":
          mime[path.extname(target)] || "application/octet-stream",
        "cache-control": "no-store",
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
  serviceWorkers: "block",
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
await cdp.send("Performance.enable");
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.addInitScript(() => {
  window.__performanceLongTasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      window.__performanceLongTasks.push({
        start: e.startTime,
        duration: e.duration,
      });
  }).observe({ type: "longtask", buffered: true });
});
const round = (n) => Math.round(n * 10) / 10;
const frames = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
const snapshot = () =>
  page.evaluate(() => ({
    pageTime: performance.now(),
    nodes: document.querySelectorAll("*").length,
    mountedQuestions: document.querySelectorAll("[data-qid]").length,
    bodyScrollHeight: document.documentElement.scrollHeight,
    longTasks: window.__performanceLongTasks.slice(),
    heap: performance.memory
      ? {
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
        }
      : null,
  }));
try {
  const wallStart = performance.now();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-qid]", { timeout: 120000 });
  await frames();
  const initial = await snapshot();
  initial.wallToReadyMs = round(performance.now() - wallStart);
  initial.pageTime = round(initial.pageTime);
  initial.longTaskCount = initial.longTasks.length;
  initial.longTaskTotalMs = round(
    initial.longTasks.reduce((s, t) => s + t.duration, 0),
  );
  initial.maxLongTaskMs = round(
    Math.max(0, ...initial.longTasks.map((t) => t.duration)),
  );
  delete initial.longTasks;
  async function timeAction(label, selector, expectedSelector, expectedText) {
    // Measure inside the page so Playwright's DOM-search overhead is excluded.
    const sample = await page.evaluate(
      async ({ selector, expectedSelector, expectedText }) => {
        const start = performance.now();
        document.querySelector(selector).click();
        while (
          document.querySelector(expectedSelector)?.textContent.trim() !==
          expectedText
        ) {
          if (performance.now() - start > 30000)
            throw Error("Action did not render");
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          start,
          end: performance.now(),
          tasks: window.__performanceLongTasks.filter((t) => t.start >= start),
        };
      },
      { selector, expectedSelector, expectedText },
    );
    return {
      label,
      elapsedMs: round(sample.end - sample.start),
      longTaskCount: sample.tasks.length,
      longTaskTotalMs: round(sample.tasks.reduce((s, t) => s + t.duration, 0)),
      maxLongTaskMs: round(Math.max(0, ...sample.tasks.map((t) => t.duration))),
    };
  }
  const show = await timeAction(
    "bulk show",
    ".bottom-nav > button:nth-child(2)",
    ".bottom-nav > button:nth-child(2)",
    "すべて隠す",
  );
  const hide = await timeAction(
    "bulk hide",
    ".bottom-nav > button:nth-child(2)",
    ".bottom-nav > button:nth-child(2)",
    "すべて表示",
  );
  await page.locator("[data-qid]").first().scrollIntoViewIfNeeded();
  await frames();
  const plus = await timeAction(
    "add mistake",
    "[data-qid] .counter > button:last-child",
    "[data-qid] .count-value",
    "1",
  );
  // One viewport-scale scrolling run: rAF gaps show main-thread interruptions.
  const scroll = await page.evaluate(async () => {
    const gaps = [];
    const start = performance.now();
    let previous = start;
    let maximumMounted = 0;
    while (performance.now() - start < 2500) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      gaps.push(now - previous);
      previous = now;
      window.scrollBy(0, 70);
      maximumMounted = Math.max(
        maximumMounted,
        document.querySelectorAll("[data-qid]").length,
      );
    }
    gaps.sort((a, b) => a - b);
    return {
      durationMs: performance.now() - start,
      frames: gaps.length,
      p95FrameGapMs: gaps[Math.floor(gaps.length * 0.95)],
      maxFrameGapMs: Math.max(...gaps),
      gapsOver50ms: gaps.filter((n) => n > 50).length,
      maximumMountedQuestions: maximumMounted,
      scrollY: window.scrollY,
    };
  });
  const settleStart = await page.evaluate(() => performance.now());
  await page.waitForTimeout(700);
  await frames();
  const final = await snapshot();
  const settleTasks = final.longTasks.filter((t) => t.start >= settleStart);
  const scrollSettle = {
    observationMs: round(final.pageTime - settleStart),
    longTaskCount: settleTasks.length,
    longTaskTotalMs: round(settleTasks.reduce((sum, t) => sum + t.duration, 0)),
    maxLongTaskMs: round(Math.max(0, ...settleTasks.map((t) => t.duration))),
  };
  const result = {
    measuredAt: new Date().toISOString(),
    configuration: {
      browser: "Chromium",
      viewport: { width: 390, height: 844 },
      cpuThrottle: throttle,
      serviceWorkers: "blocked to isolate main-thread work",
      network: "local static server, no throttling",
      actions:
        "synthetic DOM click to rendered confirmation plus two animation frames; automation DOM-search overhead excluded",
      dist: root,
    },
    initial,
    actions: [show, hide, plus],
    scroll: Object.fromEntries(
      Object.entries(scroll).map(([k, v]) => [
        k,
        typeof v === "number" ? round(v) : v,
      ]),
    ),
    scrollSettle,
    final: {
      nodes: final.nodes,
      mountedQuestions: final.mountedQuestions,
      heap: final.heap,
    },
    jsErrors,
  };
  const json = JSON.stringify(result, null, 2) + "\n";
  if (output) await writeFile(output, json);
  process.stdout.write(json);
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
