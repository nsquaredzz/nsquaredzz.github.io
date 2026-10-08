/**
 * A deliberately small SQL evaluator for sql-golf.
 * Supports: SELECT [DISTINCT] exprs FROM t [WHERE] [GROUP BY] [ORDER BY] [LIMIT]
 * with COUNT/SUM/AVG/MIN/MAX, arithmetic, comparisons, AND/OR/NOT, LIKE, IN.
 */
export type Val = number | string | null;
export type Row = Record<string, Val>;
export interface Table { name: string; cols: string[]; rows: Row[]; }

type Tok = { t: "num" | "str" | "id" | "op" | "end"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      let j = i; while (j < src.length && /[\d.]/.test(src[j])) j++;
      out.push({ t: "num", v: src.slice(i, j) }); i = j; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1; while (j < src.length && src[j] !== c) j++;
      out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (/[a-z_]/i.test(c)) {
      let j = i; while (j < src.length && /[\w.]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j).toLowerCase() }); i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>", "!="].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("=<>+-*/(),;".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`unexpected '${c}'`);
  }
  out.push({ t: "end", v: "" });
  return out;
}

type Expr =
  | { k: "num"; v: number } | { k: "str"; v: string } | { k: "col"; v: string } | { k: "star" }
  | { k: "agg"; fn: string; arg: Expr; distinct: boolean }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "not"; e: Expr } | { k: "in"; e: Expr; list: Expr[]; neg: boolean }
  | { k: "like"; e: Expr; pat: string; neg: boolean };

interface Query {
  distinct: boolean;
  items: { e: Expr; alias: string | null }[];
  table: string;
  where: Expr | null;
  group: Expr[];
  order: { e: Expr; desc: boolean }[];
  limit: number | null;
}

