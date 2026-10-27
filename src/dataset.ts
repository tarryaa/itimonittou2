import type {
  Answer,
  Dataset,
  Page,
  Question,
  Segment,
  StudyQuestion,
} from "./model";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const stars = (v: unknown) =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 3;
const segmentsOf = (q: Question): Segment[] => [
  ...q.segments,
  ...q.notes.flatMap((n) => n.segments),
];

/** Accept a complete source object only after validating shape and all relationships. */
export function parseDataset(input: unknown): Dataset {
  if (!record(input) || !id(input.dataset_id) || !id(input.schema_version))
    throw new Error("教材JSONに dataset_id / schema_version がありません。");
  for (const key of ["pages", "questions", "answers"])
    if (!Array.isArray(input[key]))
      throw new Error(`教材JSONの ${key} は配列である必要があります。`);
  if (
    !(input.pages as unknown[]).length ||
    !(input.questions as unknown[]).length
  )
    throw new Error("ページまたは問題が空です。");
  for (const p of input.pages as unknown[]) {
    if (
      !record(p) ||
      !id(p.id) ||
      !finite(p.page_number) ||
      !Array.isArray(p.question_ids) ||
      !p.question_ids.every(id)
    )
      throw new Error("不正なページレコードです。");
    if (
      p.chapter_candidates !== undefined &&
      (!Array.isArray(p.chapter_candidates) ||
        !p.chapter_candidates.every(
          (c) => record(c) && finite(c.number) && typeof c.title === "string",
        ))
    )
      throw new Error(`${p.id}: 章候補の形式が不正です。`);
  }
  const validSegments = (list: unknown): boolean =>
    Array.isArray(list) &&
    list.every(
      (s) =>
        record(s) &&
        id(s.id) &&
        id(s.type) &&
        (s.text === undefined || typeof s.text === "string") &&
        (s.style === undefined || record(s.style)) &&
        (s.type !== "blank" || id(s.answer_id)) &&
        (s.stars === undefined || stars(s.stars)),
    );
  for (const q of input.questions as unknown[]) {
    if (
      !record(q) ||
      !id(q.id) ||
      !id(q.page_id) ||
      typeof q.printed_number !== "string" ||
      !id(q.kind) ||
      !finite(q.chapter_number) ||
      !(q.importance_stars === null || stars(q.importance_stars)) ||
      !validSegments(q.segments) ||
      !Array.isArray(q.notes) ||
      !q.notes.every(
        (n) => record(n) && id(n.id) && validSegments(n.segments),
      ) ||
      !Array.isArray(q.answer_ids) ||
      !q.answer_ids.every(id)
    )
      throw new Error(
        `問題の構造または★の値が不正です: ${record(q) ? q.id : "不明"}`,
      );
  }
  for (const a of input.answers as unknown[])
    if (
      !record(a) ||
      !id(a.id) ||
      !id(a.question_id) ||
      !id(a.blank_id) ||
      typeof a.text !== "string" ||
      (a.fill_text !== undefined && typeof a.fill_text !== "string")
    )
      throw new Error("不正な解答レコードです。");
  for (const key of ["tables", "page_extras", "review_issues"]) {
    if (
      input[key] !== undefined &&
      (!Array.isArray(input[key]) ||
        !(input[key] as unknown[]).every((x) => record(x) && id(x.id)))
    )
      throw new Error(`${key} の形式が不正です。`);
  }
  for (const t of (input.tables ?? []) as Record<string, unknown>[]) {
    if (
      !id(t.page_id) ||
      (t.columns !== undefined &&
        (!Array.isArray(t.columns) ||
          !t.columns.every((c) => typeof c === "string"))) ||
      (t.rows !== undefined &&
        (!Array.isArray(t.rows) || !t.rows.every(Array.isArray))) ||
      (t.cells !== undefined && !Array.isArray(t.cells) && !record(t.cells)) ||
      (t.items !== undefined && !Array.isArray(t.items)) ||
      (t.labels !== undefined &&
        (!Array.isArray(t.labels) ||
          !t.labels.every((c) => typeof c === "string")))
    )
      throw new Error(`図表の行・列・項目の形式が不正です: ${t.id}`);
  }
  for (const e of (input.page_extras ?? []) as Record<string, unknown>[])
    if (
      !id(e.page_id) ||
      (e.segments !== undefined && !validSegments(e.segments))
    )
      throw new Error(`ページ補足の形式が不正です: ${e.id}`);
  const d = input as unknown as Dataset;
  const result = validateDataset(d);
  if (result.errors.length) throw new Error(result.errors.join("\n"));
  return d;
}

