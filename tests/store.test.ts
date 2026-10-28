import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dataset } from "../src/model";
import {
  EMERGENCY_JOURNAL_KEY,
  EMERGENCY_SLICE_KEYS,
  emptyState,
  exportBackup,
  loadAppData,
  mergeDataset,
  recoverBeforeRestore,
  restoreBackup,
  saveState,
  validateBackup,
} from "../src/store";

const original = JSON.parse(
  readFileSync(
    new URL("../public/data/original.json", import.meta.url),
    "utf8",
  ),
) as Dataset;
function learned() {
  const state = emptyState();
  const id = original.questions[0].id;
  state.sessions.push({
    id: "s1",
    startedAt: "2026-10-27T00:00:00Z",
    viewed: [id],
  });
  state.mistakes.push({
    id: "m1",
    questionId: id,
    at: "2026-10-27T00:01:00Z",
    sessionId: "s1",
  });
  state.flags[id] = true;
  state.tags[id] = ["復習"];
  state.position = { id, offset: -18 };
  state.edits[id] = {
    question: structuredClone(original.questions[0]),
    answers: structuredClone(
      original.answers.filter((a) => a.question_id === id),
    ),
  };
  return state;
}

describe("backup protection and persistence", () => {
  it("roundtrips original, overlay, per-event history, filters and anchor", () => {
    const state = learned();
    const restored = validateBackup(exportBackup(original, state));
    expect(restored.dataset).toEqual(original);
    expect(restored.state).toEqual(state);
  });
  it("defaults legacy backups to classic and rejects unknown themes", () => {
    const legacy = learned();
    delete legacy.settings.theme;
    expect(
      validateBackup(exportBackup(original, legacy)).state.settings.theme,
    ).toBe("classic");
    const invalid = JSON.parse(exportBackup(original, legacy));
    invalid.state.settings.theme = "unknown-theme";
    expect(() => validateBackup(invalid)).toThrow(/テーマ設定/);
  });

  it("keeps selected themes through preferences-only saves, restore and undo", async () => {
    const selected = learned();
    selected.settings.theme = "aqua-dark";
    await saveState(selected);
    const light = {
      ...selected,
      settings: { ...selected.settings, theme: "aqua-light" as const },
    };
    await saveState(light, { changed: ["preferences"] });
    const loaded = await loadAppData(original);
    expect(loaded.state.settings.theme).toBe("aqua-light");
    expect(loaded.state.mistakes).toEqual(selected.mistakes);
    const legacy = learned();
    delete legacy.settings.theme;
    await restoreBackup(exportBackup(original, legacy));
    expect((await loadAppData(original)).state.settings.theme).toBe("classic");
    await recoverBeforeRestore();
    expect((await loadAppData(original)).state.settings.theme).toBe(
      "aqua-light",
    );
  });

  it("rejects an unrelated JSON document without writing", () => {
    expect(() => validateBackup(original)).toThrow("バックアップ形式");
  });
  it("rejects orphan mistake references and duplicate event IDs", () => {
    const state = learned();
    state.mistakes[0].questionId = "missing";
    expect(() => validateBackup(exportBackup(original, state))).toThrow(
      "間違い記録",
    );
    const duplicate = learned();
    duplicate.mistakes.push({ ...duplicate.mistakes[0] });
    expect(() => validateBackup(exportBackup(original, duplicate))).toThrow(
      "重複",
    );
  });
  it("rejects corrupted edited blank-to-answer references", () => {
    const state = learned();
    const edit = state.edits[original.questions[0].id];
    edit.answers = [];
    expect(() => validateBackup(exportBackup(original, state))).toThrow(
      "編集データ",
    );
  });
  it("rejects invalid edited importance and blank stars before restoring", () => {
    const state = learned();
    const edit = state.edits[original.questions[0].id];
    edit.question.importance_stars = 9;
    expect(() => validateBackup(exportBackup(original, state))).toThrow(
      "編集データ",
    );
    edit.question.importance_stars = 1;
    edit.question.segments.find((segment) => segment.type === "blank")!.stars =
      5;
    expect(() => validateBackup(exportBackup(original, state))).toThrow(
      "編集データ",
    );
  });
  it("persists separate original, edits, learning records and preferences", async () => {
    await loadAppData(original);
    const state = learned();
    await saveState(state);
    const loaded = await loadAppData(original);
    expect(loaded.dataset).toEqual(original);
    expect(loaded.state).toEqual(state);
  });
  it("snapshots calls immediately and orders rapid saves", async () => {
    const state = learned();
    const first = saveState(state);
    state.mistakes.push({ ...state.mistakes[0], id: "m2" });
    const second = saveState(state);
    state.mistakes.length = 0;
    await Promise.all([first, second]);
    expect((await loadAppData(original)).state.mistakes).toHaveLength(2);
  });
  it("atomically restores and retains recoverable data from before replacement", async () => {
    const before = learned();
    before.settings.fontSize = 20;
    await saveState(before);
    const replacement = emptyState();
    await restoreBackup(exportBackup(original, replacement));
    expect((await loadAppData(original)).state.mistakes).toHaveLength(0);
    await recoverBeforeRestore();
    expect((await loadAppData(original)).state).toEqual(before);
  });
});

