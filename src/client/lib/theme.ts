// Light, dark, or follow the device ("auto"). Remembered per device.
export type Theme = "auto" | "light" | "dark";
const KEY = "theme";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "auto") delete root.dataset.theme;
  else root.dataset.theme = t;
  const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e0c0e" : "#1a1a1a");
}

export function setTheme(t: Theme) {
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* private mode: still applies for this visit */ }
  applyTheme(t);
}

export const nextTheme = (t: Theme): Theme => (t === "auto" ? "light" : t === "light" ? "dark" : "auto");
export const themeLabel = (t: Theme) => (t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark");
