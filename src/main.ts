import "./style.css";
import content from "./content.json";
import { BANNER_WIDE, BANNER_SMALL } from "./banner";
import { FS, type Content } from "./terminal/fs";
import { parse } from "./terminal/parser";
import { Terminal, REDUCED, esc } from "./terminal/terminal";
import { commands, find, suggest, catFile, type Ctx } from "./terminal/commands";
import { Engine } from "./sprite/engine";
import { mountStatus, loginLine } from "./status";
import { renderPlain } from "./plain";

const C = content as Content;
const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);

if (params.has("plain")) {
  renderPlain(app, C);
} else {
  boot();
}

function isMobile() { return innerWidth < 768; }

function boot() {
  // theme
  let theme: Ctx["theme"] = "crt";
  try { theme = (localStorage.getItem("theme") as Ctx["theme"]) || "crt"; } catch { /* ok */ }
  document.documentElement.dataset.theme = theme;

  const termRoot = document.createElement("div");
  termRoot.className = "term";
  app.appendChild(termRoot);

  // --- static first screen ---
  const head = document.createElement("div");
  head.innerHTML =
    `<div class="line login">${esc(loginLine())}</div>` +
    `<div class="line hey">hey, i'm</div>` +
    `<pre class="banner wide" aria-label="${esc(C.name)}">${BANNER_WIDE.join("\n")}</pre>` +
    `<pre class="banner small" aria-hidden="true">${BANNER_SMALL.join("\n")}</pre>` +
    C.bio.map((b) => `<div class="line bio">${esc(b)}</div>`).join("") +
    `<div class="line hint">this site is a terminal. type <code>help</code>, or use the buttons if you're in a hurry.</div>` +
    `<div class="tags" role="group" aria-label="shortcuts"></div>`;
  termRoot.appendChild(head);

  const term = new Terminal(termRoot);
  const fs = new FS(C);

  const engine = new Engine({
    reduced: REDUCED,
    mobile: isMobile,
    bounds: () => {
      if (isMobile()) return { x: 8, y: innerHeight - 150, w: innerWidth - 16, h: 70 };
      const r = termRoot.getBoundingClientRect();
      const left = Math.min(r.right + 24, innerWidth - 120);
      return { x: left, y: 70, w: Math.max(80, innerWidth - left - 24), h: innerHeight - 100 };
    },
    onFetch: (b) => {
      const pool = C.fetchable.filter((p) => !recent.includes(p));
      const path = (pool.length ? pool : C.fetchable)[Math.floor(Math.random() * (pool.length || C.fetchable.length))];
      recent.push(path); if (recent.length > 3) recent.shift();
      const name = path.split("/").pop()!;
      engine.say(b, `fetched: ${name}`, "fetch", 9000, () => {
        void term.run(`cat ${path}`);
      });
    },
  });
  const recent: string[] = [];

  const ctx: Ctx = { term, fs, engine, lineHook: null, theme };

  term.onRun = async (line) => {
    if (ctx.lineHook) { ctx.lineHook(line); return; }
    const p = parse(line);
    if (!p.cmd) return;
    if (p.cmd.startsWith("~/")) { p.cmd = p.cmd.slice(2); }
    const cmd = find(p.cmd);
    if (!cmd) {
      const s = suggest(p.cmd);
      const file = fs.read(p.cmd);
      if (file) { catFile(term, file, fs.canonical(p.cmd)); return; }
      term.print(`command not found: ${esc(p.cmd)}.${s ? ` did you mean <code>${esc(s)}</code>?` : " try <code>help</code>."}`, "err");
      return;
    }
    try { await cmd.run(p, ctx); }
    catch (e) { term.text(`${p.cmd}: ${(e as Error).message}`, "err"); }
  };
  term.onInterrupt = () => { if (ctx.lineHook) { ctx.lineHook("quit"); } };
  term.onComplete = (line) => {
    const sp = line.lastIndexOf(" ");
    if (sp < 0) {
      return commands.filter((c) => !c.hidden && c.name.startsWith(line)).map((c) => c.name);
    }
    const head = line.slice(0, sp + 1), frag = line.slice(sp + 1);
    const cmd = head.trim().split(" ")[0];
    if (cmd === "play") return ["snake", "breakout", "sql-golf"].filter((g) => g.startsWith(frag)).map((g) => head + g);
    if (cmd === "theme") return ["crt", "flat"].filter((g) => g.startsWith(frag)).map((g) => head + g);
    if (cmd === "open") return C.links.map((l) => l.label).filter((g) => g.startsWith(frag)).map((g) => head + g);
    if (cmd === "kill" || cmd === "sudo") return [];
    return fs.complete(frag).map((f) => head + f);
  };

  // --- buttons ---
  const tags = head.querySelector(".tags")!;
  const buttons: [string, string, boolean][] = [
    ["~/plain", "plain", true], ["work", "work", false], ["projects", "projects", false],
    ["lab", "lab", false], ["contact", "contact", false], ["resume.pdf", "open resume.pdf", false],
  ];
  for (const [label, cmd, fill] of buttons) {
    const b = document.createElement("button");
    b.className = "tag" + (fill ? " fill" : "");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => { void term.type(cmd, 18); });
    tags.appendChild(b);
  }

  // mobile chips
  const chips = document.createElement("div");
  chips.className = "chips";
  chips.setAttribute("aria-label", "commands");
  for (const c of ["help", "work", "projects", "lab", "contact", "blip", "drop", "play snake", "clear", "plain"]) {
    const b = document.createElement("button");
    b.className = "tag"; b.type = "button"; b.textContent = c;
    b.addEventListener("click", () => { void term.run(c); });
    chips.appendChild(b);
  }
  app.appendChild(chips);

  // status (top right on desktop, above everything on mobile)
  const status = mountStatus(C, () => engine.count);
  if (isMobile()) termRoot.prepend(status); else app.appendChild(status);

  // --- first visit ---
  let seen = false;
  try { seen = localStorage.getItem("seen") === "1"; localStorage.setItem("seen", "1"); } catch { /* ok */ }
  const blipsWanted = Number(params.get("blips") ?? 0);
  if (blipsWanted) for (let i = 0; i < blipsWanted; i++) engine.spawn();
  if (!seen || params.has("help")) term.run("help").then(() => requestAnimationFrame(() => scrollTo(0, 0)));
  if (!isMobile()) term.focus();
}
