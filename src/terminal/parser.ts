export interface Parsed {
  raw: string;
  cmd: string;
  args: string[];       // positional args, flags removed
  flags: Record<string, string | boolean>;
  words: string[];      // every token after the command, flags included
}

/** Split a line into tokens, honouring single and double quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) {
      if (cur || has) { out.push(cur); cur = ""; has = false; }
      continue;
    }
    cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** Parse "cmd a --flag v -x b" into a Parsed. Flags take a value if the next word is not a flag. */
export function parse(line: string): Parsed {
  const toks = tokenize(line.trim());
  const cmd = (toks.shift() ?? "").toLowerCase();
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith("--") && t.length > 2) {
      const [k, v] = t.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (i + 1 < toks.length && !toks[i + 1].startsWith("-")) flags[k] = toks[++i];
      else flags[k] = true;
    } else if (t.startsWith("-") && t.length > 1 && !/^-\d/.test(t)) {
      for (const ch of t.slice(1)) flags[ch] = true;
    } else {
      args.push(t);
    }
  }
  return { raw: line, cmd, args, flags, words: toks };
}
