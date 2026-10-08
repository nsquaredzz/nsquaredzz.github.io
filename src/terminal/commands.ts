import type { Parsed } from "./parser";
import type { FS, FileEntry } from "./fs";
import { Terminal, esc } from "./terminal";
import type { Engine } from "../sprite/engine";
import { istHour, uptime } from "../status";
import posts from "../generated/posts.json";

export interface Ctx {
  term: Terminal;
  fs: FS;
  engine: Engine;
  theme: "crt" | "flat";
}

export interface Command {
  name: string;
  desc: string;
  usage?: string;
  hidden?: boolean;
  group?: string;
  run: (p: Parsed, ctx: Ctx) => void | Promise<void>;
}

const NIGHT = () => { const h = istHour(); return h >= 22 || h < 5; };

/** Render a file body: `# ` headings, `- ` bullets, [links](url), `code`. */
export function catFile(term: Terminal, f: FileEntry, path?: string) {
  const first = f.body[0]?.startsWith("# ") ? f.body[0].slice(2) : (f.title ?? f.name);
  term.openBox(first, [f.when ?? f.tag, path].filter(Boolean).join("  "));
  let blank = false;
  for (const line of f.body) {
    if (line.startsWith("# ")) continue;
    if (!line.trim()) { blank = true; continue; }
    const html = esc(line)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => (u.startsWith("/") ? `<a href="${u}">${t}</a>` : `<a href="${u}" target="_blank" rel="noopener">${t}</a>`))
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    const el = line.startsWith("- ") ? term.print("• " + html.slice(2), "li") : term.print(html);
    if (blank) { el.classList.add("gap"); blank = false; }
  }
  term.closeBox();
}

function lsListing(term: Terminal, dir: string, ctx: Ctx, all: boolean): boolean {
  const l = ctx.fs.list(dir, all);
  if (!l) { term.text(`ls: ${dir}: no such directory`, "err"); return false; }
  term.openBox(ctx.fs.resolveDir(dir) ?? dir, `${l.dirs.length + l.files.length} entries`);
  if (all && ctx.fs.resolveDir(dir) === "~") term.print(`<div class="ls-row"><span class="hid">.</span><span class="meta"></span></div><div class="ls-row"><span class="hid">..</span><span class="meta"></span></div>`);
  for (const d of l.dirs) {
    const n = ctx.fs.list("~/" + d)!.files.length;
    term.print(`<div class="ls-row"><span class="d">${esc(d)}/</span><span class="meta">${n} file${n === 1 ? "" : "s"}</span></div>`);
  }
  for (const f of l.files) {
    const meta = f.hidden ? "" : [f.title, f.when ?? f.tag].filter(Boolean).join(" · ");
    term.print(`<div class="ls-row"><span class="${f.hidden ? "hid" : "f"}">${esc(f.name)}</span><span class="meta">${esc(meta)}</span></div>`);
  }
  term.closeBox();
  return true;
}

function catDir(term: Terminal, dir: string, ctx: Ctx) {
  const l = ctx.fs.list(dir);
  if (!l) return;
  for (const f of l.files) catFile(term, f);
}

function openResume(term: Terminal, ctx: Ctx) {
  const url = ctx.fs.content.resume;
  fetch(url, { method: "HEAD" }).then((r) => {
    const ok = r.ok && (r.headers.get("content-type") ?? "").includes("pdf");
    if (ok) { term.print(`opening <a href="${url}" target="_blank" rel="noopener">${esc(url)}</a>`); open(url, "_blank", "noopener"); }
    else term.print(`resume.pdf isn't uploaded yet. for now: <a href="${ctx.fs.content.github}" target="_blank" rel="noopener">github</a>, or <code>sudo hire niyath</code>.`, "dim");
  }).catch(() => term.text("couldn't reach resume.pdf. try again in a bit.", "err"));
}

