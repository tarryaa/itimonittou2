import { describe, expect, it } from "vitest";
import type { StudyQuestion } from "../src/model";
import {
  defaultFilters,
  effectiveStars,
  filterQuestions,
  japanDay,
  previousSessionId,
} from "../src/filters";
import { emptyState, type UserState } from "../src/store";

const question = (id: string, era = "古代", stars = 1): StudyQuestion => ({
  id,
  pageId: "p1",
  pageNumber: 12,
  era,
  chapter: "第1章",
  section: "節A",
  order: Number(id.slice(1)),
  source: {
    id,
    page_id: "p1",
    printed_number: id,
    kind: "question",
    chapter_number: 1,
    importance_stars: stars,
    segments: [{ id: `${id}-t`, type: "text", text: `問題${id}` }],
    notes: [],
    answer_ids: [],
  },
  answers: [],
  tables: [],
  extras: [],
});
const questions = [question("q1"), question("q2", "中世", 3), question("q3")];
function state(): UserState {
  return {
    ...emptyState(),
    sessions: [
      {
        id: "old",
        startedAt: "2026-10-20T00:00:00Z",
        endedAt: "2026-10-20T01:00:00Z",
        viewed: [],
      },
      { id: "new", startedAt: "2026-10-27T00:00:00Z", viewed: [] },
    ],
    mistakes: [
      {
        id: "m1",
        questionId: "q1",
        at: "2026-10-26T15:01:00Z",
        sessionId: "new",
      },
      {
        id: "m2",
        questionId: "q1",
        at: "2026-10-20T02:00:00Z",
        sessionId: "old",
      },
      {
        id: "m3",
        questionId: "q2",
        at: "2026-09-01T00:00:00Z",
        sessionId: "old",
      },
    ],
  };
}
const now = new Date("2026-10-27T12:00:00Z");
const ids = (s: UserState) =>
  filterQuestions(questions, s, now).map((q) => q.id);

