// Applied as a `dark` class on <html> (see index.css's `.dark` block and
// tailwind.config.js's `darkMode: "class"`), not a bare `prefers-color-scheme`
// media query — that way an explicit choice here always wins over whatever
// the OS is set to, while still defaulting to the system preference for
// anyone who's never touched the setting.

const STORAGE_KEY = "theme";

export type Theme = "light" | "dark";

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

export function getEffectiveTheme(): Theme {
  return readStoredTheme() ?? (systemPrefersDark() ? "dark" : "light");
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Explicitly sets and remembers a theme, overriding the system default. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
  applyTheme(theme);
}

/** Call once, as early as possible (before first paint), to avoid a flash of the wrong theme. */
export function initTheme() {
  applyTheme(getEffectiveTheme());
}
