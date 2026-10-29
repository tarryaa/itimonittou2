import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { Answer, Segment, Style } from "./model";
import "./answers.css";

const graphemes =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ja", { granularity: "grapheme" })
    : null;

type Props = {
  segments: Segment[];
  answers: Answer[];
  allVisible: boolean;
  revealed: Set<string>;
  onToggle: (id: string) => void;
};

export function segmentStyle(style?: Style): CSSProperties {
  if (!style) return {};
  const fontSize =
    style.size === "small"
      ? "max(12px, .84em)"
      : style.size === "large"
        ? "1.16em"
        : undefined;
  const indent =
    typeof style.indent === "number"
      ? `${Math.max(0, Math.min(10, style.indent))}em`
      : typeof style.indent === "string" &&
          /^\d+(\.\d+)?(em|px|rem)$/.test(style.indent)
        ? style.indent
        : undefined;
  return {
    fontSize,
    fontWeight: style.bold ? 700 : undefined,
    textDecoration: style.underline ? "underline" : undefined,
    marginInlineStart: indent,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };
}

function Blank({
  segment,
  answer,
  open,
  allVisible,
  onToggle,
}: {
  segment: Segment;
  answer?: Answer;
  open: boolean;
  allVisible: boolean;
  onToggle: () => void;
}) {
  // Reserve the same text area in every mode so revealing answers never moves surrounding text.
  const reserve = answer?.fill_text?.trim()
    ? answer.fill_text
    : answer?.text?.trim()
      ? answer.text
      : "解答未登録";
  const visible = open || allVisible;
  const letters = useMemo(() => {
    // Keep combining characters together. Long user-authored answers use a single
    // fading run rather than creating an unbounded set of animated elements.
    const parts: string[] = [];
    const characters = graphemes ? graphemes.segment(reserve) : reserve.replace(/\r\n/g, "\n");
    for (const part of characters) {
      if (parts.length === 36) return null;
      parts.push(typeof part === "string" ? part : part.segment);
    }
    return parts;
  }, [reserve]);
  return (
    <span
      className="blank-wrap"
      style={{
        display: "inline-block",
        maxWidth: "100%",
        verticalAlign: "baseline",
      }}
    >
      <button
        type="button"
        className={`blank inline-answer ${allVisible ? "bulk-visible" : ""} ${open ? "is-open" : ""} ${visible ? "is-revealed" : ""}`}
        data-revealed={visible}
        aria-label={
          allVisible
            ? `解答：${reserve}`
            : visible
              ? `${answer ? `解答：${reserve}` : "解答未登録"}。タップして隠す`
              : `空欄の解答を表示、重要度${segment.stars ?? 0}`
        }
        aria-description={
          visible && answer?.text?.trim() && answer.text !== reserve
            ? `解答全文：${answer.text}`
            : undefined
        }
        aria-expanded={visible}
        onClick={onToggle}
        style={{
          ...segmentStyle(segment.style),
          maxWidth: "100%",
          position: "relative",
          verticalAlign: "baseline",
        }}
      >
        <span
          className="blank-reserve"
          aria-hidden="true"
          style={{
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {letters ? (
            letters.map((letter, index) =>
              /[\r\n]/.test(letter) ? (
                <br key={index} />
              ) : (
                <span
                  className="blank-letter"
                  key={index}
                  style={
                    { "--letter-index": Math.min(index, 12) } as CSSProperties
                  }
                >
                  {letter}
                </span>
              ),
            )
          ) : (
            <span className="blank-letter blank-run">{reserve}</span>
          )}
        </span>
        <span
          className="blank-stars"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {"★".repeat(Math.max(0, Math.min(3, segment.stars ?? 0))) || "…"}
        </span>
      </button>
    </span>
  );
}

export function Segments({
  segments,
  answers,
  allVisible,
  revealed,
  onToggle,
}: Props) {
  return (
    <>
      {segments.map((segment) => {
        const style = segmentStyle(segment.style);
        if (segment.type === "blank") {
          // Resolve by the explicit answer ID only; never use position or infer another question's answer.
          const answer = answers.find(
            (candidate) =>
              candidate.id === segment.answer_id &&
              candidate.blank_id === segment.id,
          );
          return (
            <Blank
              key={segment.id}
              segment={segment}
              answer={answer}
              open={revealed.has(segment.id)}
              allVisible={allVisible}
              onToggle={() => onToggle(segment.id)}
            />
          );
        }
        if (segment.type === "line_break" || segment.type === "break")
          return <br key={segment.id} />;
        if (segment.type === "red_text" || segment.style?.color === "red") {
          const visible = allVisible || revealed.has(segment.id);
          return (
            <button
              key={segment.id}
              type="button"
              className={`red-segment ${visible ? "revealed" : "masked"}`}
              style={{
                ...style,
                color: visible ? "var(--red, #a53636)" : "transparent",
              }}
              aria-label={
                visible ? `${segment.text ?? ""}を隠す` : "赤字を表示"
              }
              aria-pressed={visible}
              onClick={() => onToggle(segment.id)}
            >
              <span aria-hidden={!visible}>{segment.text ?? ""}</span>
            </button>
          );
        }
        return (
          <span key={segment.id} style={style}>
            {segment.text ?? ""}
          </span>
        );
      })}
    </>
  );
}