describe("safe dataset imports", () => {
  it("identical reimport leaves the original and its metadata intact", () => {
    const result = mergeDataset(original, structuredClone(original));
    expect(result.added).toBe(0);
    expect(result.conflicts).toEqual([]);
    expect(result.dataset).toEqual(original);
  });
  it("reports conflicting question and answer IDs without overwriting them", () => {
    const incoming = structuredClone(original);
    incoming.questions[0].segments[0].text = "競合した新しい問題文";
    incoming.answers[0].text = "競合した解答";
    const result = mergeDataset(original, incoming);
    expect(result.conflicts).toContain(`questions:${original.questions[0].id}`);
    expect(result.conflicts).toContain(`answers:${original.answers[0].id}`);
    expect(result.dataset.questions[0]).toEqual(original.questions[0]);
    expect(result.dataset.answers[0]).toEqual(original.answers[0]);
  });
  it("adds independent new problem IDs with exact answer correspondence", () => {
    const incoming = structuredClone(original);
    const q = structuredClone(original.questions[0]);
    const oldId = q.id;
    q.id = `${oldId}-new`;
    q.answer_ids = [];
    q.segments = [{ id: `${q.id}-t`, type: "text", text: "追加された問題" }];
    q.notes = [];
    incoming.questions.push(q);
    incoming.pages.find((p) => p.id === q.page_id)!.question_ids.push(q.id);
    const result = mergeDataset(original, incoming);
    expect(result.added).toBe(1);
    expect(result.dataset.questions.at(-1)!.id).toBe(q.id);
    expect(
      result.dataset.pages.find((p) => p.id === q.page_id)!.question_ids,
    ).toContain(q.id);
    expect(result.dataset.questions.find((p) => p.id === oldId)).toEqual(
      original.questions[0],
    );
  });
});

it("reports conflicting source metadata and preserves unknown new metadata", () => {
  const incoming = structuredClone(original);
  incoming.quality_note = "更新された注記";
  incoming.new_metadata = { tags: ["追加"] };
  const result = mergeDataset(original, incoming);
  expect(result.conflicts).toContain("metadata:quality_note");
  expect(result.dataset.quality_note).toBe(original.quality_note);
  expect(result.dataset.new_metadata).toEqual({ tags: ["追加"] });
});

