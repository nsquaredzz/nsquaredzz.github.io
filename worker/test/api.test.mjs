// End-to-end tests against a local copy of the worker (wrangler dev, local D1). No Cloudflare account needed.
//   npm test
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".wrangler", "test-state");
const PORT = 8799;
const base = `http://127.0.0.1:${PORT}`;
const SITE = "https://nsquaredzz.github.io";
const TOKEN = "test-admin-token";
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
let server;

const DAY = 86400000;
const T0 = Date.parse("2026-03-10T06:00:00Z");          // 11:30 IST on 10 March
const person = (n) => `Mozilla/5.0 (Macintosh) TestBrowser/1.0 person-${n}`;

/** One page view. `who` picks the visitor, `at` the moment. */
async function hit({ who = 1, at = T0, pagePath = "/", ref = "", origin = SITE, ua, headers = {} } = {}) {
  const r = await fetch(`${base}/hit`, {
    method: "POST",
    headers: { Origin: origin, "User-Agent": ua ?? person(who), "x-test-now": String(at), ...headers },
    body: JSON.stringify({ path: pagePath, ref }),
  });
  return { status: r.status, cors: r.headers.get("access-control-allow-origin"), body: await r.json() };
}

async function stats({ at = T0, days = 30, token = TOKEN } = {}) {
  const r = await fetch(`${base}/stats?days=${days}`, { headers: { Authorization: `Bearer ${token}`, Origin: SITE, "x-test-now": String(at) } });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  fs.rmSync(state, { recursive: true, force: true });
  execFileSync(wrangler, ["d1", "migrations", "apply", "nsquaredzz-stats", "--local", "--persist-to", state], { cwd: root, stdio: "pipe", env: { ...process.env, CI: "1" } });
  server = spawn(wrangler, ["dev", "--port", String(PORT), "--persist-to", state, "--show-interactive-dev-session=false",
    "--var", "SALT:test-salt", "--var", `ADMIN_TOKEN:${TOKEN}`, "--var", "TEST_MODE:1", "--var", `ALLOWED_ORIGINS:${SITE},http://localhost:5173`],
    { cwd: root, stdio: "pipe", env: { ...process.env, CI: "1" } });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + "/")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("worker did not start:\n" + log);
});

after(() => server?.kill());

test("an empty database answers zero", async () => {
  const r = await fetch(`${base}/public`, { headers: { "x-test-now": String(T0) } });
  assert.deepEqual(await r.json(), { day: "2026-03-10", today: 0, total: 0, since: "2026-03-10" });
});

test("one person loading three pages is one visitor and three views", async () => {
  await hit({ who: 1, pagePath: "/", ref: "https://www.linkedin.com/feed/" });
  await hit({ who: 1, pagePath: "/blog/escaping-flatland/" });
  const third = await hit({ who: 1, pagePath: "/" });
  assert.equal(third.status, 200);
  assert.equal(third.cors, SITE);
  assert.deepEqual(third.body, { day: "2026-03-10", today: 1, total: 1, since: "2026-03-10", counted: true });
  const s = (await stats()).body;
  assert.deepEqual(s.today, { day: "2026-03-10", visitors: 1, views: 3 });
  assert.deepEqual(s.pages, [{ path: "/", views: 2, visitors: 1 }, { path: "/blog/escaping-flatland/", views: 1, visitors: 1 }]);
  assert.deepEqual(s.referrers, [{ host: "linkedin.com", visitors: 1 }]);
});

test("a second person is a second visitor", async () => {
  const r = await hit({ who: 2, pagePath: "/blog/certified-skip/", ref: "https://news.ycombinator.com/item?id=1" });
  assert.equal(r.body.today, 2);
  assert.equal(r.body.total, 2);
});

test("the same person the next day counts as a new visit, and today starts again", async () => {
  const r = await hit({ who: 1, at: T0 + DAY });
  assert.equal(r.body.day, "2026-03-11");
  assert.equal(r.body.today, 1);
  assert.equal(r.body.total, 3);
});

test("days follow the clock in India", async () => {
  const lateEvening = Date.parse("2026-03-12T18:29:00Z");   // 23:59 IST on the 12th
  const afterMidnight = Date.parse("2026-03-12T18:31:00Z"); // 00:01 IST on the 13th
  assert.equal((await hit({ who: 5, at: lateEvening })).body.day, "2026-03-12");
  assert.equal((await hit({ who: 5, at: afterMidnight })).body.day, "2026-03-13");
});

