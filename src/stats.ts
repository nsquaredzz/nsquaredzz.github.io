/**
 * The private visitor dashboard at /stats/. The page itself is public, but it shows nothing
 * until the admin token is entered; the token is kept in this browser only.
 */
import "./theme.css";
import "./paper.css";
import "./stats.css";
import { initTheme, wireToggle } from "./theme";
import { ignored, setIgnored, statsApi, statsOn } from "./visits";

initTheme();
for (const b of document.querySelectorAll<HTMLElement>(".p-theme")) wireToggle(b);

interface Day { day: string; visitors: number; views: number }
interface Stats {
  day: string;
  days: number;
  today: Day;
  window: { visits: number; views: number };
  total: { visits: number; views: number; since: string };
  daily: Day[];
  pages: { path: string; views: number; visitors: number }[];
  referrers: { host: string; visitors: number }[];
  countries: { country: string; visitors: number }[];
}

const root = document.getElementById("stats")!;
const TOKEN = "stats-token";
const RANGES = [7, 30, 90, 365];

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const num = (n: number) => n.toLocaleString("en-IN");
const token = () => { try { return localStorage.getItem(TOKEN) ?? ""; } catch { return ""; } };
const setToken = (t: string) => { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch { /* ok */ } };

function head(sub: string) {
  return `<header class="p-head"><h1>visitors</h1><p class="p-sub">${sub}</p></header>`;
}

function askForToken(message = "") {
  root.innerHTML = head("private. the numbers open with the admin token.") +
    `<form class="s-form">
       <label for="tok">admin token</label>
       <input id="tok" type="password" autocomplete="current-password" spellcheck="false" required>
       <button type="submit">open</button>
       ${message ? `<p class="s-err" role="alert">${esc(message)}</p>` : ""}
     </form>`;
  const form = root.querySelector("form")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    setToken((form.querySelector("input") as HTMLInputElement).value.trim());
    void show(30);
  });
  (form.querySelector("input") as HTMLInputElement).focus();
}

function table(title: string, cols: string[], rows: (string | number)[][], empty: string) {
  if (!rows.length) return `<section><h2>${title}</h2><p class="s-empty">${empty}</p></section>`;
  const max = Math.max(...rows.map((r) => Number(r[1])));
  return `<section><h2>${title}</h2><div class="tbl-scroll"><table class="s-table"><thead><tr>${cols.map((c, i) => `<th${i ? ' class="n"' : ""}>${c}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr><td><span class="s-bar" style="width:${max ? Math.round((Number(r[1]) / max) * 100) : 0}%"></span><span class="s-name">${esc(r[0])}</span></td>${r.slice(1).map((v) => `<td class="n">${num(Number(v))}</td>`).join("")}</tr>`).join("") +
    `</tbody></table></div></section>`;
}

function chart(daily: Day[]) {
  const max = Math.max(1, ...daily.map((d) => d.visitors));
  const bars = daily.map((d) =>
    `<span class="s-col" title="${esc(d.day)}: ${d.visitors} ${d.visitors === 1 ? "person" : "people"}, ${d.views} ${d.views === 1 ? "view" : "views"}"><i style="height:${(d.visitors / max) * 100}%"></i></span>`).join("");
  return `<section><h2>people per day</h2>
    <div class="s-chart" role="img" aria-label="people per day, ${esc(daily[0].day)} to ${esc(daily[daily.length - 1].day)}, at most ${max} in a day"><span class="s-max">${num(max)}</span>${bars}</div>
    <div class="s-axis"><span>${esc(daily[0].day)}</span><span>${esc(daily[daily.length - 1].day)}</span></div></section>`;
}

function render(s: Stats) {
  const card = (label: string, big: number, unit: string, small: string) =>
    `<div class="s-card"><span class="s-k">${label}</span><span class="s-big">${num(big)}</span><span class="s-unit">${unit}</span><span class="s-small">${small}</span></div>`;
  root.innerHTML =
    head(`private. days follow the clock in india; today is ${esc(s.day)}.`) +
    `<div class="s-cards">
       ${card("today", s.today.visitors, s.today.visitors === 1 ? "person" : "people", `${num(s.today.views)} page views`)}
       ${card(`last ${s.days} days`, s.window.visits, "visits", `${num(s.window.views)} page views`)}
       ${card("all time", s.total.visits, "visits", `${num(s.total.views)} page views, since ${esc(s.total.since)}`)}
     </div>
     <div class="s-ranges" role="group" aria-label="range">${RANGES.map((d) => `<button type="button" data-days="${d}"${d === s.days ? ' aria-pressed="true"' : ""}>${d} days</button>`).join("")}</div>` +
    chart(s.daily) +
    table("pages", ["page", "views", "visits"], s.pages.map((p) => [p.path, p.views, p.visitors]), "no page views in this range.") +
    table("where people came from", ["referrer", "visits"], s.referrers.map((r) => [r.host, r.visitors]), "no visits in this range.") +
    table("countries", ["country", "visits"], s.countries.map((c) => [c.country, c.visitors]), "no visits in this range.") +
    `<section class="s-notes">
       <p>a visit is one person on one day. a person is a hash of the day, the ip address and the browser, so nobody can be followed from one day to the next. the ip address itself is never stored, and no cookie is set.</p>
       <label class="s-check"><input type="checkbox" id="nostats"${ignored() ? " checked" : ""}> do not count visits from this browser</label>
       <p><button type="button" id="forget">forget the token on this browser</button></p>
     </section>`;
  for (const b of root.querySelectorAll<HTMLButtonElement>(".s-ranges button")) b.addEventListener("click", () => void show(Number(b.dataset.days)));
  root.querySelector<HTMLInputElement>("#nostats")!.addEventListener("change", (e) => setIgnored((e.target as HTMLInputElement).checked));
  root.querySelector("#forget")!.addEventListener("click", () => { setToken(""); askForToken(); });
}

async function show(days: number) {
  if (!statsOn) { root.innerHTML = head("the visitor counter is not connected yet."); return; }
  if (!token()) { askForToken(); return; }
  if (!root.querySelector(".s-cards")) root.innerHTML = head("loading…");
  try {
    const r = await fetch(`${statsApi}/stats?days=${days}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (r.status === 401) { setToken(""); askForToken("that token was not accepted."); return; }
    if (!r.ok) throw new Error(String(r.status));
    render((await r.json()) as Stats);
  } catch {
    root.innerHTML = head("the counter is not answering right now. try again in a minute.");
  }
}

void show(30);
