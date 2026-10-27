import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  SlidersHorizontal,
  Eye,
  EyeOff,
  History,
  Settings,
  Plus,
  Minus,
  Ellipsis,
  X,
  Download,
  Upload,
  Search,
  ChevronRight,
  Bookmark,
  Check,
  RotateCcw,
} from "lucide-react";
import type {
  Dataset,
  StudyQuestion,
  Question,
  Answer,
  PageExtra,
} from "./model";
import { normalizeDataset, parseDataset, validateDataset } from "./dataset";
import {
  loadAppData,
  saveState,
  saveDataset,
  exportBackup,
  validateBackup,
  restoreBackup,
  mergeDataset,
  recoverBeforeRestore,
} from "./store";
import type { UserState, Position, AppData } from "./store";
import {
  defaultFilters,
  filterQuestions,
  formatJapaneseDate,
  effectiveTags,
} from "./filters";
import type { Filters } from "./filters";
import Editor from "./Editor";
import { Segments } from "./Segments";
import { registerPwa } from "./pwa";
import TableContent from "./TableContent";
import VirtualBook, { type BookHandle } from "./VirtualBook";

const uid = () => crypto.randomUUID();
function documentPosition(): Position | undefined {
  const elements = document.querySelectorAll<HTMLElement>("[data-qid]");
  if (!elements.length) return;
  let l = 0,
    r = elements.length - 1;
  while (l < r) {
    const m = Math.floor((l + r) / 2);
    if (elements[m].getBoundingClientRect().bottom < 128) l = m + 1;
    else r = m;
  }
  const e = elements[l];
  return { id: e.dataset.qid!, offset: e.getBoundingClientRect().top };
}
function textValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(textValue).join("・");
  if (typeof v === "object")
    return Object.entries(v)
      .map(([k, x]) => `${k}: ${textValue(x)}`)
      .join(" / ");
  return String(v);
}

