/**
 * Visitor counting. When a page opens, the site tells a small backend (worker/, a Cloudflare
 * Worker) which page it was, and gets two public numbers back: people today, and visits so far.
 * Nothing is stored in the visitor's browser and no cookie is set.
 */
import content from "./content.json";

const DEV_API = import.meta.env.VITE_STATS_API;
const API = (DEV_API ?? (content as { statsApi?: string }).statsApi ?? "").replace(/\/+$/, "");

export interface Counts { day: string; today: number; total: number; since: string }

/** Base address of the backend, or "" when none is connected. */
export const statsApi = API;
export const statsOn = API !== "";

const KEY = "nostats";

/** True when this browser has asked not to be counted (the site owner, mostly). */
export function ignored(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setIgnored(on: boolean) {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

function shouldCount(): boolean {
  if (ignored()) return false;
  if (navigator.webdriver) return false;   // automated browsers: tests, screenshots
  if (!DEV_API && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return false;
  return true;
}

async function ask(path: string, init?: RequestInit): Promise<Counts | null> {
  try {
    const r = await fetch(API + path, init);
    return r.ok ? ((await r.json()) as Counts) : null;
  } catch {
    return null;   // the counter being down must never break the page
  }
}

/** The public numbers, without counting anything. */
export function publicCounts(): Promise<Counts | null> {
  return statsOn ? ask("/public") : Promise.resolve(null);
}

let reported: Promise<Counts | null> | null = null;

/** Report this page view, once per page load, and return the public numbers. Never throws. */
export function recordVisit(): Promise<Counts | null> {
  if (!statsOn) return Promise.resolve(null);
  if (!reported) {
    const plain = new URLSearchParams(location.search).has("plain");
    const body = JSON.stringify({ path: location.pathname + (plain ? "plain" : ""), ref: document.referrer });
    // a string body is sent as text/plain, which browsers allow cross-site without a preflight request
    reported = shouldCount() ? ask("/hit", { method: "POST", body, keepalive: true }) : publicCounts();
  }
  return reported;
}