export const commands: Command[] = [
  {
    name: "help", desc: "this list", group: "basics",
    run(_p, ctx) {
      const t = ctx.term;
      const groups = new Map<string, Command[]>();
      for (const c of commands) if (!c.hidden) (groups.get(c.group ?? "misc") ?? groups.set(c.group ?? "misc", []).get(c.group ?? "misc")!).push(c);
      for (const [g, cs] of groups) {
        t.openBox(g);
        for (const c of cs) t.print(`<div class="help-row"><span class="cmd-name">${esc(c.usage ?? c.name)}</span><span>${esc(c.desc)}</span></div>`);
        t.closeBox();
      }
      t.text("tab completes. ↑↓ for history. ctrl+l clears. there are more commands than this.", "dim");
    },
  },
  {
    name: "whoami", desc: "two lines about me", group: "basics",
    run(_p, ctx) {
      const c = ctx.fs.content;
      ctx.term.openBox(c.name, c.location);
      ctx.term.print(`<span class="green">●</span> ${esc(c.status)}`);
      ctx.term.lines(c.bio);
      ctx.term.closeBox();
    },
  },
  {
    name: "ls", desc: "list files", usage: "ls [dir]", group: "files",
    run(p, ctx) { lsListing(ctx.term, p.args[0] ?? ctx.fs.cwd, ctx, !!p.flags.a || !!p.flags.all); },
  },
  {
    name: "cd", desc: "change directory", usage: "cd <dir>", group: "files",
    run(p, ctx) {
      const d = ctx.fs.resolveDir(p.args[0] ?? "~");
      if (!d) { ctx.term.text(`cd: ${p.args[0]}: no such directory`, "err"); return; }
      ctx.fs.cwd = d;
      ctx.term.setPs1(`niyath@nair:${d} $ `);
      if (d !== "~") lsListing(ctx.term, d, ctx, false);
    },
  },
  {
    name: "cat", desc: "read a file", usage: "cat <file>", group: "files",
    run(p, ctx) {
      if (!p.args.length) { ctx.term.text("cat: which file? try `ls`.", "err"); return; }
      for (const a of p.args) {
        if (a.endsWith("*") || ctx.fs.isDir(a)) { catDir(ctx.term, a.replace(/\/?\*$/, ""), ctx); continue; }
        const f = ctx.fs.read(a);
        if (!f) { ctx.term.text(`cat: ${a}: no such file`, "err"); continue; }
        catFile(ctx.term, f, ctx.fs.canonical(a));
      }
    },
  },
  {
    name: "pwd", desc: "where am i", hidden: true,
    run(_p, ctx) { ctx.term.text(ctx.fs.cwd === "~" ? "/home/niyath" : ctx.fs.cwd.replace("~", "/home/niyath")); },
  },
  {
    name: "open", desc: "open a link", usage: "open <link>", group: "files",
    run(p, ctx) {
      const a = (p.args[0] ?? "").toLowerCase();
      const c = ctx.fs.content;
      if (!a) { ctx.term.print(`open what? ${c.links.map((l) => `<code>${esc(l.label)}</code>`).join(", ")}`, "dim"); return; }
      if (a === "resume" || a === "resume.pdf") { openResume(ctx.term, ctx); return; }
      const link = c.links.find((l) => l.label === a);
      const url = link?.url ?? (/^https?:\/\//.test(a) ? a : a.includes(".") ? "https://" + a : null);
      if (!url) { ctx.term.text(`open: ${a}: nothing by that name`, "err"); return; }
      ctx.term.print(`opening <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`);
      open(url, "_blank", "noopener");
    },
  },
  { name: "clear", desc: "clear the screen", group: "basics", run(_p, ctx) { ctx.term.clear(); } },
  {
    name: "history", desc: "what you typed", group: "basics",
    run(_p, ctx) { ctx.term.history.forEach((h, i) => ctx.term.text(`${String(i + 1).padStart(4)}  ${h}`)); },
  },
  {
    name: "theme", desc: "crt or flat", usage: "theme [crt|flat]", group: "basics",
    run(p, ctx) {
      const want = (p.args[0] as Ctx["theme"]) ?? (ctx.theme === "crt" ? "flat" : "crt");
      if (want !== "crt" && want !== "flat") { ctx.term.text("theme: crt or flat", "err"); return; }
      ctx.theme = want;
      document.documentElement.dataset.theme = want;
      try { localStorage.setItem("theme", want); } catch { /* ok */ }
      ctx.term.text(`theme: ${want}`, "dim");
    },
  },

  { name: "work", desc: "where i've worked", group: "shortcuts", run(_p, ctx) { catDir(ctx.term, "~/work", ctx); } },
  { name: "projects", desc: "things i've built", group: "shortcuts", run(_p, ctx) { catDir(ctx.term, "~/projects", ctx); } },
  { name: "lab", desc: "half-finished thoughts", group: "shortcuts", run(_p, ctx) { catDir(ctx.term, "~/lab", ctx); } },
  { name: "notes", desc: "now, and other notes", hidden: true, run(_p, ctx) { catDir(ctx.term, "~/notes", ctx); } },
  { name: "contact", desc: "how to reach me", group: "shortcuts", run(_p, ctx) { catFile(ctx.term, ctx.fs.read("~/contact.txt")!); } },
  {
    name: "blog", desc: "research write-ups, paper style", group: "shortcuts",
    run(_p, ctx) {
      const t = ctx.term;
      if (!posts.length) { t.text("nothing published yet.", "dim"); return; }
      for (const p of posts) {
        t.openBox(p.title, `${p.date}  ${p.minutes} min`);
        if (p.subtitle) t.text(p.subtitle);
        t.text(p.summary, "dim").classList.add("gap");
        t.print(`<a href="/blog/${esc(p.slug)}/">read the paper →</a>   <span class="dim">or</span> <code>read ${esc(p.slug)}</code>`).classList.add("gap");
        t.closeBox();
      }
    },
  },
  {
    name: "read", desc: "open a post as a paper", usage: "read <post>", group: "files",
    run(p, ctx) {
      const a = (p.args[0] ?? "").replace(/^~?\/?(blog\/)?/, "").replace(/\.md$/, "");
      const hit = posts.find((x) => x.slug === a) ?? (a ? posts.find((x) => x.slug.startsWith(a)) : posts.length === 1 ? posts[0] : undefined);
      if (!hit) { ctx.term.print(`read: which post? ${posts.map((x) => `<code>${esc(x.slug)}</code>`).join(", ") || "none yet"}`, "dim"); return; }
      ctx.term.text(`opening ${hit.title}…`, "dim");
      setTimeout(() => (location.href = `/blog/${hit.slug}/`), 250);
    },
  },
  { name: "resume", desc: "open resume.pdf", group: "shortcuts", run(_p, ctx) { openResume(ctx.term, ctx); } },
  {
    name: "plain", desc: "plain html version of this site", group: "shortcuts",
    run(_p, ctx) { ctx.term.text("switching to plain mode…", "dim"); location.href = "/?plain"; },
  },

  {
    name: "blip", desc: "spawn a blip", usage: "blip [--count n] [--big]", group: "blip",
    run(p, ctx) {
      const n = Math.max(1, Math.min(8, parseInt(String(p.flags.count ?? p.flags.n ?? "1")) || 1));
      let made = 0;
      for (let i = 0; i < n; i++) if (ctx.engine.spawn(!!p.flags.big)) made++;
      if (!made) ctx.term.text("that's enough blips. 8 is the limit, they get rowdy.", "dim");
      else ctx.term.text(made === 1 ? (p.flags.big ? "a big blip appears." : "blip appears. it's looking at you.") : `${made} blips appear.`, "dim");
      if (made && ctx.engine.count === made) ctx.term.text("try `drop`, or click somewhere near it.", "dim");
    },
  },
  {
    name: "kill", desc: "power a blip down", usage: "kill blip [--all]", group: "blip",
    run(p, ctx) {
      if (p.args[0] !== "blip") { ctx.term.text(`kill: ${p.args[0] ?? "what"}: no such process. did you mean \`kill blip\`?`, "err"); return; }
      if (p.flags.all) { const n = ctx.engine.killAll(); ctx.term.text(n ? `${n} blip${n === 1 ? "" : "s"} sent off-screen. that was cold.` : "no blips to kill.", "dim"); return; }
      ctx.term.text(ctx.engine.kill() ? "blip powers down. it'll be back." : "no blips to kill. `blip` makes one.", "dim");
    },
  },
  {
    name: "drop", desc: "drop a bit for a blip to fetch", group: "blip",
    run(_p, ctx) {
      if (!ctx.engine.count) { ctx.term.text("nobody to fetch it. `blip` first.", "dim"); return; }
      ctx.engine.drop();
      ctx.term.text("a bit falls somewhere. blip's on it.", "dim");
    },
  },

  // ---- not in help ----
  {
    name: "sudo", desc: "", hidden: true,
    async run(p, ctx) {
      const t = ctx.term;
      if (p.args.join(" ") !== "hire niyath") { t.text(`sudo: ${p.args.join(" ") || "nothing"}: permission denied. the only thing you can sudo here is \`sudo hire niyath\`.`, "err"); return; }
      t.text("[sudo] password for recruiter: ", "dim");
      await new Promise((r) => setTimeout(r, 700));
      t.text("********", "dim");
      await new Promise((r) => setTimeout(r, 500));
      t.text("checking budget...   ok", "dim");
      t.text("checking vibes...    ok", "dim");
      const c = ctx.fs.content;
      if (c.email) t.print(`permission granted. email me: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, "green");
      else t.print(`permission granted. find me at <a href="${c.github}" target="_blank" rel="noopener">${esc(c.github.replace("https://", ""))}</a>`, "green");
    },
  },
  {
    name: "rm", desc: "", hidden: true,
    async run(p, ctx) {
      const t = ctx.term;
      if (!(p.flags.r && p.flags.f) || p.args[0] !== "/") { t.text("rm: this filesystem is read-only. you can't delete my career that easily.", "err"); return; }
      if (!ctx.engine.count) ctx.engine.spawn();
      ctx.engine.panic();
      t.text("rm: removing /bin... /etc... /home/niyath...", "rust");
      await new Promise((r) => setTimeout(r, 900));
      t.text("rm: cannot remove '/home/niyath/blip': device or resource busy (it's hiding)", "err");
      await new Promise((r) => setTimeout(r, 700));
      t.text("just kidding. nothing happened. blip will come out when it's safe.", "dim");
    },
  },
  {
    name: "coffee", desc: "", hidden: true,
    async run(_p, ctx) {
      const t = ctx.term;
      const cup = ["    ( (", "     ) )", "  ........", "  |      |]", "  \\      /", "   `----'"];
      t.lines(cup, "amber");
      await new Promise((r) => setTimeout(r, 400));
      t.text(NIGHT() ? "filter coffee at this hour. we've all been there." : "filter coffee. one. no sugar. back to work.", "dim");
    },
  },
  {
    name: "matrix", desc: "", hidden: true,
    run(_p, ctx) {
      const t = ctx.term;
      const cv = document.createElement("canvas");
      cv.id = "matrix";
      document.body.appendChild(cv);
      const g = cv.getContext("2d")!;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; g.scale(dpr, dpr);
      const fs = 14, cols = Math.ceil(innerWidth / fs);
      const y = Array.from({ length: cols }, () => Math.random() * -50);
      const chars = "01アイウエオカキクケコサシスセソ<>{}[]=;:*#";
      let raf = 0;
      const stop = () => { cancelAnimationFrame(raf); cv.remove(); removeEventListener("keydown", stop); removeEventListener("click", stop); t.text("back.", "dim"); t.focus(); };
      const draw = () => {
        g.fillStyle = "rgba(11,10,8,.18)"; g.fillRect(0, 0, innerWidth, innerHeight);
        g.font = `${fs}px 'JetBrains Mono', monospace`;
        for (let i = 0; i < cols; i++) {
          g.fillStyle = Math.random() < 0.08 ? "#e9dfc8" : "#ffb23e";
          g.fillText(chars[Math.floor(Math.random() * chars.length)], i * fs, y[i] * fs);
          if (y[i] * fs > innerHeight && Math.random() > 0.975) y[i] = 0;
          y[i] += 0.6 + Math.random() * 0.4;
        }
        raf = requestAnimationFrame(draw);
      };
      t.text("wake up. any key to leave.", "dim");
      setTimeout(() => { addEventListener("keydown", stop); addEventListener("click", stop); }, 300);
      draw();
    },
  },
  { name: "exit", desc: "", hidden: true, run(_p, ctx) { ctx.term.text("logout", "dim"); setTimeout(() => (location.href = "/?plain"), 300); } },
  { name: "logout", desc: "", hidden: true, run(p, ctx) { return commands.find((c) => c.name === "exit")!.run(p, ctx); } },
  {
    name: "uptime", desc: "", hidden: true,
    run(_p, ctx) { ctx.term.text(`up ${uptime(ctx.fs.content.firstCommit)}, since the first commit. load average: 0.42, 0.37, 1.00`); },
  },
  { name: "date", desc: "", hidden: true, run(_p, ctx) { ctx.term.text(new Date().toString()); } },
  { name: "echo", desc: "", hidden: true, run(p, ctx) { ctx.term.text(p.words.join(" ")); } },
  { name: "vim", desc: "", hidden: true, run(_p, ctx) { ctx.term.text("no. you'd never get out.", "dim"); } },
  { name: "nano", desc: "", hidden: true, run(_p, ctx) { ctx.term.text("there's no nano here. there is `vim`, which you also can't use.", "dim"); } },
  { name: "neofetch", desc: "", hidden: true, run(_p, ctx) { const e = ctx.engine; ctx.term.lines([`os:      niyath-os 1.0 (bengaluru build)`, `shell:   this one`, `uptime:  ${uptime(ctx.fs.content.firstCommit)}`, `blips:   ${e.count}`, `theme:   ${ctx.theme}`, `editor:  vim, allegedly`]); } },
  {
    name: "whois", desc: "", hidden: true,
    run(p, ctx) { ctx.term.text(p.args[0] === "blip" ? "blip: a 12x12 robot. fetches files. afraid of rm. not afraid of you." : "whois: try `whoami` or `whois blip`.", "dim"); },
  },

  // ---- only between 10pm and 5am IST ----
  {
    name: "moon", desc: "", hidden: true,
    run(_p, ctx) {
      if (!NIGHT()) { ctx.term.text("moon: only works between 10pm and 5am ist. it's daytime in bengaluru.", "dim"); return; }
      ctx.term.lines(["      _..._", "    .:::::::.", "   :::::::::::", "   :::::::::::", "   `:::::::::'", "     `':::''"], "amber");
      ctx.term.text("it's late in bengaluru. the good ideas and the bad ones show up around now.", "dim");
    },
  },
  {
    name: "insomnia", desc: "", hidden: true,
    run(_p, ctx) {
      if (!NIGHT()) { ctx.term.text("insomnia: come back after 10pm ist. you seem fine right now.", "dim"); return; }
      ctx.term.lines(["things i think about at this hour:", "  - whether retrieval is a search problem or a memory problem", "  - why every warehouse has three tables called orders", "  - whether blip is happy"], "dim");
    },
  },
  {
    name: "chai", desc: "", hidden: true,
    run(_p, ctx) {
      if (!NIGHT()) { ctx.term.text("chai: the night-shift command. after 10pm ist.", "dim"); return; }
      ctx.term.text("chai at this hour. respect. the kettle's on.", "amber");
    },
  },
];

export function find(name: string): Command | undefined { return commands.find((c) => c.name === name); }

/** Nearest visible command name, for "did you mean". */
export function suggest(name: string): string | null {
  let best: string | null = null, bd = 3;
  for (const c of commands) {
    if (c.hidden && c.name !== "exit") continue;
    const d = lev(name, c.name);
    if (d < bd) { bd = d; best = c.name; }
  }
  return best;
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