const AGG = new Set(["count", "sum", "avg", "min", "max"]);
const KW = new Set(["from", "where", "group", "order", "limit", "as", "and", "or", "not", "in", "like", "by", "asc", "desc", "distinct", "select"]);

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  isKw(w: string) { const p = this.peek(); return p.t === "id" && p.v === w; }
  eatKw(w: string) { if (this.isKw(w)) { this.i++; return true; } return false; }
  expectKw(w: string) { if (!this.eatKw(w)) throw new Error(`expected ${w.toUpperCase()}`); }
  isOp(o: string) { const p = this.peek(); return p.t === "op" && p.v === o; }
  eatOp(o: string) { if (this.isOp(o)) { this.i++; return true; } return false; }
  expectOp(o: string) { if (!this.eatOp(o)) throw new Error(`expected '${o}'`); }

  query(): Query {
    this.expectKw("select");
    const distinct = this.eatKw("distinct");
    const items: Query["items"] = [];
    do {
      if (this.eatOp("*")) { items.push({ e: { k: "star" }, alias: null }); continue; }
      const e = this.expr();
      let alias: string | null = null;
      if (this.eatKw("as")) alias = this.ident();
      else if (this.peek().t === "id" && !KW.has(this.peek().v)) alias = this.ident();
      items.push({ e, alias });
    } while (this.eatOp(","));
    this.expectKw("from");
    const table = this.ident();
    let where: Expr | null = null;
    if (this.eatKw("where")) where = this.expr();
    const group: Expr[] = [];
    if (this.eatKw("group")) { this.expectKw("by"); do group.push(this.expr()); while (this.eatOp(",")); }
    const order: Query["order"] = [];
    if (this.eatKw("order")) {
      this.expectKw("by");
      do { const e = this.expr(); const desc = this.eatKw("desc") ? true : (this.eatKw("asc"), false); order.push({ e, desc }); } while (this.eatOp(","));
    }
    let limit: number | null = null;
    if (this.eatKw("limit")) { const t = this.next(); if (t.t !== "num") throw new Error("LIMIT needs a number"); limit = +t.v; }
    this.eatOp(";");
    if (this.peek().t !== "end") throw new Error(`unexpected '${this.peek().v}'`);
    return { distinct, items, table, where, group, order, limit };
  }
  ident(): string { const t = this.next(); if (t.t !== "id") throw new Error(`expected a name, got '${t.v}'`); return t.v; }
  expr(): Expr { return this.or(); }
  or(): Expr { let l = this.and(); while (this.eatKw("or")) l = { k: "bin", op: "or", l, r: this.and() }; return l; }
  and(): Expr { let l = this.not(); while (this.eatKw("and")) l = { k: "bin", op: "and", l, r: this.not() }; return l; }
  not(): Expr { if (this.eatKw("not")) return { k: "not", e: this.not() }; return this.cmp(); }
  cmp(): Expr {
    const l = this.add();
    const neg = this.eatKw("not");
    if (this.eatKw("in")) {
      this.expectOp("("); const list: Expr[] = []; do list.push(this.expr()); while (this.eatOp(",")); this.expectOp(")");
      return { k: "in", e: l, list, neg };
    }
    if (this.eatKw("like")) { const t = this.next(); if (t.t !== "str") throw new Error("LIKE needs a string"); return { k: "like", e: l, pat: t.v, neg }; }
    if (neg) throw new Error("NOT what?");
    for (const op of ["=", "!=", "<>", "<=", ">=", "<", ">"]) if (this.eatOp(op)) return { k: "bin", op: op === "<>" ? "!=" : op, l, r: this.add() };
    return l;
  }
  add(): Expr { let l = this.mul(); for (;;) { if (this.eatOp("+")) l = { k: "bin", op: "+", l, r: this.mul() }; else if (this.eatOp("-")) l = { k: "bin", op: "-", l, r: this.mul() }; else return l; } }
  mul(): Expr { let l = this.prim(); for (;;) { if (this.eatOp("*")) l = { k: "bin", op: "*", l, r: this.prim() }; else if (this.eatOp("/")) l = { k: "bin", op: "/", l, r: this.prim() }; else return l; } }
  prim(): Expr {
    const t = this.next();
    if (t.t === "num") return { k: "num", v: +t.v };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "op" && t.v === "(") { const e = this.expr(); this.expectOp(")"); return e; }
    if (t.t === "op" && t.v === "-") { return { k: "bin", op: "-", l: { k: "num", v: 0 }, r: this.prim() }; }
    if (t.t === "id") {
      if (AGG.has(t.v) && this.eatOp("(")) {
        const distinct = this.eatKw("distinct");
        const arg: Expr = this.eatOp("*") ? { k: "star" } : this.expr();
        this.expectOp(")");
        return { k: "agg", fn: t.v, arg, distinct };
      }
      if (KW.has(t.v)) throw new Error(`unexpected ${t.v.toUpperCase()}`);
      return { k: "col", v: t.v.includes(".") ? t.v.split(".").pop()! : t.v };
    }
    throw new Error(`unexpected '${t.v || "end of query"}'`);
  }
}

function hasAgg(e: Expr): boolean {
  switch (e.k) {
    case "agg": return true;
    case "bin": return hasAgg(e.l) || hasAgg(e.r);
    case "not": return hasAgg(e.e);
    case "in": return hasAgg(e.e) || e.list.some(hasAgg);
    case "like": return hasAgg(e.e);
    default: return false;
  }
}