function ExtraContent({ extra, all }: { extra: PageExtra; all: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(new Set<string>());
  useEffect(() => {
    if (!all) setRevealed((old) => (old.size ? new Set() : old));
  }, [all]);
  useEffect(() => {
    if (all || !revealed.size) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) setRevealed(new Set());
      },
      { rootMargin: "650px 0px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [all, revealed.size]);
  return (
    <aside ref={ref} className="page-extra">
      <strong>{extra.heading || extra.title || "学習のヒント"}</strong>
      {extra.segments && (
        <Segments
          segments={extra.segments}
          answers={[]}
          allVisible={all}
          revealed={revealed}
          onToggle={(id) =>
            setRevealed((p) => {
              const n = new Set(p);
              n.has(id) ? n.delete(id) : n.add(id);
              return n;
            })
          }
        />
      )}
      {extra.summary && <p>{extra.summary}</p>}
      {typeof extra.note === "string" && <small>{extra.note}</small>}
    </aside>
  );
}
interface CardProps {
  item: StudyQuestion;
  edit?: { question: Question; answers: Answer[] };
  count: number;
  flagged: boolean;
  all: boolean;
  onAction: (action: string, id: string) => void;
}
const QuestionCard = memo(function QuestionCard({
  item,
  edit,
  count,
  flagged,
  all,
  onAction,
}: CardProps) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(new Set<string>());
  const q = edit?.question ?? item.source;
  const answers = edit?.answers ?? item.answers;
  useEffect(() => {
    if (!all) setRevealed((old) => (old.size ? new Set() : old));
  }, [all, edit]);
  useEffect(() => {
    if (all || !revealed.size) return;
    const observer = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) setRevealed(new Set());
      },
      { rootMargin: "650px 0px 650px 0px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [all, revealed.size]);
  const toggle = (id: string) =>
    setRevealed((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  return (
    <article
      ref={ref}
      data-qid={q.id}
      className={`question ${q.kind === "subquestion" ? "subquestion" : ""}`}
    >
      <div className="question-meta">
        <span className="q-number">
          {q.kind === "subquestion"
            ? `問${q.parent_printed_number || ""} · 枝問 ${q.printed_number}`
            : `問 ${q.printed_number}`}
        </span>
        <span
          className="stars"
          aria-label={`重要度 ${q.importance_stars ?? "未設定"}`}
        >
          {q.importance_stars == null
            ? "枝問"
            : q.importance_stars === 0
              ? "★0"
              : "★".repeat(q.importance_stars)}
        </span>
        <span className="page-number">p.{item.pageNumber}</span>
        {edit && <span className="edited">編集済</span>}
        <button
          className={`flag icon-button ${flagged ? "active" : ""}`}
          aria-label="注意マーク"
          aria-pressed={flagged}
          onClick={() => onAction("flag", q.id)}
        >
          ！
        </button>
      </div>
      <div className="question-text">
        <Segments
          segments={q.segments}
          answers={answers}
          allVisible={all}
          revealed={revealed}
          onToggle={toggle}
        />
      </div>
      {q.notes?.map((note) => (
        <div
          className="note"
          key={note.id}
          style={{
            fontSize: note.style?.size === "body" ? "1em" : undefined,
            paddingLeft: note.style?.indent
              ? `${note.style.indent}em`
              : undefined,
          }}
        >
          <span className="note-marker">{note.marker || "補足"}</span>
          <span>
            <Segments
              segments={note.segments}
              answers={answers}
              allVisible={all}
              revealed={revealed}
              onToggle={toggle}
            />
          </span>
        </div>
      ))}
      {item.tables.map((t) => (
        <TableContent key={t.id} table={t} all={all} answers={answers} />
      ))}
      {item.extras.map((e) => (
        <ExtraContent key={e.id} extra={e} all={all} />
      ))}
      <div className="question-actions">
        <div className="counter">
          <span>間違い</span>
          <button
            aria-label="間違いを1回取り消す"
            disabled={!count}
            onClick={() => onAction("minus", q.id)}
          >
            <Minus size={16} />
          </button>
          <button
            className="count-value"
            aria-label="間違い履歴を開く"
            onClick={() => onAction("history", q.id)}
          >
            {count}
          </button>
          <button
            aria-label="間違いを1回記録"
            onClick={() => onAction("plus", q.id)}
          >
            <Plus size={17} />
          </button>
        </div>
        <button
          className="more-button"
          aria-label="問題の編集とタグ"
          onClick={() => onAction("menu", q.id)}
        >
          <Ellipsis size={21} />
        </button>
      </div>
    </article>
  );
});
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button aria-label="閉じる" className="icon-button" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function download(name: string, content: string) {
  const u = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
function newSession(state: UserState): UserState {
  const now = new Date().toISOString();
  return {
    ...state,
    sessions: [
      ...state.sessions.map((s) => (!s.endedAt ? { ...s, endedAt: now } : s)),
      { id: uid(), startedAt: now, viewed: [] },
    ],
  };
}

export default function App() {
  const [data, setData] = useState<Dataset>();
  const [state, setState] = useState<UserState>();
  const stateRef = useRef<UserState | undefined>(undefined);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [panel, setPanel] = useState("");
  const [target, setTarget] = useState("");
  const [all, setAll] = useState(false);
  const [current, setCurrent] = useState("");
  const pending = useRef<Position | undefined>(undefined);
  const book = useRef<BookHandle>(null);
  const initialized = useRef(false);
  const [draftFilters, setDraftFilters] = useState<Filters>({
    ...defaultFilters,
  });
  const [importPreview, setImportPreview] = useState<{
    kind: "backup" | "dataset";
    value: AppData;
    conflicts: string[];
    added: number;
  }>();
  const [update, setUpdate] = useState<() => void>();
  const importing = useRef(false);
  const [importBusy, setImportBusy] = useState(false);
  const sessionId = useRef("");
  const updateState = useCallback((fn: (s: UserState) => UserState) => {
    const old = stateRef.current;
    if (!old) return;
    const next = fn(old);
    stateRef.current = next;
    // Journal synchronously before rendering confirmation, then commit to IndexedDB.
    const changed: ("edits" | "learning" | "preferences")[] = [];
    if (next.edits !== old.edits) changed.push("edits");
    if (
      next.mistakes !== old.mistakes ||
      next.flags !== old.flags ||
      next.tags !== old.tags ||
      next.sessions !== old.sessions
    )
      changed.push("learning");
    if (
      next.position !== old.position ||
      next.filters !== old.filters ||
      next.settings !== old.settings
    )
      changed.push("preferences");
    if (changed.length)
      void saveState(next, { changed }).catch((e) =>
        setError(`保存できませんでした: ${e}`),
      );
    setState(next);
  }, []);
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}data/original.json`)
      .then((r) => {
        if (!r.ok) throw new Error("教材の読み込みに失敗しました");
        return r.json();
      })
      .then(parseDataset)
      .then(loadAppData)
      .then((result) => {
        if (!live) return;
        const s = newSession(result.state);
        sessionId.current = s.sessions.at(-1)!.id;
        pending.current = s.position;
        stateRef.current = s;
        void saveState(s).catch((e) => setError(`保存できませんでした: ${e}`));
        setData(result.dataset);
        setState(s);
        initialized.current = true;
      })
      .catch((e) => setError(String(e)));
    registerPwa((apply) => setUpdate(() => apply));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const flush = () => {
      if (importing.current) return;
      if (stateRef.current) {
        stateRef.current = {
          ...stateRef.current,
          position: documentPosition() ?? stateRef.current.position,
        };
        void saveState(stateRef.current).catch((e) =>
          setError(`保存できませんでした: ${e}`),
        );
      }
    };
    window.addEventListener("pagehide", flush);
    const visibility = () => {
      if (document.hidden) flush();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!panel) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panel !== "edit") setPanel("");
    };
    window.addEventListener("keydown", esc);
    return () => {
      document.body.style.overflow = prior;
      window.removeEventListener("keydown", esc);
    };
  }, [panel]);
  const questions = useMemo(() => (data ? normalizeDataset(data) : []), [data]);
  const filtered = useMemo(
    () => (state ? filterQuestions(questions, state) : []),
    [
      questions,
      state?.filters,
      state?.mistakes,
      state?.flags,
      state?.tags,
      state?.edits,
      state?.sessions,
    ],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of state?.mistakes ?? [])
      m.set(e.questionId, (m.get(e.questionId) ?? 0) + 1);
    return m;
  }, [state?.mistakes]);
  const currentQ = questions.find((q) => q.id === current) ?? filtered[0];
  const selected = questions.find((q) => q.id === target);
  const activeQ =
    selected && (state?.edits[target]?.question ?? selected.source);
  const activeAnswers =
    selected && (state?.edits[target]?.answers ?? selected.answers);
  const capture = useCallback(
    (): Position | undefined =>
      documentPosition() ?? stateRef.current?.position,
    [],
  );
  useLayoutEffect(() => {
    if (!data || !state || !pending.current) return;
    const anchor = pending.current;
    pending.current = undefined;
    let id = anchor.id;
    if (!filtered.some((q) => q.id === id)) {
      const index = questions.findIndex((q) => q.id === id);
      id = filtered.reduce(
        (best, q) =>
          Math.abs(q.order - index) < Math.abs(best.order - index) ? q : best,
        filtered[0] ?? ({ order: 0, id: "" } as StudyQuestion),
      ).id;
    }
    book.current?.restore({
      id,
      offset: id === anchor.id ? anchor.offset : 150,
    });
    setCurrent(id);
  }, [filtered, data, state?.settings.fontSize, state?.filters, state?.edits]);
  useEffect(() => {
    if (!initialized.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const p = capture();
        if (!p) return;
        if (book.current?.isRestoring()) return;
        setCurrent(p.id);
        const s = stateRef.current;
        if (!s) return;
        const next = {
          ...s,
          position: p,
          sessions: s.sessions.map((session) =>
            session.id === sessionId.current && !session.viewed.includes(p.id)
              ? { ...session, viewed: [...session.viewed, p.id] }
              : session,
          ),
        };
        stateRef.current = next;
        // Scrolling saves only the small preference record, without rendering the app.
        void saveState(next, { changed: ["preferences"] }).catch((e) =>
          setError(`保存できませんでした: ${e}`),
        );
      }, 180);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("bookpositionchange", onScroll);
    onScroll();
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("bookpositionchange", onScroll);
    };
  }, [!!state, capture, updateState]);
  const action = useCallback(
    (type: string, id: string) => {
      if (["plus", "minus", "flag"].includes(type))
        pending.current = documentPosition();
      if (type === "plus")
        updateState((s) => ({
          ...s,
          mistakes: [
            ...s.mistakes,
            {
              id: uid(),
              questionId: id,
              at: new Date().toISOString(),
              sessionId: sessionId.current,
            },
          ],
        }));
      if (type === "minus")
        updateState((s) => {
          let last = -1;
          for (let i = s.mistakes.length - 1; i >= 0; i--) {
            if (s.mistakes[i].questionId === id) {
              last = i;
              break;
            }
          }
          return { ...s, mistakes: s.mistakes.filter((_, i) => i !== last) };
        });
      if (type === "flag")
        updateState((s) => ({
          ...s,
          flags: { ...s.flags, [id]: !s.flags[id] },
        }));
      if (["history", "menu"].includes(type)) {
        setTarget(id);
        setPanel(type);
      }
    },
    [updateState],
  );
  function applyFilters(f: Filters) {
    pending.current = capture();
    updateState((s) => ({ ...s, filters: f, position: pending.current }));
    setPanel("");
  }
  async function readFile(file: File, kind: "backup" | "dataset") {
    try {
      const content = JSON.parse(await file.text());
      if (kind === "backup") {
        const value = validateBackup(content);
        setImportPreview({ kind, value, conflicts: [], added: 0 });
      } else {
        const incoming = parseDataset(content);
        const result = mergeDataset(data!, incoming);
        setImportPreview({
          kind,
          value: { dataset: result.dataset, state: state! },
          conflicts: result.conflicts,
          added: result.added,
        });
      }
    } catch (e) {
      setError(String(e));
    }
  }
  async function acceptImport() {
    if (!importPreview || importing.current) return;
    importing.current = true;
    setImportBusy(true);
    try {
      await saveState(stateRef.current!);
      let result = importPreview.value;
      if (importPreview.kind === "backup") {
        result = await restoreBackup(
          exportBackup(result.dataset, result.state),
        );
        result = { ...result, state: newSession(result.state) };
        sessionId.current = result.state.sessions.at(-1)!.id;
      } else {
        await saveDataset(result.dataset);
        result = { ...result, state: stateRef.current! };
      }
      pending.current = result.state.position;
      stateRef.current = result.state;
      await saveState(result.state);
      setData(result.dataset);
      setState(result.state);
      setImportPreview(undefined);
      setAll(false);
      setToast("データを保存しました");
    } catch (e) {
      setError(String(e));
    } finally {
      importing.current = false;
      setImportBusy(false);
    }
  }
  async function undoRestore() {
    if (
      importing.current ||
      !confirm("復元を取り消し、復元直前のデータに戻しますか？")
    )
      return;
    importing.current = true;
    setImportBusy(true);
    try {
      await saveState(stateRef.current!);
      const result = await recoverBeforeRestore();
      const next = newSession(result.state);
      sessionId.current = next.sessions.at(-1)!.id;
      stateRef.current = next;
      await saveState(next);
      pending.current = next.position;
      setData(result.dataset);
      setState(next);
      setAll(false);
      setToast("復元前のデータに戻しました");
    } catch (e) {
      setError(String(e));
    } finally {
      importing.current = false;
      setImportBusy(false);
    }
  }

  const activeFilter = useMemo(
    () =>
      state
        ? Object.entries(state.filters).filter(
            ([k, v]) => v !== defaultFilters[k as keyof Filters],
          ).length
        : 0,
    [state?.filters],
  );
  const emptyPages = useMemo(() => {
    if (!data) return [];
    const occupied = new Set(data.questions.map((q) => q.page_id));
    return data.pages.filter((p) => !occupied.has(p.id));
  }, [data]);
  const renderRow = useCallback(
    (q: StudyQuestion, i: number) => {
      if (!state || !data) return null;
      return (
        <>
          {(!i || q.chapter !== filtered[i - 1].chapter) && (
            <h2 className="chapter-heading">
              <span>{q.era}</span>
              {q.chapter}
            </h2>
          )}
          <QuestionCard
            item={q}
            edit={state.edits[q.id]}
            count={counts.get(q.id) ?? 0}
            flagged={!!state.flags[q.id]}
            all={all}
            onAction={action}
          />
          {!activeFilter &&
            (!filtered[i + 1] || filtered[i + 1].pageNumber > q.pageNumber) &&
            emptyPages
              .filter(
                (p) =>
                  p.page_number > q.pageNumber &&
                  p.page_number < (filtered[i + 1]?.pageNumber ?? Infinity),
              )
              .map((p) => (
                <section key={p.id} className="empty-page">
                  <h3>
                    p.{p.page_number} {p.chapter}
                  </h3>
                  {data.page_extras
                    ?.filter((e) => e.page_id === p.id)
                    .map((e) => (
                      <ExtraContent extra={e} key={e.id} all={all} />
                    ))}
                  {data.tables
                    ?.filter((t) => t.page_id === p.id)
                    .map((t) => (
                      <TableContent
                        table={t}
                        key={t.id}
                        all={all}
                        answers={data.answers}
                      />
                    ))}
                  {!data.page_extras?.some((e) => e.page_id === p.id) && (
                    <p className="muted">
                      このページの本文は教材JSONに収録されていません。
                    </p>
                  )}
                </section>
              ))}
        </>
      );
    },
    [
      data,
      filtered,
      state?.edits,
      state?.flags,
      counts,
      all,
      action,
      activeFilter,
      emptyPages,
    ],
  );
  const audit = useMemo(
    () => (data && panel === "audit" ? validateDataset(data) : undefined),
    [data, panel],
  );
  if (!state || !data)
    return (
      <div className="loading">
        <BookOpen size={42} />
        <h1>日本史の栞</h1>
        <p>{error || "教材と学習記録を読み込んでいます…"}</p>
      </div>
    );
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPanel("contents");
            }}
            className="brand"
          >
            <span className="brand-icon">
              <BookOpen size={22} />
            </span>
            <span>
              日本史の栞<small>一問一答 · STUDY NOTE</small>
            </span>
          </a>
          <button
            className="icon-button"
            aria-label="設定とデータ管理"
            onClick={() => setPanel("settings")}
          >
            <Settings size={22} />
          </button>
        </div>
      </header>
      <main
        className="app-main"
        style={
          {
            "--study-font": `${state.settings.fontSize}px`,
          } as React.CSSProperties
        }
      >
        <section className="intro">
          <div className="eyebrow">積み重ねが、知識になる。</div>
          <h1>今日も、一問ずつ。</h1>
          <p>赤字・空欄をタップして、記憶を確かめましょう。</p>
          <div className="study-status">
            <span>
              <span className="status-dot" />
              学習中
            </span>
            <span>
              {filtered.length.toLocaleString()} /{" "}
              {questions.length.toLocaleString()} 問
            </span>
            <button onClick={() => setPanel("audit")}>
              教材の校正状況 <ChevronRight size={13} />
            </button>
          </div>
        </section>
        <div className="reading-bar">
          <button onClick={() => setPanel("contents")}>
            <Bookmark size={15} />
            <span>
              {currentQ?.era || "教材"}
              <b>{currentQ?.chapter || "目次"}</b>
            </span>
            <ChevronRight size={15} />
          </button>
          <span>{currentQ ? `p.${currentQ.pageNumber}` : ""}</span>
        </div>
        <aside className="era-rail" aria-label="現在の時代と章">
          <span>{currentQ?.era}</span>
          <small>{currentQ?.chapter}</small>
        </aside>
        {!filtered.length && (
          <div className="empty">
            <Search />
            <h2>該当する問題がありません</h2>
            <p>条件を少し広げてみましょう。</p>
            <button
              className="primary"
              onClick={() => applyFilters({ ...defaultFilters })}
            >
              絞り込みを解除
            </button>
          </div>
        )}
        <VirtualBook
          ref={book}
          items={filtered}
          renderRow={renderRow}
          layoutKey={state.settings.fontSize}
        />
        <p className="end-note">ここまでの積み重ねを、明日につなげよう。</p>
      </main>
      <nav className="bottom-nav" aria-label="学習操作">
        <button
          onClick={() => {
            setDraftFilters({ ...state.filters });
            setPanel("filters");
          }}
          className={activeFilter ? "active" : ""}
        >
          <SlidersHorizontal size={21} />
          <span>絞り込み{activeFilter ? ` · ${activeFilter}` : ""}</span>
        </button>
        <button
          className={all ? "active" : ""}
          onClick={() => setAll((v) => !v)}
        >
          {all ? <EyeOff size={22} /> : <Eye size={22} />}
          <span>{all ? "すべて隠す" : "すべて表示"}</span>
        </button>
        <button
          onClick={() => {
            setTarget("");
            setState(stateRef.current);
            setPanel("history");
          }}
        >
          <History size={22} />
          <span>学習履歴</span>
        </button>
      </nav>
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
      {error && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError("")}>閉じる</button>
        </div>
      )}
      {update && (
        <div className="update-banner">
          新しいバージョンがあります
          <button
            onClick={async () => {
              await saveState(stateRef.current!);
              update();
            }}
          >
            保存して更新
          </button>
          <button
            aria-label="更新通知を閉じる"
            onClick={() => setUpdate(undefined)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {panel === "filters" && (
        <Modal title="問題を絞り込む" onClose={() => setPanel("")}>
          <p className="muted">
            複数の条件を組み合わせて、今の自分に必要な復習を。
          </p>
          <div className="form-grid">
            <label>
              キーワード
              <input
                placeholder="問題文・解答・ページ番号"
                value={draftFilters.query}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, query: e.target.value })
                }
              />
            </label>
            {(["era", "chapter", "section"] as const).map((field, i) => (
              <label key={field}>
                {["時代", "章", "節"][i]}
                <select
                  aria-label={["時代", "章", "節"][i]}
                  value={draftFilters[field]}
                  onChange={(e) =>
                    setDraftFilters({
                      ...draftFilters,
                      [field]: e.target.value,
                      ...(field === "era" ? { chapter: "", section: "" } : {}),
                    })
                  }
                >
                  <option value="">すべて</option>
                  {[
                    ...new Set(
                      questions
                        .filter(
                          (q) =>
                            !draftFilters.era || q.era === draftFilters.era,
                        )
                        .map((q) => q[field]),
                    ),
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
            <div className="two-col">
              <label>
                重要度
                <select
                  aria-label="重要度"
                  value={draftFilters.stars}
                  onChange={(e) =>
                    setDraftFilters({ ...draftFilters, stars: e.target.value })
                  }
                >
                  <option value="">すべて</option>
                  {[0, 1, 2, 3].map((n) => (
                    <option value={n} key={n}>
                      ★{n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                間違い回数（以上）
                <input
                  type="number"
                  min="0"
                  value={draftFilters.minMistakes}
                  onChange={(e) =>
                    setDraftFilters({
                      ...draftFilters,
                      minMistakes: Math.max(
                        0,
                        Math.floor(Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <label>
              間違えた期間
              <select
                aria-label="間違えた期間"
                value={draftFilters.period}
                onChange={(e) =>
                  setDraftFilters({
                    ...draftFilters,
                    period: e.target.value as Filters["period"],
                  })
                }
              >
                {[
                  ["", "指定なし"],
                  ["today", "今日（日本時間）"],
                  ["previous", "前回の学習セッション"],
                  ["7", "過去7日間"],
                  ["30", "過去30日間"],
                  ["all", "全期間"],
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              注意マーク「！」
              <select
                aria-label="注意マーク「！」"
                value={draftFilters.flagMode}
                onChange={(e) =>
                  setDraftFilters({
                    ...draftFilters,
                    flagMode: e.target.value as Filters["flagMode"],
                  })
                }
              >
                <option value="">指定なし</option>
                <option value="only">注意マーク付きだけ</option>
                <option value="include">
                  回数・期間の条件に加えて注意マーク付きも含める
                </option>
              </select>
            </label>
            <label>
              タグ
              <select
                aria-label="タグ"
                value={draftFilters.tag}
                onChange={(e) =>
                  setDraftFilters({ ...draftFilters, tag: e.target.value })
                }
              >
                <option value="">すべて</option>
                {[
                  ...new Set(questions.flatMap((q) => effectiveTags(q, state))),
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button onClick={() => setDraftFilters({ ...defaultFilters })}>
              条件をリセット
            </button>
            <button
              className="primary"
              onClick={() => applyFilters(draftFilters)}
            >
              この条件で表示
            </button>
          </div>
        </Modal>
      )}
      {panel === "contents" && (
        <Modal title="時代・章から探す" onClose={() => setPanel("")}>
          <p className="muted">
            章を選ぶと、絞り込みを解除してその章へ移動します。
          </p>
          {questions
            .filter((q, i) => !i || q.chapter !== questions[i - 1].chapter)
            .map((q) => (
              <button
                key={q.id}
                className="contents-row"
                onClick={() => {
                  pending.current = { id: q.id, offset: 150 };
                  updateState((s) => ({
                    ...s,
                    filters: { ...defaultFilters },
                  }));
                  setPanel("");
                }}
              >
                <span>
                  <small>
                    {q.era} · p.{q.pageNumber}
                  </small>
                  {q.chapter}
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
        </Modal>
      )}
      {panel === "menu" && selected && (
        <Modal
          title={`p.${selected.pageNumber} · 問題の管理`}
          onClose={() => setPanel("")}
        >
          <p className="muted code-id">{target}</p>
          <button
            className="wide-button primary"
            onClick={() => setPanel("edit")}
          >
            問題文・赤字・空欄・解答を編集
          </button>
          <button className="wide-button" onClick={() => setPanel("history")}>
            この問題の間違い履歴
          </button>
          <label>
            タグ（カンマ区切り）
            <input
              defaultValue={(state.tags[target] ?? []).join(", ")}
              onBlur={(e) => {
                const tags = [
                  ...new Set(
                    e.target.value
                      .split(/[,、]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  ),
                ];
                updateState((s) => ({
                  ...s,
                  tags: { ...s.tags, [target]: tags },
                }));
              }}
            />
          </label>
          <p className="muted">
            タグは入力欄から離れると保存され、絞り込みに使えます。
          </p>
        </Modal>
      )}
      {panel === "edit" && selected && activeQ && activeAnswers && (
        <Editor
          question={activeQ}
          answers={activeAnswers}
          original={selected.source}
          originalAnswers={selected.answers}
          onClose={() => setPanel("")}
          onSave={(question, answers) => {
            pending.current = capture();
            updateState((s) => ({
              ...s,
              edits: { ...s.edits, [target]: { question, answers } },
            }));
            setPanel("");
            setToast("原本を残して、編集内容を保存しました");
          }}
        />
      )}
      {panel === "history" && (
        <Modal
          title={target ? "この問題の間違い履歴" : "学習履歴"}
          onClose={() => setPanel("")}
        >
          <p className="muted">日時はすべて日本時間（JST）です。</p>
          {!target && (
            <>
              <div className="stats-grid">
                <div>
                  <b>{state.mistakes.length}</b>
                  <small>間違い記録</small>
                </div>
                <div>
                  <b>{state.sessions.length}</b>
                  <small>学習セッション</small>
                </div>
                <div>
                  <b>{Object.values(state.flags).filter(Boolean).length}</b>
                  <small>注意マーク</small>
                </div>
              </div>
              <div className="period-buttons">
                {[
                  ["today", "今日"],
                  ["previous", "前回"],
                  ["7", "7日間"],
                  ["30", "30日間"],
                  ["all", "全期間"],
                ].map(([v, t]) => (
                  <button
                    key={v}
                    onClick={() =>
                      applyFilters({
                        ...defaultFilters,
                        period: v as Filters["period"],
                      })
                    }
                  >
                    {t}の復習
                  </button>
                ))}
              </div>
              <details>
                <summary>セッション一覧</summary>
                {[...state.sessions].reverse().map((s) => (
                  <div key={s.id} className="session-row">
                    <b>{formatJapaneseDate(s.startedAt)}</b>
                    <small>
                      {s.endedAt
                        ? `終了 ${formatJapaneseDate(s.endedAt)}`
                        : "学習中"}{" "}
                      · 閲覧 {s.viewed.length}問 · 間違い{" "}
                      {
                        state.mistakes.filter((m) => m.sessionId === s.id)
                          .length
                      }
                      回
                    </small>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const s = newSession(state);
                    sessionId.current = s.sessions.at(-1)!.id;
                    updateState(() => s);
                    setToast("新しい学習セッションを始めました");
                  }}
                >
                  新しいセッションを始める
                </button>
              </details>
              <hr />
            </>
          )}
          {!state.mistakes.filter((m) => !target || m.questionId === target)
            .length && <p className="empty">まだ間違いの記録がありません。</p>}
          {[...state.mistakes]
            .reverse()
            .filter((m) => !target || m.questionId === target)
            .map((m) => {
              const q = questions.find((q) => q.id === m.questionId);
              return (
                <div className="history-row" key={m.id}>
                  <button
                    className="history-link"
                    onClick={() => {
                      pending.current = { id: m.questionId, offset: 150 };
                      updateState((s) => ({
                        ...s,
                        filters: { ...defaultFilters },
                      }));
                      setPanel("");
                    }}
                  >
                    <small>
                      p.{q?.pageNumber} · {q?.chapter}
                    </small>
                    <b>{formatJapaneseDate(m.at)}</b>
                  </button>
                  <label className="date-edit">
                    日時を編集
                    <input
                      aria-label="記録日時"
                      type="datetime-local"
                      step="1"
                      defaultValue={new Date(Date.parse(m.at) + 9 * 3600000)
                        .toISOString()
                        .slice(0, 19)}
                      onBlur={(e) => {
                        const date = new Date(`${e.target.value}+09:00`);
                        if (Number.isFinite(+date))
                          updateState((s) => ({
                            ...s,
                            mistakes: s.mistakes.map((x) =>
                              x.id === m.id
                                ? { ...x, at: date.toISOString() }
                                : x,
                            ),
                          }));
                        else setError("日時を正しく入力してください");
                      }}
                    />
                  </label>
                  <button
                    className="danger"
                    onClick={() => {
                      if (confirm("この1回の間違い記録を削除しますか？"))
                        updateState((s) => ({
                          ...s,
                          mistakes: s.mistakes.filter((x) => x.id !== m.id),
                        }));
                    }}
                  >
                    削除
                  </button>
                </div>
              );
            })}
        </Modal>
      )}
      {panel === "settings" && (
        <Modal title="設定・データ管理" onClose={() => setPanel("")}>
          <h3>読みやすさ</h3>
          <label>
            本文の文字サイズ <b>{state.settings.fontSize}px</b>
            <input
              type="range"
              min="14"
              max="24"
              value={state.settings.fontSize}
              onChange={(e) => {
                pending.current = capture();
                updateState((s) => ({
                  ...s,
                  settings: { fontSize: Number(e.target.value) },
                }));
              }}
            />
          </label>
          <h3>バックアップ</h3>
          <p className="muted">
            記録はこの端末・このURLのブラウザ内に保存されます。定期的にバックアップを保存してください。
          </p>
          <button
            className="wide-button primary"
            onClick={() =>
              download(
                `日本史の栞-backup-${new Date().toISOString().slice(0, 10)}.json`,
                exportBackup(data, stateRef.current!),
              )
            }
          >
            <Download size={18} /> 全データをJSONで保存
          </button>
          <label className="file-button">
            <Upload size={18} /> バックアップから復元
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                if (e.target.files?.[0])
                  void readFile(e.target.files[0], "backup");
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="wide-button"
            disabled={importBusy}
            onClick={() => void undoRestore()}
          >
            <RotateCcw size={16} /> 直前の復元を取り消す
          </button>
          <h3>教材の追加・再取り込み</h3>
          <p className="muted">
            同じIDの内容が異なる場合は、現在の教材を保持して競合を報告します。編集と学習履歴は保持します。
          </p>
          <label className="file-button">
            <Upload size={18} /> 教材JSONを選ぶ
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                if (e.target.files?.[0])
                  void readFile(e.target.files[0], "dataset");
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="wide-button"
            onClick={() =>
              download("教材原本.json", JSON.stringify(data, null, 2))
            }
          >
            現在の教材原本を保存
          </button>
          <button className="wide-button" onClick={() => setPanel("audit")}>
            教材の収録状況・要確認事項
          </button>
          <h3>iPhoneでアプリとして使う</h3>
          <p>
            Safariで開き、共有ボタン
            →「ホーム画面に追加」→「追加」。一度オンラインで読み込むと、オフラインでも学習できます。
          </p>
          <button
            className="wide-button"
            onClick={async () => {
              const granted = await navigator.storage?.persist?.();
              setToast(
                granted
                  ? "永続ストレージの使用が許可されました"
                  : "保存保護の可否はブラウザが管理します",
              );
            }}
          >
            ブラウザに保存領域の保護をリクエスト
          </button>
          <p className="muted">
            日本史の栞 v1.1.0 · 教材{" "}
            {data.dataset_version || data.schema_version}
          </p>
        </Modal>
      )}
      {panel === "audit" && (
        <Modal title="教材の収録状況" onClose={() => setPanel("")}>
          <div className="notice">
            <b>原本との照合が未完了の教材です</b>
            <p>{data.quality_note}</p>
            <p>
              アプリは提供JSONの内容を保持します。原書画像がないため、原書との一致は検証していません。
            </p>
          </div>
          <p>
            {data.pages.length}ページ / {questions.length}問 /{" "}
            {data.answers.length}解答 / {data.tables?.length ?? 0}図表
          </p>
          <h3>解析で検出した事項</h3>
          {audit?.errors.map((e, i) => (
            <p className="error" key={i}>
              {e}
            </p>
          ))}
          {audit?.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          <h3>教材に記録された要確認事項（{data.review_issues?.length}件）</h3>
          {data.review_issues?.map((issue) => (
            <div className="audit-issue" key={issue.id}>
              <small>
                {issue.page_id} {issue.severity}
              </small>
              <p>{issue.reason || textValue(issue)}</p>
            </div>
          ))}
        </Modal>
      )}
      {importPreview && (
        <Modal
          title={
            importPreview.kind === "backup"
              ? "バックアップ復元の確認"
              : "教材取り込みの確認"
          }
          onClose={() => setImportPreview(undefined)}
        >
          <p>
            {importPreview.value.dataset.questions.length}問 /{" "}
            {importPreview.value.state.mistakes.length}件の間違い記録
          </p>
          {importPreview.kind === "backup" ? (
            <div className="notice">
              現在の教材・編集・学習記録を置き換えます。復元直前のデータは自動退避され、「直前の復元を取り消す」で戻せます。
            </div>
          ) : (
            <p>
              追加 {importPreview.added}件、競合{" "}
              {importPreview.conflicts.length}
              件。競合したデータは上書きしません。
            </p>
          )}
          {importPreview.conflicts.length > 0 && (
            <>
              <button
                onClick={() =>
                  download(
                    "教材取り込み-競合一覧.json",
                    JSON.stringify(importPreview.conflicts, null, 2),
                  )
                }
              >
                競合一覧を保存
              </button>
              <div className="conflict-list">
                {importPreview.conflicts.map((c, i) => (
                  <p key={i}>{c}</p>
                ))}
              </div>
            </>
          )}
          <div className="modal-actions">
            <button onClick={() => setImportPreview(undefined)}>
              キャンセル
            </button>
            <button
              className="primary"
              disabled={importBusy}
              onClick={() => void acceptImport()}
            >
              {importPreview.kind === "backup"
                ? "この内容で復元する"
                : "競合を保持して取り込む"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
