/**
 * Themes. `crt` (scanlines and glow) and `flat` are the dark looks, `light` is the paper one.
 * The choice lives in localStorage and on <html data-theme>, so the terminal, plain mode and the
 * blog pages all agree. A one-line script in each page's <head> applies it before the first paint.
 */
export type Theme = "crt" | "flat" | "light";

const KEY = "theme", KEY_DARK = "theme-dark";
const ORDER: Theme[] = ["crt", "flat", "light"];
const PAGE: Record<Theme, string> = { crt: "#0b0a08", flat: "#0b0a08", light: "#f5efe2" };

function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }   // private mode
}
function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ok */ }
}

export function getTheme(): Theme {
  const t = stored(KEY);
  return t === "flat" || t === "light" ? t : "crt";
}
export function isLight(): boolean { return document.documentElement.dataset.theme === "light"; }

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", PAGE[t]);
  dispatchEvent(new CustomEvent("themechange", { detail: t }));
}

/** Apply the stored theme on page load. */
export function initTheme(): Theme {
  const t = getTheme();
  apply(t);
  return t;
}

export function setTheme(t: Theme) {
  store(KEY, t);
  if (t !== "light") store(KEY_DARK, t);   // so that "dark" returns to the dark look last used
  apply(t);
}

export function nextTheme(t: Theme): Theme { return ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]; }

/** What a person types: crt, flat, light, or dark (the dark look last used). */
export function parseTheme(s: string): Theme | null {
  const a = s.toLowerCase();
  if (a === "crt" || a === "flat" || a === "light") return a;
  if (a === "dark") return stored(KEY_DARK) === "flat" ? "flat" : "crt";
  return null;
}

/** The other side: what the light/dark button would switch to. */
export function otherSide(): "light" | "dark" { return isLight() ? "dark" : "light"; }

/** Make `el` a light/dark switch that names the side it leads to. */
export function wireToggle(el: HTMLElement) {
  const label = () => {
    el.textContent = otherSide();
    el.setAttribute("aria-label", `switch to the ${otherSide()} theme`);
  };
  label();
  el.addEventListener("click", () => setTheme(parseTheme(otherSide())!));
  addEventListener("themechange", label);
}