describe("combined study filters", () => {
  it.each<[string, string[]]>([
    ["1+", ["q1", "q2", "q3"]],
    ["2+", ["q2", "q3"]],
    ["2", ["q2"]],
    ["3", ["q3"]],
    ["0", ["q0"]],
  ])(
    "supports importance %s without changing exact saved filters",
    (stars, expected) => {
      const material = [0, 1, 2, 3].map((n) => question(`q${n}`, "古代", n));
      const unknown = question("q4");
      unknown.source.importance_stars = null;
      const s = emptyState();
      s.filters.stars = stars;
      expect(
        filterQuestions([...material, unknown], s, now).map((q) => q.id),
      ).toEqual(expected);
    },
  );
  it("combines minimum importance with era, tags and mistake history", () => {
    const material = [
      question("q1", "古代", 2),
      question("q2", "中世", 3),
      question("q3", "古代", 3),
    ];
    const s = state();
    s.tags = { q1: ["復習"], q2: ["復習"], q3: ["復習"] };
    s.filters = {
      ...defaultFilters,
      stars: "2+",
      era: "古代",
      tag: "復習",
      minMistakes: 1,
      period: "today",
    };
    expect(filterQuestions(material, s, now).map((q) => q.id)).toEqual(["q1"]);
  });
  it("uses edited and inherited parent importance for minimum thresholds", () => {
    const parent = question("q1", "古代", 1);
    const branch = question("q2");
    branch.source.kind = "subquestion";
    branch.source.parent_id = parent.id;
    branch.source.importance_stars = null;
    const s = emptyState();
    s.filters.stars = "2+";
    expect(filterQuestions([parent, branch], s, now)).toEqual([]);
    s.edits[parent.id] = {
      question: { ...parent.source, importance_stars: 3 },
      answers: [],
    };
    expect(filterQuestions([parent, branch], s, now).map((q) => q.id)).toEqual([
      "q1", "q2",
    ]);
    s.edits[branch.id] = {
      question: { ...branch.source, importance_stars: 1 },
      answers: [],
    };
    expect(filterQuestions([parent, branch], s, now).map((q) => q.id)).toEqual([
      "q1",
    ]);
    expect(parent.source.importance_stars).toBe(1);
    expect(branch.source.importance_stars).toBeNull();
  });
  it("combines era, stars, and total mistake count", () => {
    const s = state();
    s.filters = { ...defaultFilters, era: "古代", stars: "1", minMistakes: 2 };
    expect(ids(s)).toEqual(["q1"]);
  });
  it("uses midnight in Japan rather than UTC for today", () => {
    expect(japanDay("2026-10-26T15:01:00Z")).toBe("2026-10-27");
    const s = state();
    s.filters.period = "today";
    expect(ids(s)).toEqual(["q1"]);
  });
  it("includes today and preceding six Japanese calendar days for 7 days", () => {
    const s = state();
    s.filters.period = "7";
    s.mistakes.push({
      id: "boundary",
      questionId: "q3",
      at: "2026-10-20T15:00:00Z",
      sessionId: "old",
    });
    expect(ids(s)).toEqual(["q1", "q3"]);
    s.mistakes.at(-1)!.at = "2026-10-20T14:59:59Z";
    expect(ids(s)).toEqual(["q1"]);
  });
  it("previous session refers to the session before the current one", () => {
    const s = state();
    expect(previousSessionId(s)).toBe("old");
    s.filters.period = "previous";
    expect(ids(s)).toEqual(["q1", "q2"]);
  });
  it("flags bypass only mistake criteria when include is chosen", () => {
    const s = state();
    s.flags = { q2: true, q3: true };
    s.filters = {
      ...defaultFilters,
      era: "古代",
      minMistakes: 50,
      period: "today",
      flagMode: "include",
    };
    expect(ids(s)).toEqual(["q3"]);
  });
  it("flag only still combines with mistake constraints", () => {
    const s = state();
    s.flags = { q1: true, q3: true };
    s.filters = { ...defaultFilters, minMistakes: 1, flagMode: "only" };
    expect(ids(s)).toEqual(["q1"]);
  });
  it("matches future tags and does not reorder the source", () => {
    const s = state();
    s.tags = { q1: ["要復習"], q3: ["要復習"] };
    s.filters.tag = "要復習";
    expect(ids(s)).toEqual(["q1", "q3"]);
  });
  it("uses edited question text when searching", () => {
    const s = state();
    s.edits.q1 = {
      question: {
        ...questions[0].source,
        segments: [{ id: "edited", type: "text", text: "新しい内容" }],
      },
      answers: [],
    };
    s.filters.query = "新しい内容";
    expect(ids(s)).toEqual(["q1"]);
  });
  it("inherits parent importance for a branch without changing the original null", () => {
    const branch = question("q4");
    branch.source.kind = "subquestion";
    branch.source.parent_id = "q2";
    branch.source.importance_stars = null;
    const s = state();
    s.filters.stars = "3";
    expect(
      filterQuestions([...questions, branch], s, now).map((q) => q.id),
    ).toEqual(["q2", "q4"]);
    expect(effectiveStars(branch, questions)).toBe(3);
    expect(branch.source.importance_stars).toBeNull();
  });
  it("all period excludes questions never answered incorrectly", () => {
    const s = state();
    s.filters.period = "all";
    expect(ids(s)).toEqual(["q1", "q2"]);
  });
});

it("retains source tags and user tags together when filtering imported material", () => {
  const tagged = structuredClone(questions);
  tagged[0].source.tags = ["教材タグ"];
  const s = state();
  s.tags.q1 = ["自分のタグ"];
  s.filters.tag = "教材タグ";
  expect(filterQuestions(tagged, s, now).map((q) => q.id)).toEqual(["q1"]);
  s.filters.tag = "自分のタグ";
  expect(filterQuestions(tagged, s, now).map((q) => q.id)).toEqual(["q1"]);
});
