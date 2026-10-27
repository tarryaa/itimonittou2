import { openDB, type IDBPDatabase } from "idb";
import type { Answer, Dataset, Question } from "./model";
import { parseDataset, validateDataset } from "./dataset";
import { defaultFilters, type Filters } from "./filters";

export interface Mistake {
  id: string;
  questionId: string;
  at: string;
  sessionId: string;
}
export interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  viewed: string[];
}
export interface QuestionEdit {
  question: Question;
  answers: Answer[];
}
export interface Position {
  id: string;
  offset: number;
}
export interface UserState {
  mistakes: Mistake[];
  flags: Record<string, boolean>;
  tags: Record<string, string[]>;
  sessions: Session[];
  filters: Filters;
  position?: Position;
  settings: { fontSize: number };
  edits: Record<string, QuestionEdit>;
}
export interface AppData {
  dataset: Dataset;
  state: UserState;
}
export const DB_NAME = "itimonittou-learning";
export const DB_VERSION = 2;
export const BACKUP_FORMAT = "itimonittou-backup";
export const BACKUP_VERSION = 1;

export function emptyState(): UserState {
  return {
    mistakes: [],
    flags: {},
    tags: {},
    sessions: [],
    filters: { ...defaultFilters },
    settings: { fontSize: 17 },
    edits: {},
  };
}

let dbPromise: Promise<IDBPDatabase> | undefined;
function database() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // All upgrades are additive. Existing originals, overlays, and records survive.
      if (oldVersion < 1) {
        db.createObjectStore("originals");
        db.createObjectStore("edits");
        db.createObjectStore("learning");
        db.createObjectStore("preferences");
      }
      if (oldVersion < 2) db.createObjectStore("snapshots");
    },
    blocking() {
      dbPromise?.then((db) => db.close());
      dbPromise = undefined;
    },
    terminated() {
      dbPromise = undefined;
    },
  });
  return dbPromise;
}

let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.catch(() => undefined).then(operation);
  writeQueue = result;
  return result;
}

async function putState(db: IDBPDatabase, state: UserState) {
  const tx = db.transaction(["edits", "learning", "preferences"], "readwrite");
  await Promise.all([
    tx.objectStore("edits").put(state.edits, "current"),
    tx
      .objectStore("learning")
      .put(
        {
          mistakes: state.mistakes,
          sessions: state.sessions,
          flags: state.flags,
          tags: state.tags,
        },
        "current",
      ),
    tx
      .objectStore("preferences")
      .put(
        {
          filters: state.filters,
          position: state.position,
          settings: state.settings,
        },
        "current",
      ),
  ]);
  await tx.done;
}

export async function loadAppData(initial: Dataset): Promise<AppData> {
  await writeQueue;
  const db = await database();
  const [stored, edits, learning, preferences] = await Promise.all([
    db.get("originals", "current"),
    db.get("edits", "current"),
    db.get("learning", "current"),
    db.get("preferences", "current"),
  ]);
  let dataset = stored as Dataset | undefined;
  if (!dataset) {
    dataset = initial;
    await db.put("originals", initial, "current");
  }
  const state: UserState = {
    ...emptyState(),
    ...learning,
    ...preferences,
    edits: edits ?? {},
    filters: { ...defaultFilters, ...preferences?.filters },
    settings: { fontSize: 17, ...preferences?.settings },
  };
  return { dataset, state };
}

export function saveState(state: UserState): Promise<void> {
  // Snapshot at call time, before the async queue yields to later UI events.
  const snapshot = structuredClone(state);
  return enqueue(async () => putState(await database(), snapshot));
}

export function saveDataset(dataset: Dataset): Promise<void> {
  const snapshot = structuredClone(dataset);
  return enqueue(async () => {
    await (await database()).put("originals", snapshot, "current");
  });
}

export function exportBackup(dataset: Dataset, state: UserState): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      dataset,
      state,
    },
    null,
    2,
  );
}

