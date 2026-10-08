import type { Terminal } from "../terminal/terminal";
import { esc } from "../terminal/terminal";
import { runSql, type Table, type Result } from "./sql";

const BLIPS: Table = {
  name: "blips",
  cols: ["id", "name", "color", "battery", "fetched"],
  rows: [
    { id: 1, name: "blip", color: "amber", battery: 88, fetched: 14 },
    { id: 2, name: "bloop", color: "cream", battery: 42, fetched: 3 },
    { id: 3, name: "bleep", color: "amber", battery: 17, fetched: 9 },
    { id: 4, name: "blorp", color: "rust", battery: 63, fetched: 21 },
    { id: 5, name: "blit", color: "cream", battery: 49, fetched: 0 },
    { id: 6, name: "blop", color: "rust", battery: 95, fetched: 6 },
  ],
};

interface Puzzle { q: string; ref: string; ordered: boolean; }
const PUZZLES: Puzzle[] = [
  { q: "how many blips have battery under 50?", ref: "select count(*) from blips where battery<50", ordered: false },
  { q: "the name of the blip that has fetched the most files.", ref: "select name from blips order by fetched desc limit 1", ordered: false },
  { q: "average battery per color, highest first. two columns.", ref: "select color,avg(battery) from blips group by color order by 2 desc", ordered: true },
  { q: "names of blips whose name ends in 'p' and who have fetched at least one file, alphabetical.", ref: "select name from blips where name like '%p' and fetched>0 order by 1", ordered: true },
];

function table(r: Result): string {
  const h = r.cols.map((c) => `<th>${esc(c)}</th>`).join("");
  const b = r.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v === null ? "null" : String(v))}</td>`).join("")}</tr>`).join("");
  return `<table class="sql-table"><thead><tr>${h}</tr></thead><tbody>${b}</tbody></table>`;
}

function same(a: Result, b: Result, ordered: boolean): boolean {
  const norm = (r: Result) => r.rows.map((row) => JSON.stringify(row.map((v) => (typeof v === "string" ? v.toLowerCase() : v))));
  const x = norm(a), y = norm(b);
  if (x.length !== y.length) return false;
  if (!ordered) { x.sort(); y.sort(); }
  return x.every((v, i) => v === y[i]);
}

/** Returns a line handler; the terminal feeds typed lines to it until it calls `done`. */
export function sqlGolf(term: Terminal, done: () => void): (line: string) => void {
  let i = 0;
  let strokes = 0;
  const oldPs1 = term.ps1;
  term.setPs1("sql> ");
  term.print(`<span class="h">sql-golf</span>`);
  term.text("one table. one question at a time. shortest correct query wins. par is my best. 'skip' to pass, 'quit' to leave.", "dim");
  term.print(table({ cols: BLIPS.cols, rows: BLIPS.rows.map((r) => BLIPS.cols.map((c) => r[c])) }));
  ask();

  function ask() {
    const p = PUZZLES[i];
    term.print(`<b>${i + 1}/${PUZZLES.length}</b>  ${esc(p.q)}  <span class="dim">par ${p.ref.length}</span>`);
  }
  function finish() {
    term.setPs1(oldPs1);
    term.text(`done. ${strokes} characters over ${PUZZLES.length} holes. ${strokes <= PUZZLES.map((p) => p.ref.length).reduce((a, b) => a + b, 0) ? "under par. i want to hire you." : "thanks for playing."}`, "amber");
    done();
  }
  return (line: string) => {
    const s = line.trim();
    if (!s) return;
    if (s === "quit" || s === "exit") { term.setPs1(oldPs1); term.text("left the course.", "dim"); done(); return; }
    if (s === "skip") { strokes += PUZZLES[i].ref.length * 2; term.text(`skipped. a reference answer: ${PUZZLES[i].ref}`, "dim"); i++; if (i >= PUZZLES.length) finish(); else ask(); return; }
    try {
      const got = runSql(s, [BLIPS]);
      const want = runSql(PUZZLES[i].ref, [BLIPS]);
      term.print(table(got));
      if (same(got, want, PUZZLES[i].ordered)) {
        const n = s.replace(/\s+/g, " ").length;
        strokes += n;
        const par = PUZZLES[i].ref.length;
        term.text(`correct in ${n} characters. ${n < par ? "under par, show-off." : n === par ? "par." : `par was ${par}.`}`, "green");
        i++;
        if (i >= PUZZLES.length) finish(); else ask();
      } else {
        term.text("runs, but that's not the answer. try again.", "rust");
      }
    } catch (e) {
      term.text(`sql error: ${(e as Error).message}`, "err");
    }
  };
}
