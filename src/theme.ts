import type { AppTheme } from "./store";
const HINT_KEY = "itimonittou-theme";
const colors: Record<AppTheme, string> = {
  classic: "#183d39",
  "aqua-dark": "#002e38",
  "aqua-light": "#f1f1f7",
};
export function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", colors[theme]);
  try {
    localStorage.setItem(HINT_KEY, theme);
  } catch {
    /* IndexedDB remains the source of truth. */
  }
}
export function restoreThemeHint() {
  try {
    const value = localStorage.getItem(HINT_KEY);
    if (value === "classic" || value === "aqua-dark" || value === "aqua-light")
      applyTheme(value);
  } catch {
    /* Default original palette remains available. */
  }
}