function truthy(v: Val) { return v !== null && v !== 0 && v !== ""; }
function cmpVal(a: Val, b: Val): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1; if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function evalExpr(e: Expr, row: Row, group: Row[] | null, cols: string[]): Val {
  switch (e.k) {
    case "num": return e.v;
    case "str": return e.v;
    case "star": return 1;
    case "col": {
      if (!(e.v in row)) throw new Error(`no column '${e.v}' (have ${cols.join(", ")})`);
      return row[e.v];
    }
    case "agg": {
      if (!group) throw new Error(`${e.fn.toUpperCase()}() needs a GROUP BY or a whole-table aggregate`);
      let vals = group.map((r) => (e.arg.k === "star" ? 1 : evalExpr(e.arg, r, null, cols)));
      if (e.fn !== "count") vals = vals.filter((v) => v !== null);
      if (e.distinct) vals = [...new Set(vals)];
      const nums = vals.map(Number);
      switch (e.fn) {
        case "count": return e.arg.k === "star" ? group.length : vals.filter((v) => v !== null).length;
        case "sum": return nums.reduce((a, b) => a + b, 0);
        case "avg": return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        case "min": return vals.length ? vals.reduce((a, b) => (cmpVal(a, b) <= 0 ? a : b)) : null;
        case "max": return vals.length ? vals.reduce((a, b) => (cmpVal(a, b) >= 0 ? a : b)) : null;
      }
      return null;
    }
    case "not": return truthy(evalExpr(e.e, row, group, cols)) ? 0 : 1;
    case "in": {
      const v = evalExpr(e.e, row, group, cols);
      const hit = e.list.some((x) => cmpVal(evalExpr(x, row, group, cols), v) === 0);
      return hit !== e.neg ? 1 : 0;
    }
    case "like": {
      const v = String(evalExpr(e.e, row, group, cols) ?? "");
      const re = new RegExp("^" + e.pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
      return re.test(v) !== e.neg ? 1 : 0;
    }
    case "bin": {
      if (e.op === "and") return truthy(evalExpr(e.l, row, group, cols)) && truthy(evalExpr(e.r, row, group, cols)) ? 1 : 0;
      if (e.op === "or") return truthy(evalExpr(e.l, row, group, cols)) || truthy(evalExpr(e.r, row, group, cols)) ? 1 : 0;
      const a = evalExpr(e.l, row, group, cols), b = evalExpr(e.r, row, group, cols);
      switch (e.op) {
        case "=": return cmpVal(a, b) === 0 ? 1 : 0;
        case "!=": return cmpVal(a, b) !== 0 ? 1 : 0;
        case "<": return cmpVal(a, b) < 0 ? 1 : 0;
        case "<=": return cmpVal(a, b) <= 0 ? 1 : 0;
        case ">": return cmpVal(a, b) > 0 ? 1 : 0;
        case ">=": return cmpVal(a, b) >= 0 ? 1 : 0;
        case "+": return Number(a) + Number(b);
        case "-": return Number(a) - Number(b);
        case "*": return Number(a) * Number(b);
        case "/": return Number(b) === 0 ? null : Number(a) / Number(b);
      }
      return null;
    }
  }
}

export interface Result { cols: string[]; rows: Val[][]; }

export function runSql(src: string, tables: Table[]): Result {
  const q = new Parser(lex(src)).query();
  const t = tables.find((x) => x.name === q.table);
  if (!t) throw new Error(`no table '${q.table}'`);
  let rows = t.rows;
  if (q.where) rows = rows.filter((r) => truthy(evalExpr(q.where!, r, null, t.cols)));

  const items = q.items.flatMap((it) => it.e.k === "star" ? t.cols.map((c) => ({ e: { k: "col", v: c } as Expr, alias: c })) : [it]);
  const aggregated = q.group.length > 0 || items.some((it) => hasAgg(it.e));

  let out: { vals: Val[]; row: Row; group: Row[] | null }[];
  if (aggregated) {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = JSON.stringify(q.group.map((g) => evalExpr(g, r, null, t.cols)));
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    if (!groups.size && !q.group.length) groups.set("[]", []);
    out = [...groups.values()].map((g) => {
      const row = g[0] ?? Object.fromEntries(t.cols.map((c) => [c, null]));
      return { vals: items.map((it) => evalExpr(it.e, row, g, t.cols)), row, group: g };
    });
  } else {
    out = rows.map((r) => ({ vals: items.map((it) => evalExpr(it.e, r, null, t.cols)), row: r, group: null }));
  }

  const names = items.map((it, i) => it.alias ?? (it.e.k === "col" ? it.e.v : `col${i + 1}`));
  if (q.order.length) {
    const key = (o: typeof out[0], ord: { e: Expr }) => {
      if (ord.e.k === "col") { const i = names.indexOf(ord.e.v); if (i >= 0) return o.vals[i]; }
      if (ord.e.k === "num") return o.vals[ord.e.v - 1] ?? null;
      return evalExpr(ord.e, o.row, o.group, t.cols);
    };
    out.sort((a, b) => {
      for (const ord of q.order) { const c = cmpVal(key(a, ord), key(b, ord)); if (c) return ord.desc ? -c : c; }
      return 0;
    });
  }
  let result = out.map((o) => o.vals.map((v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
  if (q.distinct) { const seen = new Set<string>(); result = result.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
  if (q.limit !== null) result = result.slice(0, q.limit);
  return { cols: names, rows: result };
}
