import type { StudyQuestion } from "./model";
import type { UserState } from "./store";

export interface Filters {
  era: string;
  chapter: string;
  section: string;
  stars: string;
  minMistakes: number;
  period: "" | "today" | "previous" | "7" | "30" | "all";
  flagMode: "" | "only" | "include";
  tag: string;
  query: string;
}

export const defaultFilters: Filters = {
  era: "",
  chapter: "",
  section: "",
  stars: "",
  minMistakes: 0,
  period: "",
  flagMode: "",
  tag: "",
  query: "",
};

export function japanDay(value: string | number | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  // An ISO calendar date in Japan, independent of the phone's time zone.
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function formatJapaneseDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function previousSessionId(state: UserState): string | undefined {
  const sessions = [...state.sessions].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  const latest = sessions.at(-1);
  return latest?.endedAt ? latest.id : sessions.at(-2)?.id;
}

export function effectiveStars(
  question: StudyQuestion,
  questions: StudyQuestion[],
  state?: UserState,
): number | null {
  const source = state?.edits[question.id]?.question ?? question.source;
  if (source.importance_stars !== null && source.importance_stars !== undefined)
    return source.importance_stars;
  const parent = source.parent_id
    ? questions.find((q) => q.id === source.parent_id)
    : questions.find(
        (q) =>
          q.source.kind !== "subquestion" &&
          q.source.printed_number === source.parent_printed_number &&
          q.source.chapter_number === source.chapter_number &&
          q.pageNumber <= question.pageNumber,
      );
  return parent
    ? (state?.edits[parent.id]?.question ?? parent.source).importance_stars
    : null;
}

export function effectiveTags(
  question: StudyQuestion,
  state: UserState,
): string[] {
  const tags = (state.edits[question.id]?.question ?? question.source).tags;
  return [
    ...new Set([
      ...(Array.isArray(tags)
        ? tags.filter((tag): tag is string => typeof tag === "string")
        : []),
      ...(state.tags[question.id] ?? []),
    ]),
  ];
}

export function filterQuestions(
  questions: StudyQuestion[],
  state: UserState,
  now: Date = new Date(),
): StudyQuestion[] {
  const f = state.filters;
  const questionIndex = new Map(questions.map((q) => [q.id, q]));
  const counts = new Map<string, number>();
  const recent = new Set<string>();
  const previous = previousSessionId(state);
  const today = japanDay(now);
  const todayEpoch = Date.parse(`${today}T00:00:00+09:00`);
  const cutoff =
    f.period === "7" ? todayEpoch - 6 * 86400000 : todayEpoch - 29 * 86400000;
  for (const event of state.mistakes) {
    counts.set(event.questionId, (counts.get(event.questionId) ?? 0) + 1);
    const time = Date.parse(event.at);
    const inPeriod =
      f.period === "" ||
      f.period === "all" ||
      (f.period === "today" && japanDay(event.at) === today) ||
      (f.period === "previous" && event.sessionId === previous) ||
      ((f.period === "7" || f.period === "30") &&
        time >= cutoff &&
        time <= now.getTime());
    if (inPeriod) recent.add(event.questionId);
  }
  const query = f.query.trim().toLocaleLowerCase("ja-JP");
  return questions.filter((q) => {
    const source = state.edits[q.id]?.question ?? q.source;
    if (f.era && q.era !== f.era) return false;
    if (f.chapter && q.chapter !== f.chapter) return false;
    if (f.section && q.section !== f.section) return false;
    if (f.stars !== "") {
      const parent = source.parent_id
        ? questionIndex.get(source.parent_id)
        : undefined;
      const stars =
        source.importance_stars ??
        (parent
          ? (state.edits[parent.id]?.question ?? parent.source).importance_stars
          : effectiveStars(q, questions, state));
      if (stars !== Number(f.stars)) return false;
    }
    const flagged = Boolean(state.flags[q.id]);
    if (f.flagMode === "only" && !flagged) return false;
    if (f.tag && !effectiveTags(q, state).includes(f.tag)) return false;
    if (query) {
      const answerTexts = (state.edits[q.id]?.answers ?? q.answers)
        .map((a) => `${a.text ?? ""} ${a.fill_text ?? ""}`)
        .join(" ");
      const texts = [
        ...source.segments,
        ...(source.notes ?? []).flatMap((n) => n.segments ?? []),
      ]
        .map((s) => s.text ?? "")
        .join("");
      if (
        !`${texts} ${answerTexts} ${q.id} ${q.pageNumber}`
          .toLocaleLowerCase("ja-JP")
          .includes(query)
      )
        return false;
    }
    if (f.flagMode === "include" && flagged) return true;
    if ((counts.get(q.id) ?? 0) < f.minMistakes) return false;
    if (f.period && !recent.has(q.id)) return false;
    return true;
  });
}