function object(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function uniqueIds(values: Array<{ id: string }>, name: string) {
  check(
    new Set(values.map((value) => value.id)).size === values.length,
    `${name}のIDが重複しています。`,
  );
}

export function validateBackup(input: unknown): AppData {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  check(
    object(data) &&
      data.format === BACKUP_FORMAT &&
      data.version === BACKUP_VERSION,
    "対応するアプリのバックアップ形式ではありません。",
  );
  const dataset = parseDataset(data.dataset);
  const report = validateDataset(dataset);
  check(
    report.errors.length === 0,
    `教材の整合性エラー: ${report.errors.join(" / ")}`,
  );
  const s = data.state;
  check(object(s), "学習データがありません。");
  check(
    Array.isArray(s.mistakes) &&
      Array.isArray(s.sessions) &&
      object(s.flags) &&
      object(s.tags) &&
      object(s.edits),
    "学習データの構造が不正です。",
  );
  const questionIds = new Set(dataset.questions.map((q) => q.id));
  const sessions = new Set<string>();
  for (const session of s.sessions) {
    check(
      object(session) &&
        typeof session.id === "string" &&
        session.id &&
        validDate(session.startedAt) &&
        (!session.endedAt || validDate(session.endedAt)) &&
        Array.isArray(session.viewed),
      "セッション記録が不正です。",
    );
    check(
      session.viewed.every(
        (id: unknown) => typeof id === "string" && questionIds.has(id),
      ),
      "セッションが存在しない問題を参照しています。",
    );
    sessions.add(session.id);
  }
  uniqueIds(s.sessions, "セッション");
  for (const mistake of s.mistakes) {
    check(
      object(mistake) &&
        typeof mistake.id === "string" &&
        mistake.id &&
        questionIds.has(mistake.questionId) &&
        validDate(mistake.at) &&
        sessions.has(mistake.sessionId),
      "間違い記録の日時または参照先が不正です。",
    );
  }
  uniqueIds(s.mistakes, "間違い記録");
  for (const [id, flag] of Object.entries(s.flags))
    check(
      questionIds.has(id) && typeof flag === "boolean",
      "注意マークの参照先が不正です。",
    );
  for (const [id, tags] of Object.entries(s.tags))
    check(
      questionIds.has(id) &&
        Array.isArray(tags) &&
        tags.every((t) => typeof t === "string"),
      "タグが不正です。",
    );
  const editedQuestions = new Map<string, Question>();
  const editedAnswers = new Map<string, Answer[]>();
  for (const [id, edit] of Object.entries(s.edits)) {
    check(
      questionIds.has(id) &&
        object(edit) &&
        object(edit.question) &&
        edit.question.id === id &&
        Array.isArray(edit.answers),
      "編集データの問題IDが不正です。",
    );
    const original = dataset.questions.find((q) => q.id === id)!;
    check(
      edit.question.page_id === original.page_id,
      "編集で元のページ参照が変更されています。",
    );
    editedQuestions.set(id, edit.question as Question);
    editedAnswers.set(id, edit.answers as Answer[]);
  }
  if (editedQuestions.size) {
    try {
      parseDataset({
        ...dataset,
        questions: dataset.questions.map((q) => editedQuestions.get(q.id) ?? q),
        answers: [
          ...dataset.answers.filter((a) => !editedQuestions.has(a.question_id)),
          ...[...editedAnswers.values()].flat(),
        ],
      });
    } catch (error) {
      throw new Error(
        `編集データが不正です: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const f = s.filters;
  check(
    object(f) &&
      ["era", "chapter", "section", "stars", "tag", "query"].every(
        (k) => typeof f[k] === "string",
      ) &&
      ["", "0", "1", "2", "3"].includes(f.stars),
    "絞り込み条件が不正です。",
  );
  check(
    Number.isInteger(f.minMistakes) &&
      f.minMistakes >= 0 &&
      ["", "today", "previous", "7", "30", "all"].includes(f.period) &&
      ["", "only", "include"].includes(f.flagMode),
    "絞り込み条件が不正です。",
  );
  check(
    object(s.settings) &&
      Number.isFinite(s.settings.fontSize) &&
      s.settings.fontSize >= 10 &&
      s.settings.fontSize <= 40,
    "文字サイズ設定が不正です。",
  );
  if (s.position !== undefined)
    check(
      object(s.position) &&
        questionIds.has(s.position.id) &&
        Number.isFinite(s.position.offset),
      "閲覧位置が不正です。",
    );
  return structuredClone({ dataset, state: s as unknown as UserState });
}

/** The UI must display a preview and ask the user to confirm before calling this. */
export function restoreBackup(input: unknown): Promise<AppData> {
  const checked = validateBackup(input);
  return enqueue(async () => {
    const db = await database();
    // Retain the previous complete state in the same transaction as replacement.
    const tx = db.transaction(
      ["originals", "edits", "learning", "preferences", "snapshots"],
      "readwrite",
    );
    const originals = tx.objectStore("originals");
    const edits = tx.objectStore("edits");
    const learning = tx.objectStore("learning");
    const preferences = tx.objectStore("preferences");
    const previous = {
      dataset: await originals.get("current"),
      edits: await edits.get("current"),
      learning: await learning.get("current"),
      preferences: await preferences.get("current"),
    };
    await tx.objectStore("snapshots").put(previous, "beforeRestore");
    const s = checked.state;
    await Promise.all([
      originals.put(checked.dataset, "current"),
      edits.put(s.edits, "current"),
      learning.put(
        {
          mistakes: s.mistakes,
          sessions: s.sessions,
          flags: s.flags,
          tags: s.tags,
        },
        "current",
      ),
      preferences.put(
        { filters: s.filters, position: s.position, settings: s.settings },
        "current",
      ),
    ]);
    await tx.done;
    return checked;
  });
}

/** Keep every existing record. Conflicting IDs are reported, never overwritten. */
export function mergeDataset(
  current: Dataset,
  incoming: Dataset,
): { dataset: Dataset; conflicts: string[]; added: number } {
  const errors = validateDataset(incoming).errors;
  check(
    errors.length === 0,
    `取り込む教材に整合性エラーがあります: ${errors.join(" / ")}`,
  );
  const conflicts: string[] = [];
  const next = structuredClone(current) as Dataset & Record<string, any>;
  let added = 0;
  // Merge question/answer groups atomically: a changed answer cannot silently be
  // paired with a newly imported blank, or vice versa.
  const currentQuestions = new Map(current.questions.map((q) => [q.id, q]));
  const currentAnswers = new Map(current.answers.map((a) => [a.id, a]));
  const incomingQuestions = new Map(incoming.questions.map((q) => [q.id, q]));
  const rejectedQuestions = new Set<string>();
  for (const q of incoming.questions) {
    const old = currentQuestions.get(q.id);
    if (old && stable(old) !== stable(q)) {
      conflicts.push(`questions:${q.id}`);
      rejectedQuestions.add(q.id);
    }
    for (const answer of incoming.answers.filter(
      (a) => a.question_id === q.id,
    )) {
      const oldAnswer = currentAnswers.get(answer.id);
      if (oldAnswer && stable(oldAnswer) !== stable(answer)) {
        conflicts.push(`answers:${answer.id}`);
        rejectedQuestions.add(q.id);
      }
    }
  }
  for (const q of incoming.questions) {
    if (!currentQuestions.has(q.id) && !rejectedQuestions.has(q.id)) {
      next.questions.push(structuredClone(q));
      added++;
    }
  }
  for (const answer of incoming.answers) {
    if (
      !currentAnswers.has(answer.id) &&
      !rejectedQuestions.has(answer.question_id) &&
      incomingQuestions.has(answer.question_id)
    )
      next.answers.push(structuredClone(answer));
  }
  for (const key of [
    "pages",
    "tables",
    "page_extras",
    "review_issues",
    "sources",
  ] as const) {
    const before: any[] = (current as any)[key] ?? [];
    const after: any[] = (incoming as any)[key] ?? [];
    const index = new Map(before.map((v) => [v.id ?? v.file, v]));
    const records = structuredClone(before);
    for (const item of after) {
      const id = item.id ?? item.file;
      const old = index.get(id);
      if (!old) {
        if (key === "pages")
          records.push({
            ...structuredClone(item),
            question_ids: (item.question_ids ?? []).filter(
              (qid: string) => !rejectedQuestions.has(qid),
            ),
          });
        else records.push(structuredClone(item));
      } else if (stable(old) !== stable(item)) {
        if (key === "pages") {
          // Append newly accepted questions to an existing page, retaining metadata.
          const page = records.find((p) => p.id === id);
          page.question_ids = [
            ...new Set([
              ...(page.question_ids ?? []),
              ...(item.question_ids ?? []).filter(
                (qid: string) => !rejectedQuestions.has(qid),
              ),
            ]),
          ];
          const { question_ids: oldIds, ...oldMeta } = old;
          const { question_ids: newIds, ...newMeta } = item;
          if (stable(oldMeta) !== stable(newMeta))
            conflicts.push(`${key}:${id}`);
        } else conflicts.push(`${key}:${id}`);
      }
    }
    (next as any)[key] = records;
  }
  const mergedCollections = new Set([
    "questions",
    "answers",
    "pages",
    "tables",
    "page_extras",
    "review_issues",
    "sources",
  ]);
  for (const [key, value] of Object.entries(incoming)) {
    if (mergedCollections.has(key)) continue;
    if (!Object.hasOwn(current, key)) next[key] = structuredClone(value);
    else if (stable(current[key]) !== stable(value))
      conflicts.push(`metadata:${key}`);
  }
  const mergedErrors = validateDataset(next).errors;
  check(
    mergedErrors.length === 0,
    `既存教材と安全に統合できません: ${mergedErrors.join(" / ")}`,
  );
  return { dataset: next, conflicts: [...new Set(conflicts)], added };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export async function recoverBeforeRestore(): Promise<AppData> {
  const db = await database();
  const snapshot = await db.get("snapshots", "beforeRestore");
  check(snapshot?.dataset, "復元前のデータがありません。");
  const state = {
    ...emptyState(),
    ...snapshot.learning,
    ...snapshot.preferences,
    edits: snapshot.edits ?? {},
  };
  return restoreBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    dataset: snapshot.dataset,
    state,
  });
}