/** Referential checks never join by answer text or printed number. */
export function validateDataset(d: Dataset): ValidationResult {
  const errors: string[] = [],
    warnings: string[] = [];
  const unique = <T extends { id: string }>(rows: T[], label: string) => {
    const map = new Map<string, T>();
    for (const item of rows) {
      if (map.has(item.id))
        errors.push(`${label}IDが重複しています: ${item.id}`);
      map.set(item.id, item);
    }
    return map;
  };
  const pages = unique(d.pages, "ページ"),
    questions = unique(d.questions, "問題"),
    answers = unique(d.answers, "解答");
  const allSegments = d.questions.flatMap(segmentsOf);
  const segments = unique(allSegments, "セグメント");
  unique(
    d.questions.flatMap((q) => q.notes),
    "補足",
  );
  unique(d.tables ?? [], "図表");
  unique(d.page_extras ?? [], "ページ補足");
  const blankOwners = new Map<string, string>();
  for (const q of d.questions) {
    if (!pages.has(q.page_id)) errors.push(`問題のページがありません: ${q.id}`);
    if (q.parent_id && !questions.has(q.parent_id))
      errors.push(`枝問の親問題がありません: ${q.id}`);
    if (q.kind === "subquestion" && !q.parent_id)
      errors.push(`枝問に親問題IDがありません: ${q.id}`);
    if (
      q.parent_id === q.id ||
      (q.parent_id && questions.get(q.parent_id)?.parent_id)
    )
      errors.push(`親問題の関係が不正です: ${q.id}`);
    const blanks = segmentsOf(q).filter((s) => s.type === "blank");
    for (const s of blanks) {
      blankOwners.set(s.id, q.id);
      const a = answers.get(s.answer_id ?? "");
      if (!a || a.blank_id !== s.id || a.question_id !== q.id)
        errors.push(`空欄と解答の対応が不正です: ${s.id}`);
      if (a && !q.answer_ids.includes(a.id))
        errors.push(`問題の解答一覧に空欄の解答がありません: ${s.id}`);
    }
    for (const answerId of q.answer_ids)
      if (!answers.has(answerId) || answers.get(answerId)?.question_id !== q.id)
        errors.push(`問題の解答参照が不正です: ${q.id} → ${answerId}`);
  }
  for (const a of d.answers)
    if (
      !questions.has(a.question_id) ||
      segments.get(a.blank_id)?.type !== "blank" ||
      blankOwners.get(a.blank_id) !== a.question_id ||
      segments.get(a.blank_id)?.answer_id !== a.id
    )
      errors.push(`解答の空欄参照が不正です: ${a.id}`);
  for (const p of d.pages) {
    for (const qId of p.question_ids)
      if (!questions.has(qId) || questions.get(qId)?.page_id !== p.id)
        errors.push(`ページの問題参照が不正です: ${p.id} → ${qId}`);
    const listed = new Set(p.question_ids);
    for (const q of d.questions.filter((q) => q.page_id === p.id))
      if (!listed.has(q.id))
        warnings.push(`ページの問題一覧に未登録（問題本体から表示）: ${q.id}`);
  }
  for (const t of d.tables ?? []) {
    if (!pages.has(t.page_id)) errors.push(`図表のページがありません: ${t.id}`);
    if (t.related_question_id && !questions.has(t.related_question_id))
      errors.push(`図表の関連問題がありません: ${t.id}`);
  }
  for (const e of d.page_extras ?? [])
    if (!pages.has(e.page_id))
      errors.push(`ページ補足のページがありません: ${e.id}`);
  const numbers = new Set(d.pages.map((p) => p.page_number)),
    missing: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++)
    if (!numbers.has(n)) missing.push(n);
  if (missing.length) warnings.push(`未収録ページ: ${missing.join("・")}`);
  const empty = d.pages
    .filter((p) => !d.questions.some((q) => q.page_id === p.id))
    .map((p) => p.page_number);
  if (empty.length)
    warnings.push(
      `問題本文が未収録のページ: ${empty.join("・")}（ページ補足は別途表示）`,
    );
  if (d.ready_for_production === false)
    warnings.push(
      "教材原本は本番利用不可のドラフトとして登録されています。原画像との完全照合は未完了です。",
    );
  if (d.quality_note) warnings.push(d.quality_note);
  if (d.review_issues?.length)
    warnings.push(`教材内の要確認事項: ${d.review_issues.length}件`);
  const unknownStars = d.questions.filter(
    (q) => q.importance_stars === null,
  ).length;
  if (unknownStars)
    warnings.push(
      `重要度が未設定の枝問等: ${unknownStars}件（★0とは区別し、絞り込みでは親問題の重要度を参照）`,
    );
  return {
    errors,
    warnings,
    stats: {
      pages: d.pages.length,
      questions: d.questions.length,
      mainQuestions: d.questions.filter((q) => q.kind === "question").length,
      subquestions: d.questions.filter((q) => q.kind === "subquestion").length,
      answers: d.answers.length,
      blanks: allSegments.filter((s) => s.type === "blank").length,
      redSegments: allSegments.filter((s) => s.type === "red_text").length,
      notes: d.questions.reduce((sum, q) => sum + q.notes.length, 0),
      tables: d.tables?.length ?? 0,
      extras: d.page_extras?.length ?? 0,
      reviewIssues: d.review_issues?.length ?? 0,
      missingPages: missing.length,
    },
  };
}

