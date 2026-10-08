export type KeyHandler = (e: KeyboardEvent) => void;

export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/**
 * The visible terminal: output lines, a live prompt, history, tab completion.
 * It knows nothing about commands; `onRun` is wired by main.ts.
 */
export class Terminal {
  out: HTMLElement;
  promptEl: HTMLElement;
  typedEl: HTMLElement;
  cursorEl: HTMLElement;
  input: HTMLInputElement;
  ps1 = "niyath@nair:~ $ ";
  history: string[] = [];
  private hIdx = -1;
  private draft = "";
  private typing = false;
  private cancelTyping = false;
  private keyCapture: KeyHandler | null = null;
  onRun: (line: string) => Promise<void> | void = () => {};
  onComplete: (line: string) => string[] = () => [];
  onInterrupt: (() => void) | null = null;
  private cur: HTMLElement;

  constructor(public root: HTMLElement) {
    this.out = document.createElement("div");
    this.out.className = "out";
    this.cur = this.out;
    this.promptEl = document.createElement("div");
    this.promptEl.className = "prompt";
    this.promptEl.innerHTML = `<span class="ps1"></span><span class="typed"></span><span class="cursor" aria-hidden="true"></span>`;
    this.typedEl = this.promptEl.querySelector(".typed")!;
    this.cursorEl = this.promptEl.querySelector(".cursor")!;
    this.input = document.createElement("input");
    this.input.className = "hidden-input";
    this.input.setAttribute("aria-label", "terminal input");
    this.input.autocomplete = "off";
    this.input.autocapitalize = "off";
    this.input.spellcheck = false;
    root.append(this.out, this.promptEl, this.input);
    this.setPs1(this.ps1);

    try { this.history = JSON.parse(localStorage.getItem("hist") ?? "[]"); } catch { /* fine */ }

    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.input.addEventListener("blur", () => this.cursorEl.classList.add("off"));
    this.input.addEventListener("focus", () => this.cursorEl.classList.remove("off"));
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("a,button,canvas,.game")) return;
      if (getSelection()?.toString()) return;
      this.focus();
    });
  }

  setPs1(ps1: string) {
    this.ps1 = ps1;
    (this.promptEl.querySelector(".ps1") as HTMLElement).textContent = ps1;
  }

  focus() { this.input.focus({ preventScroll: true }); }

  private render() {
    this.typedEl.textContent = this.input.value;
  }

  /** Append a line of already-escaped HTML. */
  print(html = "", cls = ""): HTMLElement {
    const el = document.createElement("div");
    el.className = "line" + (cls ? " " + cls : "");
    el.innerHTML = html;
    this.cur.appendChild(el);
    return el;
  }

  /** Start a bordered panel with a title in the frame. Everything printed until closeBox() goes inside. */
  openBox(title: string, meta = ""): HTMLElement {
    const box = document.createElement("section");
    box.className = "box";
    box.innerHTML = `<span class="box-title">${esc(title)}</span>${meta ? `<span class="box-meta">${esc(meta)}</span>` : ""}`;
    this.cur.appendChild(box);
    this.cur = box;
    return box;
  }

  closeBox() { if (this.cur !== this.out) this.cur = this.cur.parentElement ?? this.out; }

  /** Append plain text safely. */
  text(s: string, cls = ""): HTMLElement { return this.print(esc(s), cls); }

  lines(ls: string[], cls = "") { for (const l of ls) this.text(l, cls); }

  /** Append an arbitrary element (used by games). */
  mount(el: HTMLElement) { this.cur.appendChild(el); this.scroll(); }

  echo(line: string) {
    this.print(`<span class="ps1">${esc(this.ps1)}</span><span class="typed">${esc(line)}</span>`, "echo");
  }

  clear() { this.out.innerHTML = ""; this.cur = this.out; }

  scroll() {
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }));
  }

  private docKey = (e: KeyboardEvent) => { if (this.keyCapture) this.keyCapture(e); };

  /** While set, every keydown goes to the handler instead of the prompt (games). */
  capture(h: KeyHandler | null) {
    this.keyCapture = h;
    document.removeEventListener("keydown", this.docKey);
    if (h) { document.addEventListener("keydown", this.docKey); this.cursorEl.classList.add("off"); this.input.value = ""; this.render(); }
    else { this.cursorEl.classList.remove("off"); this.focus(); }
  }

  get captured() { return this.keyCapture !== null; }

  private async submit() {
    const line = this.input.value;
    this.input.value = "";
    this.render();
    this.echo(line);
    if (line.trim()) {
      if (this.history[this.history.length - 1] !== line) this.history.push(line);
      if (this.history.length > 200) this.history.shift();
      try { localStorage.setItem("hist", JSON.stringify(this.history.slice(-50))); } catch { /* private mode */ }
    }
    this.hIdx = -1;
    await this.onRun(line);
    this.scroll();
  }

  /** Run a command as if typed: echo it and execute. */
  async run(line: string) {
    if (this.typing) return;
    this.input.value = line;
    await this.submit();
  }

  /** Type a command at `ms` per character, then run it. Click-to-type for the buttons. */
  async type(line: string, ms = 18) {
    if (this.typing) return;
    if (REDUCED || ms <= 0) return this.run(line);
    this.typing = true;
    this.cancelTyping = false;
    this.input.value = "";
    for (const ch of line) {
      if (this.cancelTyping) break;
      this.input.value += ch;
      this.render();
      await new Promise((r) => setTimeout(r, ms));
    }
    this.typing = false;
    if (!this.cancelTyping) await this.submit();
  }

  private key(e: KeyboardEvent) {
    if (this.keyCapture) return; // bubbles to docKey
    if (this.typing) { this.cancelTyping = true; return; }
    const v = this.input.value;
    if (e.key === "Enter") { e.preventDefault(); void this.submit(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!this.history.length) return;
      if (this.hIdx === -1) { this.draft = v; this.hIdx = this.history.length; }
      this.hIdx = Math.max(0, this.hIdx - 1);
      this.input.value = this.history[this.hIdx];
      this.render();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.hIdx === -1) return;
      this.hIdx++;
      if (this.hIdx >= this.history.length) { this.hIdx = -1; this.input.value = this.draft; }
      else this.input.value = this.history[this.hIdx];
      this.render();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const c = this.onComplete(v);
      if (c.length === 1) { this.input.value = c[0]; this.render(); }
      else if (c.length > 1) {
        const pre = commonPrefix(c);
        if (pre.length > v.length) this.input.value = pre;
        else this.text(c.map((x) => x.slice(x.lastIndexOf(" ") + 1)).join("  "), "suggest");
        this.render();
        this.scroll();
      }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); this.clear(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      this.print(`<span class="ps1">${esc(this.ps1)}</span>${esc(v)}^C`, "echo");
      this.input.value = ""; this.render(); this.hIdx = -1;
      this.onInterrupt?.();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "u") { e.preventDefault(); this.input.value = ""; this.render(); }
  }
}

function commonPrefix(xs: string[]): string {
  let p = xs[0];
  for (const x of xs) { while (!x.startsWith(p)) p = p.slice(0, -1); }
  return p;
}
