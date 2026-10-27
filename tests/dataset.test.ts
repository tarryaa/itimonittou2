import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeDataset,
  parseDataset,
  validateDataset,
} from "../src/dataset";
import type { Dataset } from "../src/model";
const raw = JSON.parse(
  readFileSync(
    new URL("../public/data/original.json", import.meta.url),
    "utf8",
  ),
) as Dataset;

describe("lossless source dataset", () => {
  it("validates every source blank/answer pair and retains every record unchanged", () => {
    expect(parseDataset(raw)).toBe(raw);
    const check = validateDataset(raw);
    expect(check.errors).toEqual([]);
    expect(check.stats).toMatchObject({
      pages: 144,
      questions: 1496,
      mainQuestions: 896,
      subquestions: 600,
      answers: 2092,
      blanks: 2092,
      tables: 25,
      notes: 422,
      reviewIssues: 158,
      missingPages: 2,
    });
    const normalized = normalizeDataset(raw);
    expect(normalized).toHaveLength(raw.questions.length);
    for (const item of normalized) {
      expect(item.source).toBe(raw.questions.find((q) => q.id === item.id));
      expect(item.answers.every((a) => a.question_id === item.id)).toBe(true);
      expect(
        item.source.segments
          .filter((s) => s.type === "blank")
          .every((s) =>
            item.answers.some(
              (a) => a.id === s.answer_id && a.blank_id === s.id,
            ),
          ),
      ).toBe(true);
    }
  });
  it("keeps child questions after their own parent, including page continuations and appended records", () => {
    const normalized = normalizeDataset(raw);
    const ids = normalized.map((q) => q.id);
    expect(ids.indexOf("jp-kana-001-p014-c01-q11-s01")).toBe(
      ids.indexOf("jp-kana-001-p014-c01-q11") + 1,
    );
    expect(ids.indexOf("jp-kana-001-p100-c31-q01-s01")).toBe(
      ids.indexOf("jp-kana-001-p100-c31-q01") + 1,
    );
    expect(ids.indexOf("jp-kana-001-p013-q05-s02")).toBe(
      ids.indexOf("jp-kana-001-p012-q05-s01") + 1,
    );
    expect(
      normalized.every(
        (q, i) => i === 0 || normalized[i - 1].pageNumber <= q.pageNumber,
      ),
    ).toBe(true);
  });
  it("labels each question by chapter number, including a page crossing chapters", () => {
    const normalized = normalizeDataset(raw);
    expect(
      normalized.find((q) => q.id === "jp-kana-001-p014-c01-q10")?.chapter,
    ).toBe("日本文化のあけぼの");
    expect(
      normalized.find((q) => q.id === "jp-kana-001-p014-c02-q01")?.chapter,
    ).toBe("縄文文化の成立");
  });
  it("reports source omissions and draft status without silently correcting source", () => {
    const { warnings } = validateDataset(raw);
    expect(warnings.some((s) => s.includes("98・99"))).toBe(true);
    expect(warnings.some((s) => s.includes("33・45・125"))).toBe(true);
    expect(warnings.some((s) => s.includes("本番利用不可"))).toBe(true);
    expect(raw.ready_for_production).toBe(false);
  });
  it("rejects duplicate IDs, cross-question answer links, orphan answers and broken page references", () => {
    const duplicate = structuredClone(raw);
    duplicate.questions.push(duplicate.questions[0]);
    expect(() => parseDataset(duplicate)).toThrow(/重複/);
    const wrong = structuredClone(raw);
    wrong.questions[0].segments.find((s) => s.type === "blank")!.answer_id =
      wrong.answers[1].id;
    expect(() => parseDataset(wrong)).toThrow(/対応/);
    const orphan = structuredClone(raw);
    orphan.answers[0].blank_id = "unknown";
    expect(() => parseDataset(orphan)).toThrow(/参照|対応/);
    const page = structuredClone(raw);
    page.questions[0].page_id = "unknown";
    expect(() => parseDataset(page)).toThrow(/ページ/);
  });
  it("rejects malformed JSON before normalization and supports unknown metadata losslessly", () => {
    expect(() =>
      parseDataset({
        dataset_id: "test",
        schema_version: "1",
        pages: [],
        questions: [],
        answers: [],
      }),
    ).toThrow(/空/);
    const invalid = structuredClone(raw);
    (invalid.questions[0] as unknown as Record<string, unknown>).segments =
      null;
    expect(() => parseDataset(invalid)).toThrow(/構造/);
    const extra = structuredClone(raw);
    extra.future_metadata = { note: "preserved" };
    expect(parseDataset(extra).future_metadata).toEqual({ note: "preserved" });
  });
});

describe("diagram ownership and import robustness", () => {
  it("attaches diagrams to the question identified by exact blank/answer IDs", () => {
    const normalized = normalizeDataset(raw);
    for (const number of [37, 55]) {
      const table = raw.tables!.find((t) => t.page_id.endsWith(`p0${number}`))!;
      const owner = normalized.find((q) =>
        q.tables.some((t) => t.id === table.id),
      )!;
      expect(owner.pageNumber).toBe(number);
      expect(owner.source.kind).toBe("subquestion");
    }
  });
  it("rejects malformed table rows and page-extra segments before rendering", () => {
    const bad = structuredClone(raw);
    (bad.tables![0] as any).rows = ["bad"];
    expect(() => parseDataset(bad)).toThrow(/図表/);
    const extra = structuredClone(raw);
    (extra.page_extras![0] as any).segments = "bad";
    expect(() => parseDataset(extra)).toThrow(/ページ補足/);
  });
});
