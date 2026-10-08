/**
 * Visitor counter for nsquaredzz.github.io. A Cloudflare Worker with a D1 (SQLite) database.
 *
 *   POST /hit      the site reports a page view; answers with the public counts
 *   GET  /public   the public counts, without recording anything
 *   GET  /stats    history, pages, referrers and countries. Needs the admin token
 *
 * What counts as a person: a hash of (secret salt, date, IP address, browser string). The date is
 * part of the hash, so the same person gets a new hash every day and cannot be followed from one
 * day to the next. The IP address is never stored. No cookies are set.
 *
 * So "visitors today" is people, and the all-time number is visits: one person on one day.
 */

export interface Env {
  DB: D1Database;
  SALT: string;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGINS: string;
  /** Set to "1" only by the test suite: lets a request choose the current time. */
  TEST_MODE?: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_VIEWS_PER_VISITOR = 300;   // per day; anything beyond is ignored
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|undici|scrapy|phantom|puppeteer|playwright|facebookexternalhit|embedly|whatsapp|telegram|discord|slack/i;

/** Calendar day in India, where the site's clock lives. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two strings without leaking where they differ. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** "/blog/escaping-flatland/" stays; anything odd becomes "/other". */
export function cleanPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  const path = raw.split(/[?#]/)[0].slice(0, 120);
  return /^\/[A-Za-z0-9\-._~/]*$/.test(path) ? path : "/other";
}

/** Referrer reduced to a host name: "linkedin.com", or "direct" for none or for the site itself. */
export function cleanReferrer(raw: unknown, ownOrigin: string): string {
  if (typeof raw !== "string" || !raw) return "direct";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "direct";
    if (u.origin === ownOrigin) return "direct";
    const host = u.hostname.toLowerCase().replace(/^www\./, "").slice(0, 80);
    return /^[a-z0-9.-]+$/.test(host) ? host : "other";
  } catch {
    return "direct";
  }
}

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return allowed.includes(origin) ? origin : null;
}

