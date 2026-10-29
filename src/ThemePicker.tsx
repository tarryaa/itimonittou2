export type ThemeChoice = "classic" | "aqua-dark" | "aqua-light";

type Props = { value: ThemeChoice; onChange: (theme: ThemeChoice) => void };
const choices: { id: ThemeChoice; label: string; description: string }[] = [
  {
    id: "classic",
    label: "栞（オリジナル）",
    description: "落ち着いた緑と、紙のような読み心地。",
  },
  {
    id: "aqua-dark",
    label: "アクア・ダーク",
    description: "深い青緑とシアン。暗い場所でも心地よく。",
  },
  {
    id: "aqua-light",
    label: "アクア・ライト",
    description: "広がる白とシアン。明るく、すっきり。",
  },
];

export default function ThemePicker({ value, onChange }: Props) {
  return (
    <div
      className="theme-picker"
      role="radiogroup"
      aria-label="表示テーマ"
      onKeyDown={(event) => {
        const current = choices.findIndex((choice) => choice.id === value);
        const next =
          event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (current + 1) % choices.length
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? (current + choices.length - 1) % choices.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? choices.length - 1
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        onChange(choices[next].id);
        event.currentTarget
          .querySelectorAll<HTMLButtonElement>('[role="radio"]')
          [next]?.focus();
      }}
    >
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          className={`theme-option ${value === choice.id ? "is-selected" : ""}`}
          role="radio"
          aria-label={choice.label}
          aria-checked={value === choice.id}
          aria-describedby={`theme-description-${choice.id}`}
          tabIndex={value === choice.id ? 0 : -1}
          onClick={() => onChange(choice.id)}
        >
          <span
            className={`theme-swatch theme-swatch-${choice.id}`}
            aria-hidden="true"
          >
            <span className="theme-swatch-heading" />
            <span className="theme-swatch-card">
              <i />
              <i />
              <i />
            </span>
            <span className="theme-swatch-nav">
              <i />
              <i />
              <i />
            </span>
            {value === choice.id && <span className="theme-check">✓</span>}
          </span>
          <span className="theme-option-label">{choice.label}</span>
          <span
            className="theme-option-description"
            id={`theme-description-${choice.id}`}
          >
            {choice.description}
          </span>
        </button>
      ))}
    </div>
  );
}
