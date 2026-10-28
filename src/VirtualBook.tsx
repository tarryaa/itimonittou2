import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { Position } from "./store";
import type { StudyQuestion } from "./model";

export interface BookHandle {
  restore(position: Position): void;
  isRestoring(): boolean;
}
interface Props {
  items: StudyQuestion[];
  renderRow: (item: StudyQuestion, index: number) => ReactNode;
  layoutKey: number | string;
}

/** Keep the whole book's scroll extent, mounting only nearby questions. */
const VirtualBook = memo(
  forwardRef<BookHandle, Props>(function VirtualBook(
    { items, renderRow, layoutKey },
    ref,
  ) {
    const root = useRef<HTMLDivElement>(null);
    const [margin, setMargin] = useState(0);
    const frame = useRef(0);
    const restoring = useRef(false);
    const restoreRef = useRef<((position: Position) => void) | undefined>(
      undefined,
    );
    const key = useCallback((index: number) => items[index].id, [items]);
    const estimate = useCallback(
      (index: number) => {
        const q = items[index];
        // Only unmounted rows use estimates. Every mounted row is measured.
        return (
          (q.source.kind === "subquestion" ? 190 : 270) +
          q.source.notes.length * 65 +
          q.tables.length * 130 +
          (!index || q.chapter !== items[index - 1].chapter ? 90 : 0)
        );
      },
      [items],
    );
    const virtualizer = useWindowVirtualizer({
      count: items.length,
      estimateSize: estimate,
      getItemKey: key,
      overscan: 4,
      scrollMargin: margin,
      useAnimationFrameWithResizeObserver: true,
      directDomUpdates: true,
      directDomUpdatesMode: "position",
    });
    const finish = useCallback(() => {
      cancelAnimationFrame(frame.current);
      const wasRestoring = restoring.current;
      restoring.current = false;
      if (root.current) root.current.dataset.restoring = "false";
      if (wasRestoring) window.dispatchEvent(new Event("bookpositionchange"));
    }, []);
    const restore = useCallback(
      (position: Position) => {
        finish();
        const index = items.findIndex((q) => q.id === position.id);
        if (index < 0) return;
        restoring.current = true;
        if (root.current) root.current.dataset.restoring = "true";
        const find = () =>
          root.current?.querySelector<HTMLElement>(
            `[data-qid="${CSS.escape(position.id)}"]`,
          );
        const mountTarget = () => {
          const approximate =
            virtualizer.getOffsetForIndex(index, "start")?.[0] ??
            margin + index * 260;
          // Mount/measure first. A large negative offset inside a long question must
          // not jump past its still-estimated height and prevent the row mounting.
          window.scrollTo({
            top: Math.max(0, approximate - Math.max(0, position.offset)),
            behavior: "auto",
          });
        };
        if (!find()) mountTarget();
        let tries = 0,
          stable = 0;
        const adjust = () => {
          if (!restoring.current) return;
          const el = find();
          if (el) {
            const delta = el.getBoundingClientRect().top - position.offset;
            if (Math.abs(delta) > 0.75) {
              const before = window.scrollY;
              window.scrollBy({ top: delta, behavior: "auto" });
              stable = Math.abs(window.scrollY - before) < 0.5 ? stable + 1 : 0;
            } else stable++;
          } else if (tries % 5 === 0) mountTarget();
          if (stable >= 4 || ++tries >= 40) {
            finish();
            return;
          }
          frame.current = requestAnimationFrame(adjust);
        };
        frame.current = requestAnimationFrame(adjust);
      },
      [items, margin, virtualizer, finish],
    );
    restoreRef.current = restore;
    useImperativeHandle(
      ref,
      () => ({ isRestoring: () => restoring.current, restore }),
      [restore],
    );
    useLayoutEffect(() => {
      let width = window.innerWidth;
      const resize = () => {
        if (!root.current) return;
        const current = Array.from(
          root.current.querySelectorAll<HTMLElement>("[data-qid]"),
        ).find((el) => el.getBoundingClientRect().bottom > 128);
        const anchor = current
          ? {
              id: current.dataset.qid!,
              offset: current.getBoundingClientRect().top,
            }
          : undefined;
        setMargin(root.current.getBoundingClientRect().top + window.scrollY);
        if (width !== window.innerWidth) {
          width = window.innerWidth;
          virtualizer.measure();
          if (anchor) requestAnimationFrame(() => restoreRef.current?.(anchor));
        }
      };
      resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, [virtualizer]);
    useLayoutEffect(() => {
      virtualizer.measure();
    }, [layoutKey, virtualizer]);
    useLayoutEffect(() => {
      window.addEventListener("touchstart", finish, { passive: true });
      window.addEventListener("wheel", finish, { passive: true });
      return () => {
        finish();
        window.removeEventListener("touchstart", finish);
        window.removeEventListener("wheel", finish);
      };
    }, [finish]);
    return (
      <div
        ref={root}
        className="questions virtual-book"
        aria-label="教材一覧"
        data-question-count={items.length}
        data-restoring="false"
      >
        {/* Direct DOM mode owns the height and row top, avoiding scroll-only React renders. */}
        <div
          ref={virtualizer.containerRef}
          style={{ position: "relative", width: "100%" }}
        >
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="virtual-row"
              style={{
                position: "absolute",
                left: 0,
                width: "100%",
                display: "flow-root",
              }}
            >
              {renderRow(items[row.index], row.index)}
            </div>
          ))}
        </div>
      </div>
    );
  }),
);
export default VirtualBook;