function json(data: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

function now(req: Request, env: Env): number {
  if (env.TEST_MODE === "1") {
    const t = Number(req.headers.get("x-test-now"));
    if (Number.isFinite(t) && t > 0) return t;
  }
  return Date.now();
}

const PUBLIC_COUNTS =
  "SELECT (SELECT visitors FROM daily WHERE day = ?1) AS today, COALESCE(SUM(visitors), 0) AS total, MIN(day) AS since FROM daily";

interface PublicRow { today: number | null; total: number; since: string | null }

function publicShape(row: PublicRow | null, day: string) {
  return { day, today: row?.today ?? 0, total: row?.total ?? 0, since: row?.since ?? day };
}

async function hit(req: Request, env: Env, origin: string): Promise<Response> {
  const day = istDay(now(req, env));
  const ua = req.headers.get("User-Agent") ?? "";
  const prefetch = (req.headers.get("Sec-Purpose") ?? req.headers.get("Purpose") ?? "").includes("prefetch");

  let body: { path?: unknown; ref?: unknown } = {};
  try { body = JSON.parse((await req.text()).slice(0, 2000)); } catch { /* counted as the home page */ }
  const path = cleanPath(body.path);
  const ref = cleanReferrer(body.ref, origin);

  if (!ua || BOT.test(ua) || prefetch) {
    const row = await env.DB.prepare(PUBLIC_COUNTS).bind(day).first<PublicRow>();
    return json({ ...publicShape(row, day), counted: false }, 200, origin);
  }

  const ip = req.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
  const visitor = (await sha256(`${env.SALT}|${day}|${ip}|${ua}`)).slice(0, 24);
  const country = ((req as unknown as { cf?: { country?: string } }).cf?.country ?? "??").slice(0, 2).toUpperCase();

  // Have we seen this person today, on the site and on this page? RETURNING n tells us: 1 means new.
  const see = "INSERT INTO seen (day, visitor, scope, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT (day, visitor, scope) DO UPDATE SET n = n + 1 RETURNING n";
  const [site, page] = await env.DB.batch<{ n: number }>([
    env.DB.prepare(see).bind(day, visitor, "*"),
    env.DB.prepare(see).bind(day, visitor, path),
  ]);
  const siteViews = site.results[0]?.n ?? 1;
  const newVisitor = siteViews === 1 ? 1 : 0;
  const newOnPage = (page.results[0]?.n ?? 1) === 1 ? 1 : 0;

  if (siteViews > MAX_VIEWS_PER_VISITOR) {
    const row = await env.DB.prepare(PUBLIC_COUNTS).bind(day).first<PublicRow>();
    return json({ ...publicShape(row, day), counted: false }, 200, origin);
  }

  const writes = [
    env.DB.prepare("INSERT INTO daily (day, visitors, views) VALUES (?1, ?2, 1) ON CONFLICT (day) DO UPDATE SET visitors = visitors + ?2, views = views + 1").bind(day, newVisitor),
    env.DB.prepare("INSERT INTO pages (day, path, visitors, views) VALUES (?1, ?2, ?3, 1) ON CONFLICT (day, path) DO UPDATE SET visitors = visitors + ?3, views = views + 1").bind(day, path, newOnPage),
  ];
  if (newVisitor) {
    writes.push(
      env.DB.prepare("INSERT INTO referrers (day, host, visitors) VALUES (?1, ?2, 1) ON CONFLICT (day, host) DO UPDATE SET visitors = visitors + 1").bind(day, ref),
      env.DB.prepare("INSERT INTO countries (day, country, visitors) VALUES (?1, ?2, 1) ON CONFLICT (day, country) DO UPDATE SET visitors = visitors + 1").bind(day, country),
    );
  }
  writes.push(env.DB.prepare(PUBLIC_COUNTS).bind(day));
  const results = await env.DB.batch<PublicRow>(writes);
  const row = results[results.length - 1].results[0] ?? null;
  return json({ ...publicShape(row, day), counted: true }, 200, origin);
}

async function publicCounts(req: Request, env: Env, origin: string | null): Promise<Response> {
  const day = istDay(now(req, env));
  const row = await env.DB.prepare(PUBLIC_COUNTS).bind(day).first<PublicRow>();
  return json(publicShape(row, day), 200, origin);
}

async function stats(req: Request, env: Env, origin: string | null): Promise<Response> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.ADMIN_TOKEN || !token || !(await sameSecret(token, env.ADMIN_TOKEN))) {
    return json({ error: "unauthorised" }, 401, origin);
  }
  const day = istDay(now(req, env));
  const asked = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = Math.min(365, Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 30));
  const from = addDays(day, -(days - 1));

  const [daily, pages, referrers, countries, total] = await env.DB.batch<Record<string, string | number | null>>([
    env.DB.prepare("SELECT day, visitors, views FROM daily WHERE day >= ?1 AND day <= ?2 ORDER BY day").bind(from, day),
    env.DB.prepare("SELECT path, SUM(views) AS views, SUM(visitors) AS visitors FROM pages WHERE day >= ?1 AND day <= ?2 GROUP BY path ORDER BY views DESC, path LIMIT 25").bind(from, day),
    env.DB.prepare("SELECT host, SUM(visitors) AS visitors FROM referrers WHERE day >= ?1 AND day <= ?2 GROUP BY host ORDER BY visitors DESC, host LIMIT 25").bind(from, day),
    env.DB.prepare("SELECT country, SUM(visitors) AS visitors FROM countries WHERE day >= ?1 AND day <= ?2 GROUP BY country ORDER BY visitors DESC, country LIMIT 25").bind(from, day),
    env.DB.prepare("SELECT COALESCE(SUM(visitors), 0) AS visits, COALESCE(SUM(views), 0) AS views, MIN(day) AS since FROM daily"),
  ]);

  // a row for every day in the window, including the quiet ones
  const byDay = new Map(daily.results.map((r) => [r.day as string, r]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const r = byDay.get(d);
    series.push({ day: d, visitors: Number(r?.visitors ?? 0), views: Number(r?.views ?? 0) });
  }
  const window = series.reduce((a, r) => ({ visits: a.visits + r.visitors, views: a.views + r.views }), { visits: 0, views: 0 });

  return json({
    day,
    days,
    today: series[series.length - 1],
    window,
    total: { visits: Number(total.results[0]?.visits ?? 0), views: Number(total.results[0]?.views ?? 0), since: (total.results[0]?.since as string | null) ?? day },
    daily: series,
    pages: pages.results,
    referrers: referrers.results,
    countries: countries.results,
  }, 200, origin);
}

/** Forget visitor hashes from before yesterday. After this, only counts remain for those days. */
async function forget(env: Env, ms: number): Promise<number> {
  const keepFrom = addDays(istDay(ms), -1);
  const r = await env.DB.prepare("DELETE FROM seen WHERE day < ?1").bind(keepFrom).run();
  return r.meta.changes ?? 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = allowedOrigin(req, env);

    if (req.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin",
        },
      });
    }

    try {
      if (url.pathname === "/hit" && req.method === "POST") {
        if (!origin) return json({ error: "origin not allowed" }, 403, null);
        return await hit(req, env, origin);
      }
      if (url.pathname === "/public" && req.method === "GET") return await publicCounts(req, env, origin);
      if (url.pathname === "/stats" && req.method === "GET") return await stats(req, env, origin);
      if (url.pathname === "/" && req.method === "GET") return json({ service: "nsquaredzz-stats", ok: true }, 200, origin);
      if (env.TEST_MODE === "1" && url.pathname === "/__forget" && req.method === "POST") {
        return json({ deleted: await forget(env, now(req, env)) }, 200, origin);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (e) {
      console.error(e);
      return json({ error: "unavailable" }, 503, origin);
    }
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await forget(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