describe("synchronous recovery journal", () => {
  let values: Map<string, string>;
  let storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  beforeEach(async () => {
    values = new Map();
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("localStorage", storage);
    await saveState(emptyState());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes a safety snapshot synchronously before the asynchronous commit", async () => {
    const state = learned();
    const saving = saveState(state);
    const journal = JSON.parse(storage.getItem(EMERGENCY_SLICE_KEYS.learning)!);
    expect(journal.value.mistakes).toEqual(state.mistakes);
    state.mistakes.length = 0;
    expect(journal.value.mistakes).toHaveLength(1);
    await saving;
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.learning)).toBeNull();
  });

  it("recovers an uncommitted state on restart without changing the source", async () => {
    const pending = learned();
    pending.settings.fontSize = 22;
    const saved = saveState(pending);
    const journals = Object.values(EMERGENCY_SLICE_KEYS).map(
      (key) => [key, storage.getItem(key)!] as const,
    );
    await saved;
    await saveState(emptyState());
    // The old page closed with the database still old and this safety copy new.
    for (const [key, journal] of journals) storage.setItem(key, journal);
    const recovered = await loadAppData(original);
    expect(recovered.state).toEqual(pending);
    expect(recovered.dataset).toEqual(original);
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.learning)).toBeNull();
    expect((await loadAppData(original)).state).toEqual(pending);
  });

  it("does not let an earlier queued commit erase a newer pending revision", async () => {
    const firstState = learned();
    const newer = learned();
    newer.mistakes.push({ ...newer.mistakes[0], id: "m2" });
    const first = saveState(firstState);
    const second = saveState(newer);
    const latestJournal = storage.getItem(EMERGENCY_SLICE_KEYS.learning);
    await first;
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.learning)).toBe(latestJournal);
    await second;
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.learning)).toBeNull();
    expect((await loadAppData(original)).state.mistakes).toHaveLength(2);
  });

  it("falls back to IDB when safety-copy quota is unavailable without replaying stale state", async () => {
    const saving = saveState(learned());
    const staleJournal = storage.getItem(EMERGENCY_SLICE_KEYS.learning)!;
    await saving;
    storage.setItem(EMERGENCY_SLICE_KEYS.learning, staleJournal);
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    await saveState(emptyState());
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.learning)).toBeNull();
    expect((await loadAppData(original)).state.mistakes).toHaveLength(0);
  });

  it("recovers a pending journal created by the previously published app", async () => {
    await saveState(emptyState());
    storage.setItem(
      EMERGENCY_JOURNAL_KEY,
      JSON.stringify({
        format: "itimonittou-pending-state",
        version: 1,
        revision: "old-app",
        state: learned(),
      }),
    );
    expect((await loadAppData(original)).state).toEqual(learned());
    expect(storage.getItem(EMERGENCY_JOURNAL_KEY)).toBeNull();
  });

  it("writes only preferences for position changes and preserves large learning/edit slices", async () => {
    const before = learned();
    await saveState(before);
    const transactions = vi.spyOn(IDBDatabase.prototype, "transaction");
    const clone = vi.spyOn(globalThis, "structuredClone");
    const next = {
      ...before,
      position: { id: before.position!.id, offset: -73 },
    };
    const saving = saveState(next, { changed: ["preferences"] });
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.edits)).toBeNull();
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.learning)).toBeNull();
    expect(
      JSON.parse(storage.getItem(EMERGENCY_SLICE_KEYS.preferences)!).value
        .position.offset,
    ).toBe(-73);
    expect(
      clone.mock.calls.every(
        ([value]) =>
          value !== before &&
          value !== before.mistakes &&
          value !== before.edits,
      ),
    ).toBe(true);
    next.position.offset = 999;
    await saving;
    const writes = transactions.mock.calls.filter(
      ([, mode]) => mode === "readwrite",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toEqual(["preferences"]);
    const loaded = await loadAppData(original);
    expect(loaded.state.position?.offset).toBe(-73);
    expect(loaded.state.mistakes).toEqual(before.mistakes);
    expect(loaded.state.edits).toEqual(before.edits);
  });

  it("keeps an uncommitted learning revision safe when a later position save completes", async () => {
    const before = learned();
    const saving = saveState(before);
    const learningJournal = storage.getItem(EMERGENCY_SLICE_KEYS.learning)!;
    await saving;
    // The previous process committed none of this learning copy.
    await saveState(emptyState());
    storage.setItem(EMERGENCY_SLICE_KEYS.learning, learningJournal);
    const position = { id: before.position!.id, offset: -99 };
    await saveState({ ...before, position }, { changed: ["preferences"] });
    expect(storage.getItem(EMERGENCY_SLICE_KEYS.learning)).toBe(
      learningJournal,
    );
    const loaded = await loadAppData(original);
    expect(loaded.state.mistakes).toEqual(before.mistakes);
    expect(loaded.state.position).toEqual(position);
  });

  it("retains session viewing progress after a preferences-only commit without leaking internal fields", async () => {
    const before = learned();
    await saveState(before);
    const added = original.questions[1].id;
    const updated = {
      ...before,
      sessions: [
        {
          ...before.sessions[0],
          viewed: [...before.sessions[0].viewed, added],
        },
      ],
    };
    await saveState(updated, { changed: ["preferences"] });
    const loaded = await loadAppData(original);
    expect(loaded.state.sessions[0].viewed).toContain(added);
    expect(loaded.state.mistakes).toEqual(before.mistakes);
    expect(loaded.state).not.toHaveProperty("sessionProgress");
    expect(
      JSON.parse(exportBackup(loaded.dataset, loaded.state)).state,
    ).not.toHaveProperty("sessionProgress");
    await restoreBackup(exportBackup(original, before));
    expect(
      (await loadAppData(original)).state.sessions[0].viewed,
    ).not.toContain(added);
    await recoverBeforeRestore();
    expect((await loadAppData(original)).state.sessions[0].viewed).toContain(
      added,
    );
  });

  it("recovers uncommitted preference viewing progress and rejects unknown question IDs", async () => {
    const before = learned();
    await saveState(before);
    const added = original.questions[1].id;
    const updated = {
      ...before,
      sessions: [
        {
          ...before.sessions[0],
          viewed: [...before.sessions[0].viewed, added],
        },
      ],
    };
    const saving = saveState(updated, { changed: ["preferences"] });
    const journal = storage.getItem(EMERGENCY_SLICE_KEYS.preferences)!;
    await saving;
    await saveState(before);
    storage.setItem(EMERGENCY_SLICE_KEYS.preferences, journal);
    expect((await loadAppData(original)).state.sessions[0].viewed).toContain(
      added,
    );
    await saveState(before);
    const invalid = JSON.parse(journal);
    invalid.value.sessionProgress.viewed.push("missing-question");
    storage.setItem(EMERGENCY_SLICE_KEYS.preferences, JSON.stringify(invalid));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      (await loadAppData(original)).state.sessions[0].viewed,
    ).not.toContain("missing-question");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("recovers a selected theme from an interrupted preferences save", async () => {
    const before = learned();
    await saveState(before);
    const selected = {
      ...before,
      settings: { ...before.settings, theme: "aqua-dark" as const },
    };
    const saving = saveState(selected, { changed: ["preferences"] });
    const journal = storage.getItem(EMERGENCY_SLICE_KEYS.preferences)!;
    await saving;
    await saveState(before);
    storage.setItem(EMERGENCY_SLICE_KEYS.preferences, journal);
    const recovered = await loadAppData(original);
    expect(recovered.state.settings.theme).toBe("aqua-dark");
    expect(recovered.state.mistakes).toEqual(before.mistakes);
  });

  it("ignores an invalid recovery copy and preserves the existing database", async () => {
    await saveState(learned());
    storage.setItem(EMERGENCY_JOURNAL_KEY, '{"format":"unrelated"}');
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recovered = await loadAppData(original);
    expect(recovered.state).toEqual(learned());
    expect(recovered.dataset).toEqual(original);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