test("bots, prefetches and empty browser strings are not counted", async () => {
  const before = (await hit({ who: 9, at: T0 + 5 * DAY })).body.total;
  for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "Mozilla/5.0 HeadlessChrome/120.0", "curl/8.4.0", "python-requests/2.31"]) {
    const r = await hit({ ua, at: T0 + 5 * DAY });
    assert.equal(r.body.counted, false, ua);
  }
  const prefetch = await hit({ who: 10, at: T0 + 5 * DAY, headers: { "Sec-Purpose": "prefetch;prerender" } });
  assert.equal(prefetch.body.counted, false);
  assert.equal((await hit({ who: 9, at: T0 + 5 * DAY })).body.total, before);
});

test("visits are only accepted from the site itself", async () => {
  const r = await hit({ who: 20, origin: "https://evil.example" });
  assert.equal(r.status, 403);
  assert.equal(r.cors, null);
  const none = await fetch(`${base}/hit`, { method: "POST", headers: { "User-Agent": person(21) }, body: "{}" });
  assert.equal(none.status, 403);
});

test("odd paths and referrers are tidied, never stored raw", async () => {
  const at = T0 + 7 * DAY;
  await hit({ who: 30, at, pagePath: "/blog/x/?utm=1#frag", ref: "javascript:alert(1)" });
  await hit({ who: 31, at, pagePath: "<script>alert(1)</script>", ref: `${SITE}/blog/` });
  await hit({ who: 32, at, pagePath: "/" + "a".repeat(500), ref: "not a url" });
  const s = (await stats({ at, days: 1 })).body;
  const paths = s.pages.map((p) => p.path).sort();
  assert.deepEqual(paths, ["/" + "a".repeat(119), "/blog/x/", "/other"]);
  assert.deepEqual(s.referrers, [{ host: "direct", visitors: 3 }]);
});

test("one visitor cannot inflate the view count without limit", async () => {
  const at = T0 + 9 * DAY;
  for (let i = 0; i < 31; i++) await Promise.all(Array.from({ length: 10 }, () => hit({ who: 40, at })));
  const s = (await stats({ at, days: 1 })).body;
  assert.equal(s.today.visitors, 1);
  assert.equal(s.today.views, 300);
});

test("the detailed numbers need the admin token", async () => {
  assert.equal((await stats({ token: "wrong" })).status, 401);
  assert.equal((await fetch(`${base}/stats`)).status, 401);
  const ok = await stats();
  assert.equal(ok.status, 200);
  assert.ok(!JSON.stringify(ok.body).includes("person-"), "no browser strings in the output");
});

test("history has a row for every day, quiet ones included", async () => {
  const s = (await stats({ at: T0 + DAY, days: 4 })).body;   // the four days ending 11 March
  assert.deepEqual(s.daily.map((d) => [d.day, d.visitors]), [["2026-03-08", 0], ["2026-03-09", 0], ["2026-03-10", 2], ["2026-03-11", 1]]);
  assert.deepEqual(s.window, { visits: 3, views: 5 });
  assert.ok(s.total.visits >= 3);
  assert.equal(s.total.since, "2026-03-10");
});

test("the browser may ask first (CORS preflight), other sites may not", async () => {
  const ok = await fetch(`${base}/stats`, { method: "OPTIONS", headers: { Origin: SITE, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
  assert.equal(ok.status, 204);
  assert.match(ok.headers.get("access-control-allow-headers"), /Authorization/);
  const no = await fetch(`${base}/stats`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(no.status, 403);
});

test("visitor hashes are forgotten after a day, the counts stay", async () => {
  const at = T0 + 20 * DAY;
  await hit({ who: 50, at });
  const before = (await stats({ at, days: 30 })).body.total.visits;
  const r = await fetch(`${base}/__forget`, { method: "POST", headers: { "x-test-now": String(at + 2 * DAY) } });
  const { deleted } = await r.json();
  assert.ok(deleted >= 2, `deleted ${deleted} rows`);
  assert.equal((await stats({ at, days: 30 })).body.total.visits, before);
  // with the hash gone, the same person on the same day would be counted again; that is the price of forgetting
  const again = await fetch(`${base}/__forget`, { method: "POST", headers: { "x-test-now": String(at + 2 * DAY) } });
  assert.equal((await again.json()).deleted, 0);
});

test("unknown routes are 404", async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/hit`)).status, 404);
});
