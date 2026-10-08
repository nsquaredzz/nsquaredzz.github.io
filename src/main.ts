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
function hasSide() { return innerWidth >= 1280; }

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
    (C.intro?.length
      ? `<dl class="intro">${C.intro.map((r) => `<div><dt>${esc(r.k)}</dt><dd>${esc(r.v)}</dd></div>`).join("")}</dl>`
      : C.bio.map((b) => `<div class="line bio">${esc(b)}</div>`).join("")) +
    `<div class="line hint">this site is a terminal. type <code>help</code>, or use the buttons if you're in a hurry.</div>` +
    `<div class="tags" role="group" aria-label="shortcuts"></div>`;
  termRoot.appendChild(head);

  const term = new Terminal(termRoot);
  const fs = new FS(C);

  const side = document.createElement("aside"); // filled in below; the engine's bounds() reads its rect
  const engine = new Engine({
    reduced: REDUCED,
    mobile: isMobile,
    bounds: () => {
      if (isMobile()) return { x: 8, y: innerHeight - 150, w: innerWidth - 16, h: 70 };
      const r = termRoot.getBoundingClientRect();
      const left = Math.min(r.right + 24, innerWidth - 120);
      const sideLeft = hasSide() ? side.getBoundingClientRect().left - 24 : innerWidth - 24;
      if (sideLeft - left >= 140) return { x: left, y: 70, w: sideLeft - left, h: innerHeight - 100 };
      // not enough room between the columns: use the strip under the side pane
      const top = hasSide() ? side.getBoundingClientRect().bottom + 20 : 70;
      return { x: left, y: Math.min(top, innerHeight - 120), w: Math.max(80, innerWidth - left - 24), h: Math.max(90, innerHeight - top - 30) };
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

  const ctx: Ctx = { term, fs, engine, theme };

  term.onRun = async (line) => {
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
  term.onComplete = (line) => {
    const sp = line.lastIndexOf(" ");
    if (sp < 0) {
      return commands.filter((c) => !c.hidden && c.name.startsWith(line)).map((c) => c.name);
    }
    const head = line.slice(0, sp + 1), frag = line.slice(sp + 1);
    const cmd = head.trim().split(" ")[0];
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
  for (const c of ["help", "work", "projects", "lab", "contact", "blip", "drop", "clear", "plain"]) {
    const b = document.createElement("button");
    b.className = "tag"; b.type = "button"; b.textContent = c;
    b.addEventListener("click", () => { void term.run(c); });
    chips.appendChild(b);
  }
  app.appendChild(chips);

  // status (top right on desktop, above everything on mobile)
  const status = mountStatus(C, () => engine.count);
  if (isMobile()) termRoot.prepend(status); else app.appendChild(status);

  // right pane on wide screens: file tree, now, contact
  side.className = "side";
  side.setAttribute("aria-label", "quick links");
  const tree = Object.entries(C.dirs).map(([d, files]) =>
    `<div class="t-dir"><button class="t-link d" data-cmd="cd ~/${d}">${esc(d)}/</button></div>` +
    files.map((f) => `<div class="t-file"><button class="t-link f" data-cmd="cat ~/${d}/${f.name}">${esc(f.name)}</button><span class="t-meta">${esc(f.tag ?? f.when ?? "")}</span></div>`).join("")
  ).join("");
  const now = C.dirs.notes?.find((f) => f.name === "now.md");
  side.innerHTML =
    `<section class="box"><span class="box-title">~/</span><span class="box-meta">click to cat</span>${tree}</section>` +
    (now ? `<section class="box"><span class="box-title">now</span>${now.body.filter((l) => l.startsWith("- ")).map((l) => `<div class="line li">• ${esc(l.slice(2)).replace(/`([^`]+)`/g, "<code>$1</code>")}</div>`).join("")}</section>` : "") +
    `<section class="box"><span class="box-title">contact</span>` +
      (C.email ? `<div class="line"><a href="mailto:${esc(C.email)}">${esc(C.email)}</a></div>` : "") +
      `<div class="line"><a href="${C.github}" target="_blank" rel="noopener">${esc(C.github.replace("https://", ""))}</a></div>` +
      `<div class="line"><button class="t-link f" data-cmd="open resume.pdf">resume.pdf</button></div>` +
      `<div class="line"><button class="t-link f" data-cmd="sudo hire niyath">sudo hire niyath</button></div>` +
    `</section>` +
    `<section class="box"><span class="box-title">blip</span>` +
      `<div class="line dim">a pixel robot lives on this page. drop a bit and it brings back a file.</div>` +
      `<div class="line"><button class="t-link f" data-cmd="blip">blip</button> <button class="t-link f" data-cmd="drop">drop</button> <button class="t-link f" data-cmd="blip --big">blip --big</button></div>` +
    `</section>`;
  side.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cmd]");
    if (b?.dataset.cmd) void term.type(b.dataset.cmd, 12);
  });
  app.appendChild(side);

  // --- first visit ---
  let seen = false;
  try { seen = localStorage.getItem("seen") === "1"; localStorage.setItem("seen", "1"); } catch { /* ok */ }
  const blipsWanted = Number(params.get("blips") ?? (isMobile() ? 0 : 1));
  for (let i = 0; i < blipsWanted; i++) engine.spawn();
  if (!seen || params.has("help")) term.run("help").then(() => requestAnimationFrame(() => scrollTo(0, 0)));
  if (!isMobile()) term.focus();
}