const numericLabel = (s: string | null | undefined) =>
  Number(s?.match(/\d+/)?.[0] ?? 0);

/** Pages first, then main/child order. Source array and q.order alone are not reading order. */
export function normalizeDataset(d: Dataset): StudyQuestion[] {
  const pages = new Map(d.pages.map((p) => [p.id, p]));
  const questions = new Map(d.questions.map((q) => [q.id, q]));
  const chapterNames = new Map<number, string>(),
    chapterSections = new Map<number, string>();
  for (const p of d.pages)
    for (const c of p.chapter_candidates ?? [])
      if (!chapterNames.has(c.number)) chapterNames.set(c.number, c.title);
  for (const p of d.pages) {
    const chapters = new Set(
      d.questions
        .filter((q) => q.page_id === p.id)
        .map((q) => q.chapter_number),
    );
    if (chapters.size === 1) {
      const n = [...chapters][0];
      if (!chapterNames.has(n) && p.chapter) chapterNames.set(n, p.chapter);
      if (!chapterSections.has(n) && p.section)
        chapterSections.set(n, p.section);
    }
  }
  const sourceIndex = new Map(d.questions.map((q, i) => [q.id, i]));
  const sorted = [...d.questions].sort((a, b) => {
    const pageDiff =
      (pages.get(a.page_id)?.page_number ?? 0) -
      (pages.get(b.page_id)?.page_number ?? 0);
    if (pageDiff) return pageDiff;
    const am = a.parent_id ? (questions.get(a.parent_id) ?? a) : a;
    const bm = b.parent_id ? (questions.get(b.parent_id) ?? b) : b;
    return (
      a.chapter_number - b.chapter_number ||
      numericLabel(am.printed_number) - numericLabel(bm.printed_number) ||
      Number(!!a.parent_id) - Number(!!b.parent_id) ||
      (a.order ?? numericLabel(a.printed_number)) -
        (b.order ?? numericLabel(b.printed_number)) ||
      sourceIndex.get(a.id)! - sourceIndex.get(b.id)!
    );
  });
  const answerGroups = new Map<string, Answer[]>();
  for (const a of d.answers) {
    const group = answerGroups.get(a.question_id) ?? [];
    group.push(a);
    answerGroups.set(a.question_id, group);
  }
  const pageQuestions = new Map<string, Question[]>();
  for (const q of sorted) {
    const group = pageQuestions.get(q.page_id) ?? [];
    group.push(q);
    pageQuestions.set(q.page_id, group);
  }
  // Diagram groups may refer broadly to the parent while their exact blanks belong to a child on the next page.
  const tableOwners = new Map<string, string>();
  for (const table of d.tables ?? []) {
    const owners = new Set<string>();
    const visit = (v: unknown) => {
      if (Array.isArray(v)) {
        v.forEach(visit);
        return;
      }
      if (!record(v)) return;
      if (id(v.answer_id) && id(v.blank_id)) {
        const answer = d.answers.find(
          (a) => a.id === v.answer_id && a.blank_id === v.blank_id,
        );
        if (answer) owners.add(answer.question_id);
      }
      Object.values(v).forEach(visit);
    };
    visit(table);
    if (owners.size === 1) tableOwners.set(table.id, [...owners][0]);
    else if (table.related_question_id)
      tableOwners.set(table.id, table.related_question_id);
    else {
      const last = pageQuestions.get(table.page_id)?.at(-1);
      if (last) tableOwners.set(table.id, last.id);
    }
  }
  return sorted.map((q, order) => {
    const p: Page = pages.get(q.page_id)!;
    const chapter =
      chapterNames.get(q.chapter_number) ??
      p.chapter ??
      `第${q.chapter_number}章`;
    const lastOnPage = pageQuestions.get(q.page_id)?.at(-1)?.id === q.id;
    return {
      id: q.id,
      pageId: q.page_id,
      pageNumber: p.page_number,
      era: p.era ?? "時代未設定",
      chapter,
      section: chapterSections.get(q.chapter_number) ?? chapter,
      order,
      source: q,
      answers: [...(answerGroups.get(q.id) ?? [])].sort(
        (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
      ),
      tables: (d.tables ?? []).filter((t) => tableOwners.get(t.id) === q.id),
      extras: lastOnPage
        ? (d.page_extras ?? []).filter((e) => e.page_id === q.page_id)
        : [],
    };
  });
}
